package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type vizCommandEvent struct {
	Timestamp time.Time `json:"timestamp"`
	Direction string    `json:"direction"`
	FID       int       `json:"fid"`
	Kind      string    `json:"kind"`
	Summary   string    `json:"summary"`
	Color     string    `json:"color,omitempty"`
	Style     string    `json:"style,omitempty"`
}

// overlayField describes one value to pull out of a parsed frame.
// vizCommandConfig exposes the protocol's overlay policy so the dashboard can
// show/override it per profile.
type vizCommandConfig struct {
	FID     string `json:"fid"`
	Kind    string `json:"kind"`
	Type    string `json:"type"`
	Visible bool   `json:"visible"`
	Color   string `json:"color,omitempty"`
	Label   string `json:"label,omitempty"`
}

type overlayField struct {
	Name   string   `json:"name"`
	Path   string   `json:"path,omitempty"`
	Paths  []string `json:"paths,omitempty"`
	Format string   `json:"format,omitempty"`
}

// overlayConfig is protocol-defined: which FID becomes a chart event, how it is
// labelled and drawn. Nothing about FIDs or styles is hardcoded in the handler.
type overlayConfig struct {
	FID     string         `json:"fid"`
	Type    string         `json:"type,omitempty"`
	Visible *bool          `json:"visible,omitempty"`
	Kind    string         `json:"kind"`
	Path    string         `json:"path,omitempty"`
	Fields  []overlayField `json:"fields,omitempty"`
	Label   string         `json:"label,omitempty"`
	Color   string         `json:"color,omitempty"`
	Style   string         `json:"style,omitempty"`
	fidNum  int
}

const vizCommandLimit = 20000

func overlayConfigsFromSpec(spec *models.ProtocolSpec) []overlayConfig {
	if spec == nil || spec.ParseRules == nil || spec.ParseRules.Meta == nil {
		return nil
	}
	meta := spec.ParseRules.Meta
	dataTypes := dataTypesFromMeta(meta)
	raw, ok := meta["overlays"]
	if !ok {
		return nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var overlays []overlayConfig
	if err := json.Unmarshal(data, &overlays); err != nil {
		return nil
	}
	out := make([]overlayConfig, 0, len(overlays))
	for _, overlay := range overlays {
		fid, err := parseFIDValue(overlay.FID)
		if err != nil {
			continue
		}
		// The rule set classifies frames as continuous series or events.
		// Series frames are never drawn as event markers, and hidden events are
		// skipped before querying.
		if kind, ok := dataTypes[fid]; ok && kind == "series" {
			continue
		}
		if overlay.Type != "" && overlay.Type != "event" {
			continue
		}
		overlay.fidNum = fid
		if overlay.Style == "" {
			overlay.Style = "vline"
		}
		if overlay.Type == "" {
			overlay.Type = "event"
		}
		out = append(out, overlay)
	}
	return out
}

func dataTypesFromMeta(meta map[string]interface{}) map[int]string {
	out := make(map[int]string)
	raw, ok := meta["data_types"]
	if !ok {
		return out
	}
	m, ok := asMap(raw)
	if !ok {
		return out
	}
	for key, value := range m {
		fid, err := parseFIDValue(key)
		if err != nil {
			continue
		}
		if kind, ok := value.(string); ok && kind != "" {
			out[fid] = kind
		}
	}
	return out
}

// VizCommands lists configured control-frame overlays for a board. The FID set,
// labels, colors and styles come from the protocol's _meta.overlays.
func (h *Handler) VizCommands(c *gin.Context) {
	boardID := strings.TrimSpace(c.Query("board_id"))
	if boardID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "board_id required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	// Prefer the board's own protocol so dashboard edits (enums, display flags)
	// take effect immediately; fall back to the built-in combined rules.
	spec := protocol.MonitoringControlProtocolSpec()
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&board); err == nil && board.ProtocolID != "" {
		var proto models.ProtocolSpec
		if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": board.ProtocolID}).Decode(&proto); err == nil && proto.ParseRules != nil {
			if len(collectEventFields(proto.ParseRules)) > 0 || len(overlayConfigsFromSpec(&proto)) > 0 {
				spec = proto
			}
		}
	}

	overlays := overlayConfigsFromSpec(&spec)
	eventFields := collectEventFields(spec.ParseRules)
	if len(overlays) == 0 && len(eventFields) == 0 {
		c.JSON(http.StatusOK, gin.H{"items": []vizCommandEvent{}, "total": 0})
		return
	}
	enums := enumsFromMeta(spec.ParseRules.Meta)
	functionArgs := functionArgsFromMeta(spec.ParseRules.Meta)
	fieldsByFID := make(map[int][]eventFieldSpec)
	fidSet := make(map[int]bool)
	for _, field := range eventFields {
		fieldsByFID[field.FID] = append(fieldsByFID[field.FID], field)
		fidSet[field.FID] = true
	}
	for _, overlay := range overlays {
		fidSet[overlay.fidNum] = true
	}

	filter := bson.M{
		"board_id": boardID,
		"raw_hex":  bson.M{"$regex": fidSetRegexp(fidSet), "$options": "i"},
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

	configs := make([]vizCommandConfig, 0, len(fidSet))
	seenFID := make(map[int]bool)
	for _, overlay := range overlays {
		if seenFID[overlay.fidNum] {
			continue
		}
		seenFID[overlay.fidNum] = true
		visible := overlay.Visible == nil || *overlay.Visible
		configs = append(configs, vizCommandConfig{
			FID:     fmt.Sprintf("0x%02X", overlay.fidNum),
			Kind:    overlay.Kind,
			Type:    overlay.Type,
			Visible: visible,
			Color:   overlay.Color,
			Label:   overlay.Label,
		})
	}
	for _, overlay := range overlays {
		for _, field := range fieldsByFID[overlay.fidNum] {
			if seenFID[field.FID] {
				continue
			}
			seenFID[field.FID] = true
			configs = append(configs, vizCommandConfig{
				FID:     fmt.Sprintf("0x%02X", field.FID),
				Kind:    "event",
				Type:    "event",
				Visible: true,
				Color:   colorForFID(field.FID),
			})
		}
	}
	for fid := range fieldsByFID {
		if seenFID[fid] {
			continue
		}
		seenFID[fid] = true
		configs = append(configs, vizCommandConfig{
			FID:     fmt.Sprintf("0x%02X", fid),
			Kind:    "event",
			Type:    "event",
			Visible: true,
			Color:   colorForFID(fid),
		})
	}

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
		result, err := protocol.Parse(doc.RawHex, &spec)
		if err != nil {
			continue
		}
		fid := asInt(result.Fields["fid"])
		if specs := fieldsByFID[fid]; len(specs) > 0 {
			for _, fieldSpec := range specs {
				for _, entry := range extractEventEntries(result.Fields, fieldSpec.Path) {
					argsText := ""
					if fid == 0xCF && entry.Row != nil {
						if argSpec, ok := functionArgs[asInt(entry.Value)]; ok {
							argsText = formatFunctionArgs(entry.Row, &argSpec, enums)
						} else {
							argsText = formatFunctionArgs(entry.Row, nil, enums)
						}
					}
					label := renderEventLabel(fieldSpec, entry.Value, enums)
					if argsText != "" {
						label = fmt.Sprintf("%s (%s)", label, argsText)
					}
					events = append(events, vizCommandEvent{
						Timestamp: doc.Timestamp,
						Direction: doc.Direction,
						FID:       fid,
						Kind:      "event",
						Summary:   label,
						Color:     colorForFID(fid),
						Style:     "vline",
					})
				}
			}
			continue
		}
		event, ok := commandEventFromParsed(result, doc.Timestamp, doc.Direction, overlays)
		if ok {
			events = append(events, event)
		}
	}
	if err := cur.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": events, "total": len(events), "config": configs})
}

func fidSetRegexp(fids map[int]bool) string {
	parts := make([]string, 0, len(fids))
	for fid := range fids {
		parts = append(parts, fmt.Sprintf("%02X", fid))
	}
	sort.Strings(parts)
	return "^AA..(" + strings.Join(parts, "|") + ")"
}

func colorForFID(fid int) string {
	switch fid {
	case 0xCF:
		return "#ff9f40"
	case 0xCD:
		return "#40c4ff"
	case 0xCC:
		return "#8bc34a"
	default:
		return "#b0bec5"
	}
}

// overlayFIDRegexp builds the Mongo prefix filter from the configured FIDs so
// the query stays in sync with the protocol.
func overlayFIDRegexp(overlays []overlayConfig) string {
	parts := make([]string, 0, len(overlays))
	for _, overlay := range overlays {
		parts = append(parts, fmt.Sprintf("%02X", overlay.fidNum))
	}
	return "^AA..(" + strings.Join(parts, "|") + ")"
}

func commandEventFromFrame(ts time.Time, direction, rawHex string, spec *models.ProtocolSpec, overlays []overlayConfig) (vizCommandEvent, bool) {
	result, err := protocol.Parse(rawHex, spec)
	if err != nil {
		return vizCommandEvent{}, false
	}
	return commandEventFromParsed(result, ts, direction, overlays)
}

func commandEventFromParsed(result *protocol.ParseResult, ts time.Time, direction string, overlays []overlayConfig) (vizCommandEvent, bool) {
	fidVal := asInt(result.Fields["fid"])
	var overlay *overlayConfig
	for i := range overlays {
		if overlays[i].fidNum == fidVal {
			overlay = &overlays[i]
			break
		}
	}
	if overlay == nil {
		return vizCommandEvent{}, false
	}

	values, named := extractOverlayValues(result.Fields, overlay)
	label := renderOverlayLabel(overlay.Label, overlay.Kind, values, named)
	return vizCommandEvent{
		Timestamp: ts,
		Direction: direction,
		FID:       fidVal,
		Kind:      overlay.Kind,
		Summary:   label,
		Color:     overlay.Color,
		Style:     overlay.Style,
	}, true
}

func extractOverlayValues(fields map[string]interface{}, overlay *overlayConfig) ([]string, map[string]string) {
	named := make(map[string]string, len(overlay.Fields))
	if overlay.Path != "" {
		items := asSlice(getPath(fields, overlay.Path))
		values := make([]string, 0, len(items))
		for _, item := range items {
			row, ok := asMap(item)
			if !ok {
				continue
			}
			for _, field := range overlay.Fields {
				value := fieldValue(row, field)
				if value == "" {
					continue
				}
				values = append(values, value)
				if field.Name != "" {
					named[field.Name] = value
				}
			}
		}
		return values, named
	}

	values := make([]string, 0, len(overlay.Fields))
	for _, field := range overlay.Fields {
		value := fieldValue(fields, field)
		if value == "" {
			continue
		}
		values = append(values, value)
		if field.Name != "" {
			named[field.Name] = value
		}
	}
	return values, named
}

func renderOverlayLabel(template, kind string, values []string, named map[string]string) string {
	if template == "" {
		if len(values) > 0 {
			return strings.Join(values, ", ")
		}
		return kind
	}
	out := strings.ReplaceAll(template, "{values}", strings.Join(values, ", "))
	for name, value := range named {
		out = strings.ReplaceAll(out, "{"+name+"}", value)
	}
	return out
}

func fieldValue(source map[string]interface{}, field overlayField) string {
	paths := make([]string, 0, len(field.Paths)+1)
	if field.Path != "" {
		paths = append(paths, field.Path)
	}
	paths = append(paths, field.Paths...)
	for _, path := range paths {
		if value := formatOverlayValue(getPath(source, path), field.Format); value != "" {
			return value
		}
	}
	return ""
}

func getPath(fields map[string]interface{}, path string) interface{} {
	if fields == nil || path == "" {
		return nil
	}
	// Parsed fields are flattened ("payload.functions"), so try the full key
	// before walking nested maps.
	if value, ok := fields[path]; ok {
		return value
	}
	var current interface{} = fields
	for _, part := range strings.Split(path, ".") {
		m, ok := asMap(current)
		if !ok {
			return nil
		}
		current = m[part]
	}
	return current
}

func formatOverlayValue(value interface{}, format string) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	}
	n, ok := toIntValue(value)
	if !ok {
		return fmt.Sprintf("%v", value)
	}
	if format == "hex" {
		return fmt.Sprintf("%02X", n)
	}
	return strconv.Itoa(n)
}

func toIntValue(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int8:
		return int(v), true
	case int16:
		return int(v), true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case uint8:
		return int(v), true
	case uint16:
		return int(v), true
	case uint32:
		return int(v), true
	case uint64:
		return int(v), true
	case float32:
		return int(v), true
	case float64:
		return int(v), true
	default:
		return 0, false
	}
}

func parseFIDValue(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, fmt.Errorf("empty fid")
	}
	base := 10
	if strings.HasPrefix(trimmed, "0x") || strings.HasPrefix(trimmed, "0X") {
		trimmed = trimmed[2:]
		base = 16
	}
	value, err := strconv.ParseInt(trimmed, base, 32)
	if err != nil {
		return 0, err
	}
	return int(value), nil
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
	if n, ok := toIntValue(value); ok {
		return n
	}
	return 0
}
