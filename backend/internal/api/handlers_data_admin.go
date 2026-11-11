package api

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

// Data admin endpoints:
//
//	GET    /api/v1/data/dump?board_id=0015[&since=...][&until=...]
//	DELETE /api/v1/data?board_id=0015&confirm=true[&since=...][&until=...]
//
// The dump is streamed as NDJSON by default so a large board can be exported
// without buffering every document in memory. `format=json` produces a single
// JSON object instead, and `gzip=true` compresses either format.

const dataDumpDefaultInclude = "uart,sessions,temperatures,heartbeats"
const dataDeleteDefaultInclude = "uart,rollups,temperatures,heartbeats"

type dataDeleteStats struct {
	UartData     int64 `json:"uart_data"`
	VizRollups   int64 `json:"viz_rollups"`
	Sessions     int64 `json:"sessions"`
	Temperatures int64 `json:"temperatures"`
	Heartbeats   int64 `json:"heartbeats"`
}

func parseDataInclude(raw, fallback string) (map[string]bool, error) {
	if strings.TrimSpace(raw) == "" {
		raw = fallback
	}
	include := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		switch strings.ToLower(strings.TrimSpace(part)) {
		case "":
			continue
		case "uart", "uart_data", "data":
			include["uart"] = true
		case "sessions", "session":
			include["sessions"] = true
		case "temperatures", "temperature", "temp":
			include["temperatures"] = true
		case "heartbeats", "heartbeat":
			include["heartbeats"] = true
		case "rollups", "rollup", "viz_rollups":
			include["rollups"] = true
		default:
			return nil, fmt.Errorf("unknown include %q", part)
		}
	}
	if len(include) == 0 {
		return nil, fmt.Errorf("include cannot be empty")
	}
	return include, nil
}

func parseDataRange(c *gin.Context) (since, until *time.Time, err error) {
	if raw := c.Query("since"); raw != "" {
		t, parseErr := parseTimeQuery(raw)
		if parseErr != nil {
			return nil, nil, fmt.Errorf("invalid since: %w", parseErr)
		}
		since = &t
	}
	if raw := c.Query("until"); raw != "" {
		t, parseErr := parseTimeQuery(raw)
		if parseErr != nil {
			return nil, nil, fmt.Errorf("invalid until: %w", parseErr)
		}
		until = &t
	}
	if since != nil && until != nil && until.Before(*since) {
		return nil, nil, fmt.Errorf("until must be after since")
	}
	return since, until, nil
}

func timestampRangeFilter(boardID string, since, until *time.Time) bson.M {
	filter := bson.M{"board_id": boardID}
	timeFilter := bson.M{}
	if since != nil {
		timeFilter["$gte"] = *since
	}
	if until != nil {
		timeFilter["$lte"] = *until
	}
	if len(timeFilter) > 0 {
		filter["timestamp"] = timeFilter
	}
	return filter
}

func bucketRangeFilter(boardID string, since, until *time.Time) bson.M {
	filter := timestampRangeFilter(boardID, since, until)
	if ts, ok := filter["timestamp"]; ok {
		delete(filter, "timestamp")
		filter["bucket_start"] = ts
	}
	return filter
}

func sessionRangeFilter(boardID string, since, until *time.Time) bson.M {
	filter := bson.M{"board_id": boardID}
	timeFilter := bson.M{}
	if since != nil {
		timeFilter["$gte"] = *since
	}
	if until != nil {
		timeFilter["$lte"] = *until
	}
	if len(timeFilter) > 0 {
		filter["start_time"] = timeFilter
	}
	return filter
}

func resolveDataBoardID(h *Handler, c *gin.Context, ctx context.Context) (string, error) {
	boardID := strings.TrimSpace(c.Query("board_id"))
	uid := strings.TrimSpace(c.Query("uid"))
	if boardID == "" && uid == "" {
		return "", fmt.Errorf("board_id or uid required")
	}
	resolved, err := h.resolveBoardID(ctx, boardID, uid)
	if err != nil {
		return "", err
	}
	if resolved == "" {
		return "", fmt.Errorf("board not found")
	}
	return resolved, nil
}

type dataDumpSource struct {
	key    string
	stream func(ctx context.Context, limit int64, emit func(any) error) (int64, error)
}

func dumpCursor[T any](
	ctx context.Context,
	cursor *mongo.Cursor,
	limit int64,
	emit func(any) error,
) (int64, error) {
	defer cursor.Close(ctx)
	var count int64
	for cursor.Next(ctx) {
		if limit > 0 && count >= limit {
			break
		}
		var doc T
		if err := cursor.Decode(&doc); err != nil {
			return count, err
		}
		if err := emit(doc); err != nil {
			return count, err
		}
		count++
	}
	return count, cursor.Err()
}

// DumpData streams all captured rows for a board (and optionally its metadata)
// as NDJSON or one JSON object.
func (h *Handler) DumpData(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Minute)
	defer cancel()

	boardID, err := resolveDataBoardID(h, c, ctx)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	since, until, err := parseDataRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	include, err := parseDataInclude(c.Query("include"), dataDumpDefaultInclude)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	format := strings.ToLower(c.DefaultQuery("format", "ndjson"))
	if format != "ndjson" && format != "json" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "format must be ndjson or json"})
		return
	}

	var limit int64
	if raw := c.Query("limit"); raw != "" {
		n, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a non-negative integer"})
			return
		}
		limit = n
	}

	uartFilter, err := h.uartQueryFilter(ctx, c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sources := make([]dataDumpSource, 0, 4)
	if include["uart"] {
		sources = append(sources, dataDumpSource{
			key: "uart",
			stream: func(ctx context.Context, limit int64, emit func(any) error) (int64, error) {
				cursor, err := h.db.UartData().Find(ctx, uartFilter, options.Find().
					SetSort(bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}))
				if err != nil {
					return 0, err
				}
				return dumpCursor[bson.M](ctx, cursor, limit, emit)
			},
		})
	}
	if include["sessions"] {
		filter := sessionRangeFilter(boardID, since, until)
		sources = append(sources, dataDumpSource{
			key: "sessions",
			stream: func(ctx context.Context, limit int64, emit func(any) error) (int64, error) {
				cursor, err := h.db.Sessions().Find(ctx, filter, options.Find().
					SetSort(bson.D{{Key: "start_time", Value: 1}, {Key: "_id", Value: 1}}))
				if err != nil {
					return 0, err
				}
				return dumpCursor[bson.M](ctx, cursor, limit, emit)
			},
		})
	}
	if include["temperatures"] {
		filter := timestampRangeFilter(boardID, since, until)
		sources = append(sources, dataDumpSource{
			key: "temperatures",
			stream: func(ctx context.Context, limit int64, emit func(any) error) (int64, error) {
				cursor, err := h.db.Temperatures().Find(ctx, filter, options.Find().
					SetSort(bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}))
				if err != nil {
					return 0, err
				}
				return dumpCursor[bson.M](ctx, cursor, limit, emit)
			},
		})
	}
	if include["heartbeats"] {
		filter := timestampRangeFilter(boardID, since, until)
		sources = append(sources, dataDumpSource{
			key: "heartbeats",
			stream: func(ctx context.Context, limit int64, emit func(any) error) (int64, error) {
				cursor, err := h.db.Heartbeats().Find(ctx, filter, options.Find().
					SetSort(bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}))
				if err != nil {
					return 0, err
				}
				return dumpCursor[bson.M](ctx, cursor, limit, emit)
			},
		})
	}
	if include["rollups"] {
		filter := bucketRangeFilter(boardID, since, until)
		sources = append(sources, dataDumpSource{
			key: "rollups",
			stream: func(ctx context.Context, limit int64, emit func(any) error) (int64, error) {
				cursor, err := h.db.VizRollups().Find(ctx, filter, options.Find().
					SetSort(bson.D{{Key: "bucket_start", Value: 1}, {Key: "granularity_sec", Value: 1}}))
				if err != nil {
					return 0, err
				}
				return dumpCursor[bson.M](ctx, cursor, limit, emit)
			},
		})
	}

	exportedAt := time.Now().UTC()
	// Prefer the human-friendly board UID (e.g. "0015") in the filename while
	// keeping the internal id in the meta record.
	boardLabel := boardID
	var boardDoc bson.M
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&boardDoc); err == nil {
		if uid, ok := boardDoc["uid"].(string); ok && strings.TrimSpace(uid) != "" {
			boardLabel = uid
		}
	}
	ext := ".ndjson"
	if format == "json" {
		ext = ".json"
	}
	if gzipEnabled(c) {
		c.Header("Content-Encoding", "gzip")
		ext += ".gz"
	}
	filename := fmt.Sprintf("sentinel-%s-%s%s", boardLabel, exportedAt.Format("20060102T150405Z"), ext)
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	if format == "json" {
		c.Header("Content-Type", "application/json; charset=utf-8")
	} else {
		c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
	}

	var out io.Writer = c.Writer
	var gz *gzip.Writer
	if gzipEnabled(c) {
		gz = gzip.NewWriter(c.Writer)
		defer gz.Close()
		out = gz
	}

	meta := gin.H{
		"board_id":    boardID,
		"exported_at": exportedAt,
		"since":       since,
		"until":       until,
		"format":      format,
	}
	counts := make(map[string]int64, len(sources))

	if format == "ndjson" {
		enc := json.NewEncoder(out)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(gin.H{"type": "meta", "meta": meta}); err != nil {
			return
		}
		for _, src := range sources {
			n, streamErr := src.stream(ctx, limit, func(doc any) error {
				return enc.Encode(gin.H{"type": src.key, "data": doc})
			})
			counts[src.key] = n
			if streamErr != nil {
				h.logger.Warn("data dump interrupted", zap.String("board_id", boardID), zap.Error(streamErr))
				return
			}
			flushDump(out, gz)
		}
		_ = enc.Encode(gin.H{"type": "done", "counts": counts})
		return
	}

	// JSON: one object with a streamed array per collection.
	metaJSON, _ := json.Marshal(meta)
	if _, err := fmt.Fprintf(out, `{"meta":%s`, metaJSON); err != nil {
		return
	}
	for _, src := range sources {
		if _, err := fmt.Fprintf(out, `,"%s":[`, src.key); err != nil {
			return
		}
		first := true
		n, streamErr := src.stream(ctx, limit, func(doc any) error {
			payload, marshalErr := json.Marshal(doc)
			if marshalErr != nil {
				return marshalErr
			}
			if !first {
				if _, err := io.WriteString(out, ","); err != nil {
					return err
				}
			}
			first = false
			_, err := out.Write(payload)
			return err
		})
		counts[src.key] = n
		if streamErr != nil {
			h.logger.Warn("data dump interrupted", zap.String("board_id", boardID), zap.Error(streamErr))
			return
		}
		if _, err := io.WriteString(out, "]"); err != nil {
			return
		}
		flushDump(out, gz)
	}
	countsJSON, _ := json.Marshal(counts)
	_, _ = fmt.Fprintf(out, `,"counts":%s}`, countsJSON)
}

func gzipEnabled(c *gin.Context) bool {
	value := strings.ToLower(strings.TrimSpace(c.Query("gzip")))
	return value == "1" || value == "true" || value == "yes"
}

func flushDump(out io.Writer, gz *gzip.Writer) {
	if gz != nil {
		_ = gz.Flush()
		return
	}
	if f, ok := out.(http.Flusher); ok {
		f.Flush()
	}
}

func deleteConfirm(c *gin.Context) bool {
	value := strings.ToLower(strings.TrimSpace(c.Query("confirm")))
	return value == "1" || value == "true" || value == "yes" || value == "delete"
}

// DeleteData removes captured rows for one board. It never deletes the board
// itself or its visualization profiles; use DELETE /boards/:id for a full
// cascade delete. confirm=true is required because the call is destructive.
func (h *Handler) DeleteData(c *gin.Context) {
	if !deleteConfirm(c) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "confirm=true is required to delete data"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	boardID, err := resolveDataBoardID(h, c, ctx)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	since, until, err := parseDataRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	include, err := parseDataInclude(c.Query("include"), dataDeleteDefaultInclude)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var stats dataDeleteStats
	deleteRange := func(collection *mongo.Collection, filter bson.M) (int64, error) {
		res, err := collection.DeleteMany(ctx, filter)
		if err != nil {
			return 0, err
		}
		return res.DeletedCount, nil
	}

	if include["uart"] {
		filter := timestampRangeFilter(boardID, since, until)
		if sessionID := c.Query("session_id"); sessionID != "" {
			filter["session_id"] = sessionID
		}
		if direction := c.Query("direction"); direction != "" {
			filter["direction"] = direction
		}
		n, err := deleteRange(h.db.UartData(), filter)
		if err != nil {
			h.logger.Error("failed to delete uart data", zap.String("board_id", boardID), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete uart data"})
			return
		}
		stats.UartData = n
		if _, err := h.db.UartPresence().DeleteMany(ctx, bucketRangeFilter(boardID, since, until)); err != nil {
			h.logger.Warn("failed to delete uart presence", zap.String("board_id", boardID), zap.Error(err))
		}
	}
	if include["rollups"] {
		n, err := deleteRange(h.db.VizRollups(), bucketRangeFilter(boardID, since, until))
		if err != nil {
			h.logger.Error("failed to delete viz rollups", zap.String("board_id", boardID), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete viz rollups"})
			return
		}
		stats.VizRollups = n
	}
	if include["temperatures"] {
		n, err := deleteRange(h.db.Temperatures(), timestampRangeFilter(boardID, since, until))
		if err != nil {
			h.logger.Error("failed to delete temperatures", zap.String("board_id", boardID), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete temperatures"})
			return
		}
		stats.Temperatures = n
	}
	if include["heartbeats"] {
		n, err := deleteRange(h.db.Heartbeats(), timestampRangeFilter(boardID, since, until))
		if err != nil {
			h.logger.Error("failed to delete heartbeats", zap.String("board_id", boardID), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete heartbeats"})
			return
		}
		stats.Heartbeats = n
	}
	if include["sessions"] {
		n, err := deleteRange(h.db.Sessions(), sessionRangeFilter(boardID, since, until))
		if err != nil {
			h.logger.Error("failed to delete sessions", zap.String("board_id", boardID), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete sessions"})
			return
		}
		stats.Sessions = n
	}

	h.logger.Info("data deleted",
		zap.String("board_id", boardID),
		zap.Int64("uart_data", stats.UartData),
		zap.Int64("viz_rollups", stats.VizRollups),
		zap.Int64("sessions", stats.Sessions),
		zap.Int64("temperatures", stats.Temperatures),
		zap.Int64("heartbeats", stats.Heartbeats),
	)
	c.JSON(http.StatusOK, gin.H{
		"board_id": boardID,
		"since":    since,
		"until":    until,
		"deleted":  stats,
	})
}
