package api

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/hyunu/sentinel/internal/ai"
	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	aiToolCount        = 13
	aiDefaultPointCap  = 240
	aiMaxPointCap      = 1000
	aiMaxSeriesSpan    = 7 * 24 * time.Hour
	aiMaxEventSpan     = 24 * time.Hour
	aiMaxEventScan     = 200000
	aiDefaultEventCap  = 50
	aiMaxEventCap      = 200
	aiMaxRawSpan       = 24 * time.Hour
	aiDefaultRawCap    = 20
	aiMaxRawCap        = 50
	aiMaxFieldListCap  = 200
	aiDefaultFieldList = 100
)

type aiToolExecutor struct {
	h          *Handler
	boardID    string
	protocolID string
}

type aiBoardSummary struct {
	ID              string    `json:"id"`
	UID             string    `json:"uid,omitempty"`
	Name            string    `json:"name"`
	Location        string    `json:"location,omitempty"`
	ProtocolID      string    `json:"protocol_id,omitempty"`
	FirmwareVersion string    `json:"firmware_version,omitempty"`
	WifiRSSI        int       `json:"wifi_rssi,omitempty"`
	IsActive        bool      `json:"is_active"`
	LastHeartbeat   time.Time `json:"last_heartbeat"`
}

type aiProtocolSummary struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Version     string         `json:"version,omitempty"`
	Description string         `json:"description,omitempty"`
	Frame       string         `json:"frame,omitempty"`
	Notes       map[string]any `json:"notes,omitempty"`
	Fields      []string       `json:"fields"`
}

type aiFieldStats struct {
	Count int64    `json:"count"`
	Min   *float64 `json:"min,omitempty"`
	Max   *float64 `json:"max,omitempty"`
	Avg   *float64 `json:"avg,omitempty"`
}

type aiSeriesPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

func clampAILimit(value, fallback, max int) int {
	if value <= 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func decodeToolArgs(raw json.RawMessage, dst any) error {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("invalid arguments: %w", err)
	}
	return nil
}

func (h *Handler) buildAIToolRegistry(boardID, protocolID string) *ai.ToolRegistry {
	exec := &aiToolExecutor{h: h, boardID: boardID, protocolID: protocolID}
	return ai.NewToolRegistry(
		ai.Tool{Spec: ai.ToolSpec{Name: "list_boards", Description: "List registered Sentinel boards with status and location.", Parameters: aiSchemaListBoards}, Execute: exec.listBoards},
		ai.Tool{Spec: ai.ToolSpec{Name: "get_board", Description: "Get details for one board, including its protocol and available fields.", Parameters: aiSchemaGetBoard}, Execute: exec.getBoard},
		ai.Tool{Spec: ai.ToolSpec{Name: "list_protocols", Description: "List protocol specifications and their parseable field paths.", Parameters: aiSchemaListProtocols}, Execute: exec.listProtocols},
		ai.Tool{Spec: ai.ToolSpec{Name: "get_protocol", Description: "Get one protocol specification with field paths, frame format, and units metadata.", Parameters: aiSchemaGetProtocol}, Execute: exec.getProtocol},
		ai.Tool{Spec: ai.ToolSpec{Name: "list_fields", Description: "List parsed field names actually present in stored data for the selected board.", Parameters: aiSchemaListFields}, Execute: exec.listFields},
		ai.Tool{Spec: ai.ToolSpec{Name: "stats", Description: "Compute deterministic count/min/max/avg statistics for one parsed field.", Parameters: aiSchemaStats}, Execute: exec.stats},
		ai.Tool{Spec: ai.ToolSpec{Name: "query_series", Description: "Query a numeric parsed field as a time series. Prefer this for trends and charts.", Parameters: aiSchemaQuerySeries}, Execute: exec.querySeries},
		ai.Tool{Spec: ai.ToolSpec{Name: "find_events", Description: "Find contiguous time intervals where a numeric field satisfies a threshold condition.", Parameters: aiSchemaFindEvents}, Execute: exec.findEvents},
		ai.Tool{Spec: ai.ToolSpec{Name: "find_anomalies", Description: "Detect statistical anomalies or abrupt change points in one numeric field.", Parameters: aiSchemaFindAnomalies}, Execute: exec.findAnomalies},
		ai.Tool{Spec: ai.ToolSpec{Name: "compare_sessions", Description: "Compare count/min/max/avg of one field across capture sessions.", Parameters: aiSchemaCompareSessions}, Execute: exec.compareSessions},
		ai.Tool{Spec: ai.ToolSpec{Name: "list_sessions", Description: "List capture sessions for the selected board.", Parameters: aiSchemaListSessions}, Execute: exec.listSessions},
		ai.Tool{Spec: ai.ToolSpec{Name: "query_raw", Description: "Read a small sample of raw UART frames for spot checking or debugging.", Parameters: aiSchemaQueryRaw}, Execute: exec.queryRaw},
		ai.Tool{Spec: ai.ToolSpec{Name: "propose_chart", Description: "Return a chart specification for the dashboard. Call this when the user asks for a chart or visualization.", Parameters: aiSchemaProposeChart}, Execute: exec.proposeChart},
	)
}

func (e *aiToolExecutor) window(start, end string, lastMinutes int, maxSpan time.Duration) (timeWindow, error) {
	return resolveTimeWindow(start, end, lastMinutes, time.Now(), maxSpan)
}

func (e *aiToolExecutor) boardTimeFilter(window timeWindow) bson.M {
	return bson.M{
		"board_id":  e.boardID,
		"timestamp": bson.M{"$gte": window.Start, "$lte": window.End},
	}
}

func (e *aiToolExecutor) listBoards(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, 20, 100)
	filter := bson.M{}
	if q := strings.TrimSpace(args.Query); q != "" {
		pattern := primitive.Regex{Pattern: regexp.QuoteMeta(q), Options: "i"}
		filter["$or"] = bson.A{
			bson.M{"name": pattern},
			bson.M{"uid": pattern},
			bson.M{"location": pattern},
		}
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cursor, err := e.h.db.Boards().Find(ctx, filter,
		options.Find().
			SetSort(bson.D{{Key: "is_active", Value: -1}, {Key: "last_heartbeat", Value: -1}}).
			SetLimit(int64(limit)).
			SetProjection(bson.M{"uid": 1, "name": 1, "location": 1, "protocol_id": 1, "firmware_version": 1, "wifi_rssi": 1, "is_active": 1, "last_heartbeat": 1}),
	)
	if err != nil {
		return nil, fmt.Errorf("list boards: %w", err)
	}
	defer cursor.Close(ctx)

	boards := make([]aiBoardSummary, 0, limit)
	for cursor.Next(ctx) {
		var board models.Board
		if err := cursor.Decode(&board); err != nil {
			continue
		}
		boards = append(boards, boardSummary(board))
	}
	return map[string]any{"boards": boards, "count": len(boards)}, cursor.Err()
}

func boardSummary(board models.Board) aiBoardSummary {
	return aiBoardSummary{
		ID:              board.ID,
		UID:             board.UID,
		Name:            board.Name,
		Location:        board.Location,
		ProtocolID:      board.ProtocolID,
		FirmwareVersion: board.FirmwareVersion,
		WifiRSSI:        board.WifiRSSI,
		IsActive:        board.IsActive,
		LastHeartbeat:   board.LastHeartbeat,
	}
}

func (e *aiToolExecutor) getBoard(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		BoardID string `json:"board_id"`
		UID     string `json:"uid"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	boardID := strings.TrimSpace(args.BoardID)
	if boardID == "" {
		boardID = e.boardID
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	resolved, err := e.h.resolveBoardID(ctx, boardID, strings.TrimSpace(args.UID))
	if err != nil {
		return nil, err
	}
	var board models.Board
	if err := e.h.db.Boards().FindOne(ctx, bson.M{"_id": resolved}).Decode(&board); err != nil {
		return nil, fmt.Errorf("board not found")
	}

	result := map[string]any{"board": boardSummary(board)}
	if board.ProtocolID != "" {
		var proto models.ProtocolSpec
		if err := e.h.db.Protocols().FindOne(ctx, bson.M{"_id": board.ProtocolID}).Decode(&proto); err == nil {
			result["protocol"] = protocolSummary(&proto)
		}
	}
	return result, nil
}

func protocolSummary(proto *models.ProtocolSpec) aiProtocolSummary {
	summary := aiProtocolSummary{
		ID:          proto.ID,
		Name:        proto.Name,
		Version:     proto.Version,
		Description: proto.Description,
		Fields:      []string{},
	}
	if proto.ParseRules == nil {
		return summary
	}
	summary.Fields = collectParseRuleFieldPaths(proto.ParseRules)
	if proto.ParseRules.Meta != nil {
		if frame, ok := proto.ParseRules.Meta["frame"].(string); ok {
			summary.Frame = frame
		}
		if notes, ok := proto.ParseRules.Meta["notes"].(map[string]any); ok {
			summary.Notes = notes
		}
	}
	return summary
}

func (e *aiToolExecutor) listProtocols(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Limit int `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, 50, 100)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cursor, err := e.h.db.Protocols().Find(ctx, bson.M{},
		options.Find().SetSort(bson.M{"name": 1}).SetLimit(int64(limit)),
	)
	if err != nil {
		return nil, fmt.Errorf("list protocols: %w", err)
	}
	defer cursor.Close(ctx)

	protocols := make([]aiProtocolSummary, 0, limit)
	for cursor.Next(ctx) {
		var proto models.ProtocolSpec
		if err := cursor.Decode(&proto); err != nil {
			continue
		}
		protocols = append(protocols, protocolSummary(&proto))
	}
	return map[string]any{"protocols": protocols, "count": len(protocols)}, cursor.Err()
}

func (e *aiToolExecutor) getProtocol(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		ProtocolID string `json:"protocol_id"`
		Name       string `json:"name"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	filter := bson.M{}
	id := strings.TrimSpace(args.ProtocolID)
	if id == "" {
		id = e.protocolID
	}
	if id != "" {
		filter["_id"] = id
	} else if name := strings.TrimSpace(args.Name); name != "" {
		filter["name"] = name
	} else {
		return nil, fmt.Errorf("protocol_id or name is required")
	}

	var proto models.ProtocolSpec
	if err := e.h.db.Protocols().FindOne(ctx, filter).Decode(&proto); err != nil {
		return nil, fmt.Errorf("protocol not found")
	}
	return map[string]any{"protocol": protocolSummary(&proto)}, nil
}

func (e *aiToolExecutor) listFields(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Start       string `json:"start"`
		End         string `json:"end"`
		LastMinutes int    `json:"last_minutes"`
		Limit       int    `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxSeriesSpan)
	if err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, aiDefaultFieldList, aiMaxFieldListCap)

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	filter := e.boardTimeFilter(window)
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$project", Value: bson.M{
			"kv": bson.M{"$objectToArray": bson.M{"$ifNull": bson.A{"$parsed_fields", bson.M{}}}},
		}}},
		{{Key: "$unwind", Value: "$kv"}},
		{{Key: "$group", Value: bson.M{
			"_id":   "$kv.k",
			"count": bson.M{"$sum": 1},
			"numeric": bson.M{"$sum": bson.M{"$cond": bson.A{
				bson.M{"$in": bson.A{
					bson.M{"$type": "$kv.v"},
					bson.A{"double", "int", "long", "decimal"},
				}},
				1,
				0,
			}}},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "count", Value: -1}, {Key: "_id", Value: 1}}}},
		{{Key: "$limit", Value: int64(limit)}},
	}

	cursor, err := e.h.db.UartData().Aggregate(ctx, pipeline, options.Aggregate().SetAllowDiskUse(true).SetBatchSize(200))
	if err != nil {
		return nil, fmt.Errorf("list fields: %w", err)
	}
	defer cursor.Close(ctx)

	type fieldRow struct {
		Name    string `bson:"_id"`
		Count   int64  `bson:"count"`
		Numeric int64  `bson:"numeric"`
	}
	fields := make([]map[string]any, 0, limit)
	for cursor.Next(ctx) {
		var row fieldRow
		if err := cursor.Decode(&row); err != nil {
			continue
		}
		fields = append(fields, map[string]any{
			"name":    row.Name,
			"count":   row.Count,
			"numeric": row.Numeric > 0,
		})
	}
	return map[string]any{
		"fields": fields,
		"count":  len(fields),
		"start":  window.Start,
		"end":    window.End,
	}, cursor.Err()
}

func (e *aiToolExecutor) stats(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Field       string `json:"field"`
		Start       string `json:"start"`
		End         string `json:"end"`
		LastMinutes int    `json:"last_minutes"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	field := strings.TrimSpace(args.Field)
	if err := validateFieldName(field); err != nil {
		return nil, err
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxSeriesSpan)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	filter := e.boardTimeFilter(window)
	stats, err := e.fieldStats(ctx, filter, field)
	if err != nil {
		return nil, err
	}
	frames, err := e.h.db.UartData().CountDocuments(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("count frames: %w", err)
	}
	return map[string]any{
		"field":  field,
		"start":  window.Start,
		"end":    window.End,
		"frames": frames,
		"stats":  stats,
	}, nil
}

func (e *aiToolExecutor) querySeries(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Field        string `json:"field"`
		Start        string `json:"start"`
		End          string `json:"end"`
		LastMinutes  int    `json:"last_minutes"`
		Limit        int    `json:"limit"`
		IncludeStats *bool  `json:"include_stats"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	field := strings.TrimSpace(args.Field)
	if err := validateFieldName(field); err != nil {
		return nil, err
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxSeriesSpan)
	if err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, aiDefaultPointCap, aiMaxPointCap)
	includeStats := true
	if args.IncludeStats != nil {
		includeStats = *args.IncludeStats
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	items := []models.VizItem{{
		ID:        "ai-series",
		Label:     field,
		Visible:   true,
		FieldRef:  models.FieldRef{ProtocolID: e.protocolID, FieldName: field},
		ChartType: "line",
	}}
	filter := e.boardTimeFilter(window)
	data, meta, err := e.h.queryVizSeries(ctx, filter, items, limit)
	if err != nil {
		return nil, fmt.Errorf("query series: %w", err)
	}

	points := make([]aiSeriesPoint, 0, len(data))
	for _, point := range data {
		value, ok := extractVizValue(point.Values[field])
		if !ok {
			continue
		}
		points = append(points, aiSeriesPoint{Timestamp: point.Timestamp, Value: value})
	}

	result := map[string]any{
		"field":  field,
		"start":  window.Start,
		"end":    window.End,
		"points": points,
		"meta":   meta,
	}
	if includeStats {
		stats, err := e.fieldStats(ctx, filter, field)
		if err == nil {
			result["stats"] = stats
		}
	}
	return result, nil
}

func (e *aiToolExecutor) findEvents(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Field              string   `json:"field"`
		Op                 string   `json:"op"`
		Value              *float64 `json:"value"`
		Start              string   `json:"start"`
		End                string   `json:"end"`
		LastMinutes        int      `json:"last_minutes"`
		MinDurationSeconds float64  `json:"min_duration_seconds"`
		Limit              int      `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	field := strings.TrimSpace(args.Field)
	if err := validateFieldName(field); err != nil {
		return nil, err
	}
	op := strings.TrimSpace(args.Op)
	if !validEventOp(op) {
		return nil, fmt.Errorf("op must be one of >, >=, <, <=, ==, !=")
	}
	if args.Value == nil {
		return nil, fmt.Errorf("value is required")
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxEventSpan)
	if err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, aiDefaultEventCap, aiMaxEventCap)
	minDuration := time.Duration(args.MinDurationSeconds * float64(time.Second))
	if minDuration < 0 {
		minDuration = 0
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	samples, scanned, total, err := e.scanFieldSamples(ctx, e.boardTimeFilter(window), field, aiMaxEventScan)
	if err != nil {
		return nil, err
	}

	events := detectEvents(samples, op, *args.Value, minDuration)
	if len(events) > limit {
		sort.Slice(events, func(i, j int) bool {
			return events[i].DurationSeconds > events[j].DurationSeconds
		})
		events = events[:limit]
		sort.Slice(events, func(i, j int) bool {
			return events[i].Start.Before(events[j].Start)
		})
	}

	return map[string]any{
		"field":        field,
		"op":           op,
		"value":        *args.Value,
		"start":        window.Start,
		"end":          window.End,
		"scanned":      scanned,
		"total_frames": total,
		"truncated":    total > int64(scanned),
		"event_count":  len(events),
		"events":       events,
	}, nil
}

func (e *aiToolExecutor) scanFieldSamples(
	ctx context.Context,
	filter bson.M,
	field string,
	maxDocs int,
) ([]eventSample, int, int64, error) {
	total, err := e.h.db.UartData().CountDocuments(ctx, filter)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("count frames: %w", err)
	}
	scanLimit := int64(maxDocs)
	if total < scanLimit {
		scanLimit = total
	}
	cursor, err := e.h.db.UartData().Find(ctx, filter,
		options.Find().
			SetSort(bson.M{"timestamp": 1}).
			SetProjection(bson.M{"timestamp": 1, "parsed_fields": 1}).
			SetBatchSize(1000).
			SetLimit(scanLimit),
	)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("scan frames: %w", err)
	}
	defer cursor.Close(ctx)

	samples := make([]eventSample, 0, minInt(int(scanLimit), 4096))
	scanned := 0
	for cursor.Next(ctx) {
		var doc vizSampleDoc
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		scanned++
		value, ok := extractVizValue(doc.ParsedFields[field])
		if !ok {
			continue
		}
		samples = append(samples, eventSample{Timestamp: doc.Timestamp, Value: value})
	}
	if err := cursor.Err(); err != nil {
		return nil, 0, 0, fmt.Errorf("scan frames: %w", err)
	}
	return samples, scanned, total, nil
}

func (e *aiToolExecutor) findAnomalies(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Field       string  `json:"field"`
		Method      string  `json:"method"`
		Threshold   float64 `json:"threshold"`
		Start       string  `json:"start"`
		End         string  `json:"end"`
		LastMinutes int     `json:"last_minutes"`
		Limit       int     `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	field := strings.TrimSpace(args.Field)
	if err := validateFieldName(field); err != nil {
		return nil, err
	}
	method := strings.ToLower(strings.TrimSpace(args.Method))
	if method == "" {
		method = "zscore"
	}
	threshold := args.Threshold
	if threshold <= 0 {
		switch method {
		case "iqr":
			threshold = 1.5
		case "change_point":
			threshold = 0.3
		default:
			threshold = 3
		}
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxEventSpan)
	if err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, 20, 100)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	samples, scanned, total, err := e.scanFieldSamples(ctx, e.boardTimeFilter(window), field, aiMaxEventScan)
	if err != nil {
		return nil, err
	}
	summary, points, err := detectAnomalies(samples, method, threshold, limit)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"field":        field,
		"start":        window.Start,
		"end":          window.End,
		"scanned":      scanned,
		"total_frames": total,
		"truncated":    total > int64(scanned),
		"summary":      summary,
		"anomalies":    points,
	}, nil
}

type sessionComparison struct {
	SessionID    string       `json:"session_id"`
	Name         string       `json:"name"`
	Start        time.Time    `json:"start"`
	End          time.Time    `json:"end"`
	Frames       int64        `json:"frames"`
	Stats        aiFieldStats `json:"stats"`
	DeltaPercent *float64     `json:"delta_percent,omitempty"`
}

func (e *aiToolExecutor) compareSessions(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		SessionIDs []string `json:"session_ids"`
		Field      string   `json:"field"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	field := strings.TrimSpace(args.Field)
	if err := validateFieldName(field); err != nil {
		return nil, err
	}
	if len(args.SessionIDs) > 5 {
		return nil, fmt.Errorf("at most 5 sessions can be compared")
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var sessions []models.Session
	if len(args.SessionIDs) == 0 {
		cursor, err := e.h.db.Sessions().Find(ctx, bson.M{"board_id": e.boardID},
			options.Find().SetSort(bson.M{"start_time": -1}).SetLimit(2),
		)
		if err != nil {
			return nil, fmt.Errorf("load sessions: %w", err)
		}
		defer cursor.Close(ctx)
		if err := cursor.All(ctx, &sessions); err != nil {
			return nil, fmt.Errorf("load sessions: %w", err)
		}
	} else {
		cursor, err := e.h.db.Sessions().Find(ctx, bson.M{
			"_id":      bson.M{"$in": args.SessionIDs},
			"board_id": e.boardID,
		})
		if err != nil {
			return nil, fmt.Errorf("load sessions: %w", err)
		}
		defer cursor.Close(ctx)
		var found []models.Session
		if err := cursor.All(ctx, &found); err != nil {
			return nil, fmt.Errorf("load sessions: %w", err)
		}
		byID := make(map[string]models.Session, len(found))
		for _, session := range found {
			byID[session.ID] = session
		}
		for _, id := range args.SessionIDs {
			if session, ok := byID[id]; ok {
				sessions = append(sessions, session)
			}
		}
	}
	if len(sessions) == 0 {
		return nil, fmt.Errorf("no matching sessions found for this board")
	}

	comparisons := make([]sessionComparison, 0, len(sessions))
	var baseline *float64
	for _, session := range sessions {
		start := session.StartTime
		end := session.EndTime
		if end.IsZero() || end.Before(start) {
			end = time.Now().UTC()
		}
		filter := bson.M{
			"board_id":  e.boardID,
			"timestamp": bson.M{"$gte": start, "$lte": end},
		}
		stats, err := e.fieldStats(ctx, filter, field)
		if err != nil {
			return nil, err
		}
		frames, err := e.h.db.UartData().CountDocuments(ctx, filter)
		if err != nil {
			return nil, fmt.Errorf("count session frames: %w", err)
		}
		comparison := sessionComparison{
			SessionID: session.ID,
			Name:      session.Name,
			Start:     start,
			End:       end,
			Frames:    frames,
			Stats:     stats,
		}
		if stats.Avg != nil {
			if baseline == nil {
				value := *stats.Avg
				baseline = &value
			} else {
				comparison.DeltaPercent = percentChange(*baseline, *stats.Avg)
			}
		}
		comparisons = append(comparisons, comparison)
	}

	return map[string]any{
		"field":    field,
		"sessions": comparisons,
		"count":    len(comparisons),
	}, nil
}

func (e *aiToolExecutor) listSessions(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Start string `json:"start"`
		End   string `json:"end"`
		Limit int    `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, 20, 100)
	filter := bson.M{"board_id": e.boardID}
	timeFilter := bson.M{}
	if strings.TrimSpace(args.Start) != "" {
		t, err := parseAITime(args.Start)
		if err != nil {
			return nil, fmt.Errorf("invalid start time: %w", err)
		}
		timeFilter["$gte"] = t
	}
	if strings.TrimSpace(args.End) != "" {
		t, err := parseAITime(args.End)
		if err != nil {
			return nil, fmt.Errorf("invalid end time: %w", err)
		}
		timeFilter["$lte"] = t
	}
	if len(timeFilter) > 0 {
		filter["start_time"] = timeFilter
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cursor, err := e.h.db.Sessions().Find(ctx, filter,
		options.Find().SetSort(bson.M{"start_time": -1}).SetLimit(int64(limit)),
	)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer cursor.Close(ctx)

	sessions := make([]map[string]any, 0, limit)
	for cursor.Next(ctx) {
		var session models.Session
		if err := cursor.Decode(&session); err != nil {
			continue
		}
		sessions = append(sessions, map[string]any{
			"id":          session.ID,
			"name":        session.Name,
			"description": session.Description,
			"start_time":  session.StartTime,
			"end_time":    session.EndTime,
			"tags":        session.Tags,
		})
	}
	return map[string]any{"sessions": sessions, "count": len(sessions)}, cursor.Err()
}

func (e *aiToolExecutor) queryRaw(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Start       string `json:"start"`
		End         string `json:"end"`
		LastMinutes int    `json:"last_minutes"`
		Direction   string `json:"direction"`
		Limit       int    `json:"limit"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	direction := strings.ToUpper(strings.TrimSpace(args.Direction))
	if direction != "" && direction != "TX" && direction != "RX" {
		return nil, fmt.Errorf("direction must be TX or RX")
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxRawSpan)
	if err != nil {
		return nil, err
	}
	limit := clampAILimit(args.Limit, aiDefaultRawCap, aiMaxRawCap)

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	filter := e.boardTimeFilter(window)
	if direction != "" {
		filter["direction"] = direction
	}
	cursor, err := e.h.db.UartData().Find(ctx, filter,
		options.Find().
			SetSort(bson.M{"timestamp": -1}).
			SetLimit(int64(limit)).
			SetProjection(bson.M{"timestamp": 1, "direction": 1, "raw_hex": 1, "parsed_fields": 1}),
	)
	if err != nil {
		return nil, fmt.Errorf("query raw: %w", err)
	}
	defer cursor.Close(ctx)

	samples := make([]map[string]any, 0, limit)
	for cursor.Next(ctx) {
		var doc models.UartData
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		rawHex := doc.RawHex
		if len(rawHex) > 1024 {
			rawHex = rawHex[:1024] + "…"
		}
		samples = append(samples, map[string]any{
			"timestamp":     doc.Timestamp,
			"direction":     doc.Direction,
			"raw_hex":       rawHex,
			"parsed_fields": doc.ParsedFields,
		})
	}
	return map[string]any{
		"start":   window.Start,
		"end":     window.End,
		"samples": samples,
		"count":   len(samples),
	}, cursor.Err()
}

func (e *aiToolExecutor) proposeChart(ctx context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Fields        []string `json:"fields"`
		Start         string   `json:"start"`
		End           string   `json:"end"`
		LastMinutes   int      `json:"last_minutes"`
		Aggregation   string   `json:"aggregation"`
		BucketSeconds int      `json:"bucket_seconds"`
		Title         string   `json:"title"`
	}
	if err := decodeToolArgs(raw, &args); err != nil {
		return nil, err
	}
	if len(args.Fields) == 0 {
		return nil, fmt.Errorf("at least one field is required")
	}
	if len(args.Fields) > 8 {
		return nil, fmt.Errorf("at most 8 fields are allowed")
	}
	fields := make([]string, 0, len(args.Fields))
	seen := make(map[string]bool)
	for _, field := range args.Fields {
		field = strings.TrimSpace(field)
		if err := validateFieldName(field); err != nil {
			return nil, err
		}
		if !seen[field] {
			seen[field] = true
			fields = append(fields, field)
		}
	}
	window, err := e.window(args.Start, args.End, args.LastMinutes, aiMaxSeriesSpan)
	if err != nil {
		return nil, err
	}
	aggregation := strings.ToLower(strings.TrimSpace(args.Aggregation))
	switch aggregation {
	case "", "raw", "avg", "min", "max":
	default:
		return nil, fmt.Errorf("aggregation must be raw, avg, min, or max")
	}
	if aggregation == "" {
		aggregation = "raw"
	}
	bucketSeconds := args.BucketSeconds
	if bucketSeconds <= 0 {
		bucketSeconds = defaultChartBucketSeconds(window.Start, window.End)
	} else if bucketSeconds > 86400 {
		bucketSeconds = 86400
	}
	title := strings.TrimSpace(args.Title)
	if title == "" {
		title = strings.Join(fields, ", ")
	}
	return ai.ChartSpec{
		BoardID:       e.boardID,
		ProtocolID:    e.protocolID,
		Fields:        fields,
		Start:         window.Start.Format(time.RFC3339),
		End:           window.End.Format(time.RFC3339),
		Aggregation:   aggregation,
		BucketSeconds: bucketSeconds,
		Title:         title,
	}, nil
}

func defaultChartBucketSeconds(start, end time.Time) int {
	if end.Before(start) {
		return 60
	}
	span := end.Sub(start)
	switch {
	case span <= time.Hour:
		return 60
	case span <= 6*time.Hour:
		return 300
	case span <= 24*time.Hour:
		return 900
	default:
		return 3600
	}
}

func (e *aiToolExecutor) fieldStats(ctx context.Context, filter bson.M, field string) (aiFieldStats, error) {
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$project", Value: bson.M{
			"v": bson.M{"$arrayElemAt": bson.A{
				bson.M{"$map": bson.M{
					"input": bson.M{"$filter": bson.M{
						"input": bson.M{"$objectToArray": bson.M{"$ifNull": bson.A{"$parsed_fields", bson.M{}}}},
						"as":    "p",
						"cond":  bson.M{"$eq": bson.A{"$$p.k", field}},
					}},
					"as": "p",
					"in": "$$p.v",
				}},
				0,
			}},
		}}},
		{{Key: "$match", Value: bson.M{
			"v": bson.M{"$type": bson.A{"double", "int", "long", "decimal"}},
		}}},
		{{Key: "$group", Value: bson.M{
			"_id":   nil,
			"count": bson.M{"$sum": 1},
			"min":   bson.M{"$min": "$v"},
			"max":   bson.M{"$max": "$v"},
			"avg":   bson.M{"$avg": "$v"},
		}}},
	}

	cursor, err := e.h.db.UartData().Aggregate(ctx, pipeline, options.Aggregate().SetAllowDiskUse(true))
	if err != nil {
		return aiFieldStats{}, fmt.Errorf("field stats: %w", err)
	}
	defer cursor.Close(ctx)

	var rows []struct {
		Count int64    `bson:"count"`
		Min   *float64 `bson:"min"`
		Max   *float64 `bson:"max"`
		Avg   *float64 `bson:"avg"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return aiFieldStats{}, fmt.Errorf("field stats: %w", err)
	}
	if len(rows) == 0 {
		return aiFieldStats{}, nil
	}
	return aiFieldStats{Count: rows[0].Count, Min: rows[0].Min, Max: rows[0].Max, Avg: rows[0].Avg}, nil
}

func validEventOp(op string) bool {
	switch op {
	case ">", ">=", "<", "<=", "==", "!=":
		return true
	default:
		return false
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var (
	aiSchemaListBoards = json.RawMessage(`{
		"type":"object",
		"properties":{
			"query":{"type":"string","description":"Optional name, UID, or location search text."},
			"limit":{"type":"integer","minimum":1,"maximum":100}
		},
		"additionalProperties":false
	}`)
	aiSchemaGetBoard = json.RawMessage(`{
		"type":"object",
		"properties":{
			"board_id":{"type":"string","description":"Board id, name, UID, or WiFi MAC. Defaults to the selected board."},
			"uid":{"type":"string"}
		},
		"additionalProperties":false
	}`)
	aiSchemaListProtocols = json.RawMessage(`{
		"type":"object",
		"properties":{"limit":{"type":"integer","minimum":1,"maximum":100}},
		"additionalProperties":false
	}`)
	aiSchemaGetProtocol = json.RawMessage(`{
		"type":"object",
		"properties":{
			"protocol_id":{"type":"string"},
			"name":{"type":"string"}
		},
		"additionalProperties":false
	}`)
	aiSchemaListFields = json.RawMessage(`{
		"type":"object",
		"properties":{
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":10080},
			"limit":{"type":"integer","minimum":1,"maximum":200}
		},
		"additionalProperties":false
	}`)
	aiSchemaStats = json.RawMessage(`{
		"type":"object",
		"properties":{
			"field":{"type":"string","description":"Exact parsed field name, e.g. payload.temperature_celsius."},
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":10080}
		},
		"required":["field"],
		"additionalProperties":false
	}`)
	aiSchemaQuerySeries = json.RawMessage(`{
		"type":"object",
		"properties":{
			"field":{"type":"string","description":"Exact parsed field name."},
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":10080},
			"limit":{"type":"integer","minimum":1,"maximum":1000},
			"include_stats":{"type":"boolean"}
		},
		"required":["field"],
		"additionalProperties":false
	}`)
	aiSchemaFindEvents = json.RawMessage(`{
		"type":"object",
		"properties":{
			"field":{"type":"string","description":"Exact parsed numeric field name."},
			"op":{"type":"string","enum":[">",">=","<","<=","==","!="]},
			"value":{"type":"number"},
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":1440},
			"min_duration_seconds":{"type":"number","minimum":0},
			"limit":{"type":"integer","minimum":1,"maximum":200}
		},
		"required":["field","op","value"],
		"additionalProperties":false
	}`)
	aiSchemaListSessions = json.RawMessage(`{
		"type":"object",
		"properties":{
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"limit":{"type":"integer","minimum":1,"maximum":100}
		},
		"additionalProperties":false
	}`)
	aiSchemaFindAnomalies = json.RawMessage(`{
		"type":"object",
		"properties":{
			"field":{"type":"string","description":"Exact parsed numeric field name."},
			"method":{"type":"string","enum":["zscore","iqr","change_point"],"description":"zscore (default), iqr, or change_point."},
			"threshold":{"type":"number","minimum":0,"description":"z-score cutoff (default 3), IQR multiplier (default 1.5), or relative change (default 0.3)."},
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":1440},
			"limit":{"type":"integer","minimum":1,"maximum":100}
		},
		"required":["field"],
		"additionalProperties":false
	}`)
	aiSchemaCompareSessions = json.RawMessage(`{
		"type":"object",
		"properties":{
			"session_ids":{"type":"array","items":{"type":"string"},"maxItems":5,"description":"Omit to compare the two most recent sessions."},
			"field":{"type":"string","description":"Exact parsed numeric field name."}
		},
		"required":["field"],
		"additionalProperties":false
	}`)
	aiSchemaQueryRaw = json.RawMessage(`{
		"type":"object",
		"properties":{
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":1440},
			"direction":{"type":"string","enum":["TX","RX"]},
			"limit":{"type":"integer","minimum":1,"maximum":50}
		},
		"additionalProperties":false
	}`)
	aiSchemaProposeChart = json.RawMessage(`{
		"type":"object",
		"properties":{
			"fields":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":8},
			"start":{"type":"string","format":"date-time"},
			"end":{"type":"string","format":"date-time"},
			"last_minutes":{"type":"integer","minimum":1,"maximum":10080},
			"aggregation":{"type":"string","enum":["raw","avg","min","max"]},
			"bucket_seconds":{"type":"integer","minimum":1,"maximum":86400,"description":"Aggregation bucket size. Defaults to 60s/5m/15m/1h based on the range."},
			"title":{"type":"string"}
		},
		"required":["fields"],
		"additionalProperties":false
	}`)
)
