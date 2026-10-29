const boardId = "perf-30d-board";
const TK = "payload\uFF0Etemperature_celsius";
const HK = "payload\uFF0Ehumidity_percent";
db.viz_rollups.deleteMany({board_id: boardId});
let batch = [];
let total = 0;
db.uart_data.aggregate([
  {$match: {board_id: boardId}},
  {$project: {
    bucket: {$toDate: {$subtract: ["$timestamp", {$mod: [{$toLong: "$timestamp"}, 60000]}]}},
    temp: "$parsed_fields.payload.temperature_celsius",
    hum: "$parsed_fields.payload.humidity_percent"
  }},
  {$group: {
    _id: "$bucket",
    count: {$sum: 1},
    min_temp: {$min: "$temp"}, max_temp: {$max: "$temp"}, sum_temp: {$sum: "$temp"},
    min_hum: {$min: "$hum"}, max_hum: {$max: "$hum"}, sum_hum: {$sum: "$hum"}
  }},
  {$sort: {_id: 1}}
], {allowDiskUse: true}).forEach(r => {
  const minFields = {}; minFields[TK] = r.min_temp; minFields[HK] = r.min_hum;
  const maxFields = {}; maxFields[TK] = r.max_temp; maxFields[HK] = r.max_hum;
  const sumFields = {}; sumFields[TK] = r.sum_temp; sumFields[HK] = r.sum_hum;
  batch.push({
    _id: boardId + "-60-" + r._id.getTime(),
    board_id: boardId,
    granularity_sec: 60,
    bucket_start: r._id,
    count: r.count,
    min_fields: minFields,
    max_fields: maxFields,
    sum_fields: sumFields,
    created_at: new Date(),
    updated_at: new Date()
  });
  if (batch.length === 5000) {
    db.viz_rollups.insertMany(batch, {ordered: false});
    total += batch.length;
    batch = [];
  }
});
if (batch.length) { db.viz_rollups.insertMany(batch, {ordered: false}); total += batch.length; }
print("rollups=" + total + " count=" + db.viz_rollups.countDocuments({board_id: boardId, granularity_sec: 60}));
