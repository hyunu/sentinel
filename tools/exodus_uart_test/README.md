# Exodus UART Capture Replay

`uart_20261028_183723.log` is a 4h40m capture containing both directions:

```text
SIM->PRD  2,801 packets
PRD->SIM 87,347 packets
```

Most `PRD->SIM` frames are 138-byte monitoring packets with FID `CA`. `SIM->PRD`
frames are shorter command/status frames.

## Replay

The replay tool opens both serial ports and preserves the original packet order
and timing:

```bash
python replay_uart_log.py \
  --sim-port /dev/cu.usbserial-4 \
  --prd-port /dev/cu.usbserial-0001 \
  --baud 19200 \
  --speed 1
```

Default port mapping:

```text
SIM->PRD : /dev/cu.usbserial-4
PRD->SIM : /dev/cu.usbserial-0001
```

At 19200 baud, a 138-byte frame takes about 72 ms on the wire. Keep `--speed`
at `1` unless you have verified the serial bandwidth. Use `--once` for one
pass, or `--limit N` for a short smoke test.

The input log is intentionally ignored by Git because it is a large capture
artifact.
