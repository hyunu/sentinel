#!/usr/bin/env python3
"""Replay LCP -> OSP UART packets from a capture CSV at a fixed interval.

The CSV is produced by the exodus UART capture tool and uses:

    Time,Dir,Raw

Only rows where the sender is LCP are sent. By default the replay loops
forever, sending one packet every 200 ms.

Example:
    python replay_lcp.py \
        --csv LCP_TEST_M8_2026-06-22_17-29-45.CSV \
        --port /dev/cu.usbserial-0001 \
        --baud 19200 \
        --interval-ms 200
"""

from __future__ import annotations

import argparse
import csv
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path

try:
    import serial
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "pyserial is required: python3 -m pip install pyserial"
    ) from exc


@dataclass(frozen=True)
class Packet:
    time_text: str
    direction: str
    raw: bytes


def parse_sender(direction: str) -> str | None:
    direction = direction.strip()
    if "->" in direction:
        return direction.split("->", 1)[0].strip()
    if "<-" in direction:
        return direction.split("<-", 1)[1].strip()
    return None


def load_packets(csv_path: Path, sender: str) -> list[Packet]:
    packets: list[Packet] = []
    with csv_path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if header is None:
            raise SystemExit(f"empty CSV: {csv_path}")

        for line_no, row in enumerate(reader, start=2):
            if len(row) < 3:
                continue
            time_text, direction, raw_text = row[0].strip(), row[1].strip(), row[2].strip()
            if parse_sender(direction) != sender:
                continue
            try:
                raw = bytes(int(token, 16) for token in raw_text.split())
            except ValueError:
                print(f"skip invalid hex at line {line_no}", file=sys.stderr)
                continue
            packets.append(Packet(time_text, direction, raw))

    return packets


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path(__file__).with_name("LCP_TEST_M8_2026-06-22_17-29-45.CSV"),
    )
    parser.add_argument("--port", default="/dev/cu.usbserial-0001")
    parser.add_argument("--baud", type=int, default=19200)
    parser.add_argument("--interval-ms", type=float, default=200.0)
    parser.add_argument(
        "--sender",
        default="LCP",
        help="only send rows whose direction sender matches this name",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="send one pass through the CSV instead of looping forever",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="stop after N packets (0 = unlimited)",
    )
    args = parser.parse_args()

    if not args.csv.is_file():
        raise SystemExit(f"CSV not found: {args.csv}")
    if args.interval_ms <= 0:
        raise SystemExit("--interval-ms must be > 0")

    packets = load_packets(args.csv, args.sender)
    if not packets:
        raise SystemExit(f"no {args.sender} packets found in {args.csv}")

    print(
        f"loaded {len(packets)} {args.sender} packets "
        f"from {args.csv.name}",
        flush=True,
    )
    print(
        f"replay: {args.port} @ {args.baud} bps, "
        f"interval={args.interval_ms:g} ms, loop={not args.once}",
        flush=True,
    )

    stop_requested = False

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stop_requested
        stop_requested = True
        print("\nstopping...", flush=True)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    port: serial.Serial | None = None
    sent = 0
    packet_index = 0
    interval_s = args.interval_ms / 1000.0
    next_send = time.monotonic()

    while not stop_requested:
        if port is None or not port.is_open:
            try:
                port = open_port(args.port, args.baud)
                print(f"opened {args.port}", flush=True)
            except Exception as exc:
                print(f"open failed: {exc}; retrying in 2s", file=sys.stderr, flush=True)
                time.sleep(2.0)
                continue

        packet = packets[packet_index]
        now = time.monotonic()
        delay = next_send - now
        if delay > 0:
            time.sleep(delay)

        try:
            port.write(packet.raw)
            port.flush()
            sent += 1
            next_send += interval_s
            # If we fell behind, don't send a burst to catch up.
            if next_send < time.monotonic():
                next_send = time.monotonic() + interval_s

            if sent % 100 == 0 or sent == 1:
                print(
                    f"sent={sent} index={packet_index + 1}/{len(packets)} "
                    f"len={len(packet.raw)} first={packet.raw[:4].hex(' ')}",
                    flush=True,
                )
        except Exception as exc:
            print(f"write failed: {exc}; reconnecting", file=sys.stderr, flush=True)
            try:
                port.close()
            except Exception:
                pass
            port = None
            time.sleep(1.0)
            continue

        packet_index += 1
        if packet_index >= len(packets):
            if args.once:
                break
            packet_index = 0

        if args.limit and sent >= args.limit:
            break

    if port is not None:
        try:
            port.close()
        except Exception:
            pass
    print(f"done: sent {sent} packets", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
