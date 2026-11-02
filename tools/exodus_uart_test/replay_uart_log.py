#!/usr/bin/env python3
"""Replay captured SIM<->PRD UART packets on two serial ports.

The exodus capture log contains timestamped packets in both directions:

    [18:37:35.526] PRD->SIM PKT (138) AA ...
    [18:37:45.125] SIM->PRD PKT ( 24) AA ...

Each direction is written to its own serial port, in capture order. The
timeline starts at the current wall clock and every packet is scheduled at:

    start + (packet timestamp - first packet timestamp) / speed

A dedicated writer thread per port retries failed writes instead of skipping
the packet. When a port is slower than the captured traffic, its packets are
queued and sent in order at the maximum rate the UART supports. No packet is
dropped while replaying a pass.

Default port mapping for the current bench:

    SIM->PRD : /dev/cu.usbserial-3
    PRD->SIM : /dev/cu.usbserial-0001

Examples:
    python replay_uart_log.py --once
    python replay_uart_log.py --speed 1
    python replay_uart_log.py --sim-port /dev/cu.usbserial-3 \
        --prd-port /dev/cu.usbserial-0001 --baud 19200
"""

from __future__ import annotations

import argparse
import queue
import re
import signal
import sys
import threading
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
DIRECTIONS = ("SIM->PRD", "PRD->SIM")


@dataclass(frozen=True)
class Packet:
    time_sec: float
    direction: str
    raw: bytes


@dataclass(frozen=True)
class Job:
    packet: Packet
    scheduled_at: float


class DirectionStats:
    def __init__(self) -> None:
        self.sent = 0
        self.bytes_sent = 0
        self.retries = 0
        self.max_lag = 0.0
        self.late = 0
        self._lock = threading.Lock()

    def record_sent(self, size: int, lag: float) -> None:
        with self._lock:
            self.sent += 1
            self.bytes_sent += size
            if lag > 0.05:
                self.late += 1
            if lag > self.max_lag:
                self.max_lag = lag

    def record_retry(self) -> None:
        with self._lock:
            self.retries += 1


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
                if line.strip():
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
        print(
            f"warning: skipped {skipped} invalid non-empty log lines",
            file=sys.stderr,
            flush=True,
        )
    return packets, counts


def open_port(port: str, baud: int) -> serial.Serial:
    return serial.Serial(
        port=port,
        baudrate=baud,
        bytesize=serial.EIGHTBITS,
        parity=serial.PARITY_NONE,
        stopbits=serial.STOPBITS_ONE,
        timeout=0.5,
        write_timeout=5.0,
    )


def write_all(port: serial.Serial, raw: bytes) -> None:
    """Write every byte of one packet, retrying short writes."""
    view = memoryview(raw)
    total = 0
    while total < len(view):
        try:
            written = port.write(view[total:])
        except serial.SerialTimeoutException as exc:
            # pyserial records the partial byte count on this exception.
            written = getattr(exc, "written", 0) or 0
            if written == 0:
                raise
        if not written:
            raise serial.SerialTimeoutException(
                f"serial write returned 0 with {len(view) - total} bytes remaining"
            )
        total += written
    port.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--log",
        type=Path,
        default=Path(__file__).with_name("uart_20261028_183723.log"),
    )
    parser.add_argument("--sim-port", default="/dev/cu.usbserial-3")
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
        help="stop after one complete pass instead of looping",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="stop after N scheduled packets (0 = unlimited)",
    )
    parser.add_argument(
        "--trace-sim",
        action="store_true",
        help="log every SIM->PRD packet instead of every 100th",
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
        f"mode={'once' if args.once or args.limit else 'loop'}",
        flush=True,
    )

    stop_requested = threading.Event()
    hard_stop = threading.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        if stop_requested.is_set():
            hard_stop.set()
            print("\nsecond stop request: aborting pending retries", flush=True)
        else:
            stop_requested.set()
            print("\nstopping after draining queued packets...", flush=True)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    port_paths = {
        "SIM->PRD": args.sim_port,
        "PRD->SIM": args.prd_port,
    }
    queues: dict[str, queue.Queue[Job | None]] = {
        direction: queue.Queue() for direction in DIRECTIONS
    }
    stats = {direction: DirectionStats() for direction in DIRECTIONS}
    print_lock = threading.Lock()

    def writer(direction: str) -> None:
        port_path = port_paths[direction]
        direction_stats = stats[direction]
        port: serial.Serial | None = None

        def close_port() -> None:
            nonlocal port
            if port is not None:
                try:
                    port.close()
                except Exception:
                    pass
                port = None

        try:
            while not hard_stop.is_set():
                try:
                    job = queues[direction].get(timeout=0.2)
                except queue.Empty:
                    if stop_requested.is_set() and queues[direction].empty():
                        break
                    continue

                if job is None:
                    queues[direction].task_done()
                    break

                packet = job.packet
                while True:
                    try:
                        if port is None:
                            port = open_port(port_path, args.baud)
                            with print_lock:
                                print(
                                    f"opened {direction} -> {port_path} "
                                    f"@ {args.baud} bps",
                                    flush=True,
                                )
                        # Measure scheduling lag before flush(), because flush
                        # waits for the bytes to finish on the wire.
                        lag = time.monotonic() - job.scheduled_at
                        write_all(port, packet.raw)
                        break
                    except Exception as exc:
                        direction_stats.record_retry()
                        with print_lock:
                            print(
                                f"write {direction} {port_path} failed: {exc}; "
                                f"retrying same packet (no skip)",
                                file=sys.stderr,
                                flush=True,
                            )
                        close_port()
                        if hard_stop.is_set():
                            break
                        stop_requested.wait(0.5)

                if hard_stop.is_set() and port is None:
                    queues[direction].task_done()
                    break

                direction_stats.record_sent(len(packet.raw), lag)
                sent = direction_stats.sent
                trace_packet = direction == "SIM->PRD" and args.trace_sim
                if sent == 1 or sent % 100 == 0 or trace_packet:
                    with print_lock:
                        print(
                            f"sent {direction}={sent} "
                            f"len={len(packet.raw)} "
                            f"lag={lag:.3f}s "
                            f"bytes={direction_stats.bytes_sent} "
                            f"late={direction_stats.late} "
                            f"max_lag={direction_stats.max_lag:.3f}s "
                            f"retries={direction_stats.retries}",
                            flush=True,
                        )
                queues[direction].task_done()
        finally:
            close_port()

    threads = {
        direction: threading.Thread(
            target=writer,
            args=(direction,),
            name=f"uart-{direction}",
            daemon=True,
        )
        for direction in DIRECTIONS
    }
    for thread in threads.values():
        thread.start()

    def pending_count() -> int:
        return sum(q.unfinished_tasks for q in queues.values())

    def wait_for_drain() -> bool:
        last_report = time.monotonic()
        while True:
            pending = pending_count()
            if pending == 0:
                return True
            if hard_stop.is_set():
                return False
            now = time.monotonic()
            if now - last_report >= 10.0:
                with print_lock:
                    print(f"draining pending={pending} packets...", flush=True)
                last_report = now
            time.sleep(0.2)

    passes = 0
    scheduled_total = 0
    all_passes_ok = True
    origin = packets[0].time_sec

    try:
        while not stop_requested.is_set():
            passes += 1
            before = {direction: stats[direction].sent for direction in DIRECTIONS}
            base_wall = time.monotonic()
            scheduled_this_pass = 0

            for packet in packets:
                if stop_requested.is_set():
                    break
                target = base_wall + (packet.time_sec - origin) / args.speed
                delay = target - time.monotonic()
                if delay > 0 and stop_requested.wait(delay):
                    break
                queues[packet.direction].put(Job(packet, target))
                scheduled_this_pass += 1
                scheduled_total += 1
                if args.limit and scheduled_total >= args.limit:
                    stop_requested.set()
                    break

            drained = wait_for_drain()
            pass_ok = True
            with print_lock:
                print(
                    f"pass {passes} scheduled={scheduled_this_pass} "
                    f"drained={'yes' if drained else 'no'}",
                    flush=True,
                )
            for direction in DIRECTIONS:
                sent_this_pass = stats[direction].sent - before[direction]
                expected = (
                    counts.get(direction, 0)
                    if scheduled_this_pass == len(packets)
                    else None
                )
                if expected is not None and sent_this_pass != expected:
                    pass_ok = False
                    all_passes_ok = False
                with print_lock:
                    suffix = (
                        f"/{expected}" if expected is not None else ""
                    )
                    print(
                        f"  {direction}: sent={sent_this_pass}{suffix} "
                        f"bytes={stats[direction].bytes_sent} "
                        f"retries={stats[direction].retries}",
                        flush=True,
                    )
            if not drained:
                all_passes_ok = False
                break
            if args.once or args.limit or stop_requested.is_set():
                break

        print(
            f"done: passes={passes} scheduled={scheduled_total} "
            f"sent={sum(direction_stats.sent for direction_stats in stats.values())} "
            f"verified={'yes' if all_passes_ok else 'no'}",
            flush=True,
        )
    finally:
        stop_requested.set()
        for direction in DIRECTIONS:
            queues[direction].put(None)
        for thread in threads.values():
            thread.join(timeout=5.0)

    return 0 if all_passes_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
