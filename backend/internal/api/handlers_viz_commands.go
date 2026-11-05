package api

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type vizCommandFunction struct {
	FunctionID int      `json:"function_id"`
	ArgCount   int      `json:"arg_count,omitempty"`
	Args       []string `json:"args,omitempty"`
}

type vizCommandResult struct {
	FunctionID int  `json:"function_id,omitempty"`
	Flag       int  `json:"flag,omitempty"`
	ErrorCode  int  `json:"error_code,omitempty"`
	IsError    bool `json:"is_error,omitempty"`
	IsMonitor  bool `json:"is_monitor,omitempty"`
}

type vizCommandEvent struct {
	Timestamp time.Time            `json:"timestamp"`
	Direction string               `json:"direction"`
	FID       int                  `json:"fid"`
	Kind      string               `json:"kind"`
	Summary   string               `json:"summary"`
	Functions []vizCommandFunction `json:"functions,omitempty"`
	Results   []vizCommandResult   `json:"results,omitempty"`
	RecvFID   int                  `json:"recv_fid,omitempty"`
	ErrorCode int                  `json:"error_code,omitempty"`
}

const (
	vizCommandLimit     = 20000
	vizCommandFIDRegexp = "^AA..(CF|CD|CC)"
)

// VizCommands lists control frames (call/result/ack) for a board so the chart
// can overlay them on monitoring series.
func (h *Handler) VizCommands(c *gin.Context) {
	boardID := strings.TrimSpace(c.Query("board_id"))
	if boardID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "board_id required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	filter := bson.M{
		"board_id": boardID,
		"raw_hex":  bson.M{"$regex": vizCommandFIDRegexp, "$options": "i"},
	}
	if direction := c.Query("direction"); direction != "" {
		filter["direction"] = direction
	}
	timeFilter := bson.M{}
	if since := c.Query("since"); since != "" {
		t, err := parseTimeQuery(since)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid since"})
			return
		}
		timeFilter["$gte"] = t
	}
	if until := c.Query("until"); until != "" {
		t, err := parseTimeQuery(until)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid until"})
			return
		}
		timeFilter["$lte"] = t
	}
	if len(timeFilter) > 0 {
		filter["timestamp"] = timeFilter
	}

	cur, err := h.db.UartData().Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "timestamp", Value: 1}}).
		SetLimit(vizCommandLimit).
		SetProjection(bson.M{"raw_hex": 1, "timestamp": 1, "direction": 1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cur.Close(ctx)

	spec := protocol.MonitoringControlProtocolSpec()
	events := make([]vizCommandEvent, 0, 128)
	for cur.Next(ctx) {
		var doc struct {
			RawHex    string    `bson:"raw_hex"`
			Timestamp time.Time `bson:"timestamp"`
			Direction string    `bson:"direction"`
		}
		if err := cur.Decode(&doc); err != nil {
			continue
		}
		event, ok := commandEventFromFrame(doc.Timestamp, doc.Direction, doc.RawHex, &spec)
		if ok {
			events = append(events, event)
		}
	}
	if err := cur.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": events, "total": len(events)})
}

func commandEventFromFrame(ts time.Time, direction, rawHex string, spec *models.ProtocolSpec) (vizCommandEvent, bool) {
	result, err := protocol.Parse(rawHex, spec)
	if err != nil {
		return vizCommandEvent{}, false
	}
	fidVal := asInt(result.Fields["fid"])
	event := vizCommandEvent{Timestamp: ts, Direction: direction, FID: fidVal}
	switch fidVal {
	case 0xCF:
		event.Kind = "call"
		functions := extractCommandFunctions(result.Fields["payload.functions"])
		event.Functions = functions
		event.Summary = summarizeFunctions(functions)
	case 0xCD:
		event.Kind = "result"
		results := extractCommandResults(result.Fields["payload.results"])
		event.Results = results
		event.Summary = summarizeResults(results)
	case 0xCC:
		event.Kind = "ack"
		event.RecvFID = asInt(result.Fields["payload.recv_fid"])
		event.ErrorCode = asInt(result.Fields["payload.error_code"])
		event.Summary = fmt.Sprintf("ack 0x%02X", event.RecvFID)
		if event.ErrorCode != 0xF0 {
			event.Summary = fmt.Sprintf("ack 0x%02X err 0x%02X", event.RecvFID, event.ErrorCode)
		}
	default:
		return vizCommandEvent{}, false
	}
	return event, true
}

func extractCommandFunctions(value interface{}) []vizCommandFunction {
	out := []vizCommandFunction{}
	for _, item := range asSlice(value) {
		m, ok := asMap(item)
		if !ok {
			continue
		}
		fn := vizCommandFunction{FunctionID: asInt(m["function_id"]), ArgCount: asInt(m["arg_count"])}
		for _, arg := range asSlice(m["args"]) {
			am, ok := asMap(arg)
			if !ok {
				continue
			}
			if val, ok := am["val"].(string); ok && val != "" {
				fn.Args = append(fn.Args, val)
			}
		}
		out = append(out, fn)
	}
	return out
}

func extractCommandResults(value interface{}) []vizCommandResult {
	out := []vizCommandResult{}
	for _, item := range asSlice(value) {
		m, ok := asMap(item)
		if !ok {
			continue
		}
		res := vizCommandResult{Flag: asInt(m["flag"])}
		if nested, ok := asMap(m["result"]); ok {
			res.FunctionID = asInt(nested["function_id"])
		}
		if nested, ok := asMap(m["error"]); ok {
			res.FunctionID = asInt(nested["function_id"])
			res.ErrorCode = asInt(nested["error_code"])
			res.IsError = true
		}
		if nested, ok := asMap(m["monitor"]); ok {
			res.FunctionID = asInt(m["function_id"])
			res.IsMonitor = true
			_ = nested
		}
		out = append(out, res)
	}
	return out
}

func summarizeFunctions(functions []vizCommandFunction) string {
	if len(functions) == 0 {
		return "call"
	}
	parts := make([]string, 0, len(functions))
	for _, fn := range functions {
		label := fmt.Sprintf("fn %d", fn.FunctionID)
		if fn.ArgCount > 0 {
			label += fmt.Sprintf("(%d)", fn.ArgCount)
		}
		parts = append(parts, label)
	}
	return strings.Join(parts, ", ")
}

func summarizeResults(results []vizCommandResult) string {
	if len(results) == 0 {
		return "result"
	}
	parts := make([]string, 0, len(results))
	for _, res := range results {
		switch {
		case res.IsError:
			parts = append(parts, fmt.Sprintf("err %d/0x%02X", res.FunctionID, res.ErrorCode))
		case res.IsMonitor:
			parts = append(parts, fmt.Sprintf("monitor %d", res.FunctionID))
		default:
			parts = append(parts, fmt.Sprintf("ok %d", res.FunctionID))
		}
	}
	return strings.Join(parts, ", ")
}

func asSlice(value interface{}) []interface{} {
	if value == nil {
		return nil
	}
	if s, ok := value.([]interface{}); ok {
		return s
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() != reflect.Slice {
		return nil
	}
	out := make([]interface{}, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		out[i] = rv.Index(i).Interface()
	}
	return out
}

func asMap(value interface{}) (map[string]interface{}, bool) {
	if m, ok := value.(map[string]interface{}); ok {
		return m, true
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() != reflect.Map || rv.Type().Key().Kind() != reflect.String {
		return nil, false
	}
	out := make(map[string]interface{}, rv.Len())
	for _, key := range rv.MapKeys() {
		out[key.String()] = rv.MapIndex(key).Interface()
	}
	return out, true
}

func asInt(value interface{}) int {
	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case uint8:
		return int(v)
	case uint16:
		return int(v)
	default:
		return 0
	}
}
