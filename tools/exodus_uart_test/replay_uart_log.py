#!/usr/bin/env python3
"""Replay captured SIM<->PRD UART packets on two serial ports.

The exodus capture log contains timestamped packets in both directions:

    [18:37:35.526] PRD->SIM PKT (138) AA ...
    [18:37:45.125] SIM->PRD PKT ( 24) AA ...

This tool opens one port for each direction and preserves the original
arrival timing. The default port mapping matches the current bench setup:

    SIM->PRD : /dev/cu.usbserial-4
    PRD->SIM : /dev/cu.usbserial-0001

Use --speed <1,2,...> to replay faster. Keep speed at 1.0 at 19200 baud:
138-byte frames take about 72 ms on the wire, and the capture is already
close to that rate.

Examples:
    python replay_uart_log.py --once
    python replay_uart_log.py --speed 1 --loop
    python replay_uart_log.py --sim-port /dev/cu.usbserial-4 \
        --prd-port /dev/cu.usbserial-0001 --baud 19200
"""

from __future__ import annotations

import argparse
import re
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path

try:
    import serial
except ImportError as exc:  # pragma: no cover
    raise SystemExit("pyserial is required: python3 -m pip install pyserial") from exc


PACKET_RE = re.compile(
    r"^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s+"
    r"([A-Za-z0-9_]+->[A-Za-z0-9_]+)\s+PKT\s+"
    r"\(\s*(\d+)\s*\)\s+(.+?)\s*$"
)


@dataclass(frozen=True)
class Packet:
    time_sec: float
    direction: str
    raw: bytes


def parse_timestamp(value: str) -> float:
    hour, minute, second = value.split(":")
    return int(hour) * 3600 + int(minute) * 60 + float(second)


def load_packets(path: Path) -> tuple[list[Packet], dict[str, int]]:
    packets: list[Packet] = []
    skipped = 0
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = PACKET_RE.match(line.strip())
            if not match:
                skipped += 1
                continue
            timestamp, direction, announced_len, hex_text = match.groups()
            try:
                raw = bytes.fromhex(hex_text)
            except ValueError:
                skipped += 1
                continue
            expected_len = int(announced_len)
            if expected_len != len(raw):
                skipped += 1
                continue
            packets.append(Packet(parse_timestamp(timestamp), direction, raw))

    if not packets:
        raise SystemExit(f"no valid packets found in {path}")

    packets.sort(key=lambda packet: packet.time_sec)
    counts: dict[str, int] = {}
    for packet in packets:
        counts[packet.direction] = counts.get(packet.direction, 0) + 1
    if skipped:
        print(f"skipped {skipped} non-packet/invalid lines", file=sys.stderr)
    return packets, counts


def open_port(port: str, baud: int) -> serial.Serial:
    return serial.Serial(
        port=port,
        baudrate=baud,
        bytesize=serial.EIGHTBITS,
        parity=serial.PARITY_NONE,
        stopbits=serial.STOPBITS_ONE,
        timeout=0.5,
        write_timeout=2.0,
    )


def write_packet(port: serial.Serial, raw: bytes) -> None:
    port.write(raw)
    port.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--log",
        type=Path,
        default=Path(__file__).with_name("uart_20261028_183723.log"),
    )
    parser.add_argument("--sim-port", default="/dev/cu.usbserial-4")
    parser.add_argument("--prd-port", default="/dev/cu.usbserial-0001")
    parser.add_argument("--baud", type=int, default=19200)
    parser.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help="replay speed multiplier (1 = original timing)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="stop after one pass instead of looping",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="stop after N sent packets (0 = unlimited)",
    )
    args = parser.parse_args()

    if not args.log.is_file():
        raise SystemExit(f"log not found: {args.log}")
    if args.speed <= 0:
        raise SystemExit("--speed must be > 0")
    if args.baud <= 0:
        raise SystemExit("--baud must be > 0")

    packets, counts = load_packets(args.log)
    print(f"loaded {len(packets)} packets from {args.log.name}", flush=True)
    print(
        f"  SIM->PRD {counts.get('SIM->PRD', 0)} -> {args.sim_port}",
        flush=True,
    )
    print(
        f"  PRD->SIM {counts.get('PRD->SIM', 0)} -> {args.prd_port}",
        flush=True,
    )
    duration = packets[-1].time_sec - packets[0].time_sec
    print(
        f"  capture duration {duration:.1f}s, speed {args.speed:g}x, "
        f"loop={not args.once}",
        flush=True,
    )

    stop_requested = False

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stop_requested
        stop_requested = True
        print("\nstopping...", flush=True)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    ports: dict[str, serial.Serial] = {}
    sent = 0
    passes = 0

    def ensure_port(direction: str) -> serial.Serial | None:
        port_path = args.sim_port if direction == "SIM->PRD" else args.prd_port
        current = ports.get(direction)
        if current is not None and current.is_open:
            return current
        try:
            current = open_port(port_path, args.baud)
            ports[direction] = current
            print(f"opened {direction} -> {port_path} @ {args.baud} bps", flush=True)
            return current
        except Exception as exc:
            print(
                f"open {direction} {port_path} failed: {exc}; retrying",
                file=sys.stderr,
                flush=True,
            )
            return None

    try:
        while not stop_requested:
            base_wall = time.monotonic()
            origin = packets[0].time_sec
            for packet in packets:
                if stop_requested:
                    break
                target = base_wall + (packet.time_sec - origin) / args.speed
                delay = target - time.monotonic()
                if delay > 0:
                    time.sleep(delay)

                port_path = args.sim_port if packet.direction == "SIM->PRD" else args.prd_port
                port = ensure_port(packet.direction)
                if port is None:
                    try:
                        port = open_port(port_path, args.baud)
                        ports[packet.direction] = port
                    except Exception:
                        time.sleep(1.0)
                        continue
                try:
                    write_packet(port, packet.raw)
                except Exception as exc:
                    print(
                        f"write {packet.direction} failed: {exc}; reconnecting",
                        file=sys.stderr,
                        flush=True,
                    )
                    try:
                        port.close()
                    except Exception:
                        pass
                    ports.pop(packet.direction, None)
                    continue

                sent += 1
                if sent % 100 == 0:
                    print(
                        f"sent={sent} pass={passes + 1} "
                        f"dir={packet.direction} len={len(packet.raw)}",
                        flush=True,
                    )
                if args.limit and sent >= args.limit:
                    stop_requested = True
                    break

            passes += 1
            if args.once or stop_requested:
                break
    finally:
        for port in ports.values():
            try:
                port.close()
            except Exception:
                pass

    print(f"done: sent {sent} packets in {passes} pass(es)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
