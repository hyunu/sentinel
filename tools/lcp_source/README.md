# LCP Monitoring Protocol

`LCP Monitoring v1.0` is derived from the LCP source in `261030/`.

## Frame

```text
AA | LENGTH(2, big-endian) | FID=CA | SEQ(2, big-endian) | ATTR |
119-byte status payload | CRC16(2, big-endian) | BB
```

- Total frame size: 129 bytes
- FID: `0xCA` (monitoring)
- Source: `AppFramework/RPC_Interface.c::SendMonitoringPacketEncoder`
- Field order: `Driver/Uart.h::T_E_UartTxName`

## Registration

Registered on the Sentinel server as:

```text
id: aea62789-35ab-4cc9-9ed3-0de88c838bd4
name: LCP Monitoring
version: 1.0
```

Board `0015` was switched to this protocol so incoming `AA 00 81 CA ... BB`
frames are parsed into the 96 status fields.

## Field generation

- `_L`/`_H` adjacent pairs are exposed as little-endian `U16`
- `_1`..`_4` software part-number pairs are exposed as little-endian `U32`
- CRC16 is big-endian
- STX, FID, and ETX are validated
- All remaining one-byte status fields are exposed as `U8`

The complete parse rules are in `lcp_monitoring_protocol.json`.
