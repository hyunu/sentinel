const boardId = "perf-30d-board";
db.boards.deleteOne({_id: boardId});
db.uart_data.deleteMany({board_id: boardId});
db.viz_rollups.deleteMany({board_id: boardId});
db.sessions.deleteMany({board_id: boardId});

const now = new Date();
const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
db.boards.insertOne({
  _id: boardId,
  uid: "PERF30D",
  name: "PERF-30D",
  mac_address: "perf:30d",
  wifi_mac: "02:00:00:00:30:0d",
  protocol_id: "temperature-telemetry-v1",
  location: "synthetic performance test",
  firmware_version: "perf",
  last_heartbeat: now,
  is_active: true,
  created_at: start,
  updated_at: now,
});

const stepSec = 5;
const total = Math.floor(30 * 24 * 3600 / stepSec);
let batch = [];
for (let i = 0; i < total; i++) {
  const ts = new Date(start.getTime() + i * stepSec * 1000);
  const phase = (i * stepSec / 86400) * 2 * Math.PI;
  const temp = 25 + 7 * Math.sin(phase) + 0.8 * Math.sin(i / 37) + (i % 97 === 0 ? 6 : 0);
  const hum = 55 + 15 * Math.cos(phase) + (i % 53) / 10;
  batch.push({
    _id: "perf-30d-" + i,
    board_id: boardId,
    timestamp: ts,
    raw_hex: "AA0000BB",
    direction: "RX",
    parsed_fields: {
      "payload.temperature_celsius": Number(temp.toFixed(2)),
      "payload.humidity_percent": Number(hum.toFixed(2)),
      "payload.sensor_id": 1,
      seq_no: i % 65536,
    },
  });
  if (batch.length === 10000) {
    db.uart_data.insertMany(batch, {ordered: false});
    batch = [];
    if (i % 100000 === 0) print("inserted " + i + " / " + total);
  }
}
if (batch.length) db.uart_data.insertMany(batch, {ordered: false});
print("raw_count=" + db.uart_data.countDocuments({board_id: boardId}));
print("board=" + boardId);
