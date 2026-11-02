# Exodus UART Capture Replay

`uart_20261028_183723.log` is a 4h40m capture containing both directions:

```text
SIM->PRD  2,801 packets
PRD->SIM 87,347 packets
```

Most `PRD->SIM` frames are 138-byte monitoring packets with FID `CA`. `SIM->PRD`
frames are shorter command/status frames.

## Replay

Each direction is written to its own serial port:

```text
SIM->PRD : /dev/cu.usbserial-3
PRD->SIM : /dev/cu.usbserial-0001
```

Run one complete pass from the beginning:

```bash
python replay_uart_log.py \
  --sim-port /dev/cu.usbserial-3 \
  --prd-port /dev/cu.usbserial-0001 \
  --baud 19200 \
  --speed 1 \
  --once
```

The timeline starts at the current time. Each packet is scheduled at:

```text
start + (packet timestamp - first packet timestamp) / speed
```

For example, the first PRD->SIM packet is sent 0.085 seconds after the first
SIM->PRD packet, and the original gaps between packets are preserved.

## No packet drops

The replay tool never skips a packet:

- One writer thread per direction preserves packet order.
- A failed port open or write retries the same packet.
- Packets that cannot fit on the wire immediately stay queued and are sent in
  order at the UART's maximum rate.
- At the end of a pass the tool drains both queues before reporting completion.
- The pass summary compares sent counts against the capture counts.

At 19200 baud a 138-byte frame takes about 72-88 ms on the wire. Pairs captured
closer together than that cannot start at the exact captured interval; they are
queued and serialized by the UART. No packet is discarded because of this.

Use `--limit N` for a short smoke test. Without `--once`, the capture repeats.
Add `--trace-sim` to log every `SIM->PRD` packet as it is sent.
