# LCP Monitoring Protocol

`LCP Monitoring v1.0` is derived from the LCP source in `261030/`.

## Frame

```text
AA | LENGTH(1) | FID=CA | SEQ(2, big-endian) | ATTR |
129-byte status payload | 10-byte reserved tail | CRC16(2, big-endian) | BB
```

- Total frame size: 138 bytes
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

Board `0015` was switched to this protocol so incoming `AA 8A CA ... BB`
frames are parsed into the 96 status fields.

## Field generation

- `_L`/`_H` adjacent pairs are exposed as little-endian `U16`
- `_1`..`_4` software part-number pairs are exposed as little-endian `U32`
- CRC16 is big-endian
- STX, FID, and ETX are validated
- All remaining one-byte status fields are exposed as `U8`

The complete parse rules are in `lcp_monitoring_protocol.json`.

## v2.0

`lcp_monitoring_v2_protocol.json` is generated from the updated
`RPC_Interface.c::SendMonitoringPacketEncoder` source.

```text
id: lcp-monitoring-v2
name: LCP Monitoring
version: 2.0
total frame: 138 bytes
LEN: 1 byte
payload: 129 bytes / 98 fields
```

v2.0 changes from v1.0:

- Adds the six product-info flags at the start of the payload
- Adds wash-motor intermittent flag
- Adds sensing result, water-supply state, and target pulse
- Removes the 10-byte reserved padding used by v1.0
- Maps every field from `SendMonitoringPacketEncoder` sequentially

Board `0013` uses `lcp-monitoring-v2` and its 90,148-frame fixture was
re-imported with the v2.0 field mapping.
