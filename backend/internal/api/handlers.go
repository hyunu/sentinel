package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/db"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"github.com/hyunu/sentinel/internal/ruleparser"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

type Handler struct {
	db     *db.MongoDB
	logger *zap.Logger
}

func NewHandler(database *db.MongoDB, logger *zap.Logger) *Handler {
	return &Handler{db: database, logger: logger}
}

func (h *Handler) resolveBoardID(ctx context.Context, boardID, uid string) (string, error) {
	// If boardID provided, try multiple ways to resolve it to internal _id:
	if boardID != "" {
		// 1) try _id match
		var board models.Board
		if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&board); err == nil {
			return board.ID, nil
		}
		// 2) try uid match
		if err := h.db.Boards().FindOne(ctx, bson.M{"uid": boardID}).Decode(&board); err == nil {
			return board.ID, nil
		}
		// 3) try mac_address match (BLE remote ID)
		if err := h.db.Boards().FindOne(ctx, bson.M{"mac_address": boardID}).Decode(&board); err == nil {
			return board.ID, nil
		}
		// 4) try wifi_mac match (exact or colon-normalized)
		if mac := wifiMacFromBoardID(boardID); mac != "" {
			if err := h.db.Boards().FindOne(ctx, bson.M{"wifi_mac": mac}).Decode(&board); err == nil {
				return board.ID, nil
			}
		}
		if hex := normalizeMacHex(boardID); len(hex) == 12 {
			if mac := macHexToColon(hex); mac != "" {
				if err := h.db.Boards().FindOne(ctx, bson.M{"wifi_mac": mac}).Decode(&board); err == nil {
					return board.ID, nil
				}
			}
		}
		// 5) try name match
		if err := h.db.Boards().FindOne(ctx, bson.M{"name": boardID}).Decode(&board); err == nil {
			return board.ID, nil
		}
		// not found by boardID, continue to try uid if provided
	}

	if uid == "" {
		return "", fmt.Errorf("board_id or uid required")
	}
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"uid": uid}).Decode(&board); err != nil {
		return "", fmt.Errorf("board not found by uid: %s", uid)
	}
	return board.ID, nil
}

func (h *Handler) validateProtocolID(ctx context.Context, protocolID string) error {
	if protocolID == "" {
		return nil
	}
	n, err := h.db.Protocols().CountDocuments(ctx, bson.M{"_id": protocolID})
	if err != nil {
		return fmt.Errorf("protocol lookup failed")
	}
	if n == 0 {
		return fmt.Errorf("protocol not found: %s", protocolID)
	}
	return nil
}

func (h *Handler) boardProtocolID(ctx context.Context, boardID string) string {
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&board); err != nil {
		return ""
	}
	return board.ProtocolID
}

func (h *Handler) parseUartFields(ctx context.Context, rawHex, protocolID, boardID string) map[string]interface{} {
	effective := protocolID
	if effective == "" && boardID != "" {
		effective = h.boardProtocolID(ctx, boardID)
	}

	var spec *models.ProtocolSpec
	if effective != "" {
		var proto models.ProtocolSpec
		if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": effective}).Decode(&proto); err == nil {
			spec = &proto
		}
	}
	return protocol.ParseForStorage(rawHex, effective, spec)
}

func (h *Handler) RegisterBoard(c *gin.Context) {
	var req struct {
		Name       string `json:"name"`
		MACAddress string `json:"mac_address" binding:"required"`
		WifiMAC    string `json:"wifi_mac,omitempty"`
		Location   string `json:"location,omitempty"`
		UID        string `json:"uid,omitempty"`
		ProtocolID string `json:"protocol_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.validateProtocolID(ctx, req.ProtocolID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// If UID provided and placeholder exists, update that record (fill mac and activate)
	if req.UID != "" {
		var existing models.Board
		err := h.db.Boards().FindOne(ctx, bson.M{"uid": req.UID}).Decode(&existing)
		if err == nil {
			update := bson.M{
				"mac_address":    req.MACAddress,
				"is_active":      true,
				"updated_at":     time.Now(),
				"last_heartbeat": time.Now(),
			}
			if req.WifiMAC != "" {
				update["wifi_mac"] = macHexToColon(req.WifiMAC)
			}
			if req.Location != "" {
				update["location"] = req.Location
			}
			if req.ProtocolID != "" {
				update["protocol_id"] = req.ProtocolID
			}
			_, err = h.db.Boards().UpdateOne(ctx, bson.M{"uid": req.UID}, bson.M{"$set": update})
			if err != nil {
				h.logger.Error("failed to update existing board", zap.Error(err))
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register board"})
				return
			}
			// return updated board
			if err := h.db.Boards().FindOne(ctx, bson.M{"uid": req.UID}).Decode(&existing); err == nil {
				c.JSON(http.StatusCreated, gin.H{"uid": existing.UID, "board": existing})
				return
			}
		}
		// if not found, fall through to create with provided UID
	}

	// Create new board (uid may be empty -> generate)
	var uid string
	if req.UID != "" {
		uid = req.UID
	} else {
		seq, err := h.db.GetNextSequence(ctx, "device_uid")
		if err != nil {
			h.logger.Error("failed to generate UID", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate UID"})
			return
		}
		uid = fmt.Sprintf("%04d", seq)
	}

	board := models.Board{
		ID:            uuid.New().String(),
		UID:           uid,
		Name:          fmt.Sprintf("STN-%s", uid),
		MACAddress:    req.MACAddress,
		WifiMAC:       macHexToColon(req.WifiMAC),
		Location:      req.Location,
		ProtocolID:    req.ProtocolID,
		LastHeartbeat: time.Now(),
		IsActive:      true,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if _, err := h.db.Boards().InsertOne(ctx, board); err != nil {
		h.logger.Error("failed to register board", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register board"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"uid": board.UID, "board": board})
}

// ClaimBoard returns a UID. If mac_address is provided and a board already exists,
// returns the existing UID (lowest assigned) instead of creating a duplicate.
func (h *Handler) ClaimBoard(c *gin.Context) {
	var req struct {
		MACAddress string `json:"mac_address"`
		WifiMAC    string `json:"wifi_mac,omitempty"`
	}
	_ = c.ShouldBindJSON(&req)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if req.MACAddress != "" || req.WifiMAC != "" {
		filter := bson.M{}
		if req.MACAddress != "" && req.WifiMAC != "" {
			wifiMac := macHexToColon(req.WifiMAC)
			filter = bson.M{"$or": []bson.M{
				{"mac_address": req.MACAddress},
				{"wifi_mac": wifiMac},
			}}
		} else if req.MACAddress != "" {
			filter = bson.M{"mac_address": req.MACAddress}
		} else {
			filter = bson.M{"wifi_mac": macHexToColon(req.WifiMAC)}
		}
		var existing models.Board
		err := h.db.Boards().FindOne(
			ctx,
			filter,
			options.FindOne().SetSort(bson.M{"uid": 1}),
		).Decode(&existing)
		if err == nil && existing.UID != "" {
			c.JSON(http.StatusOK, gin.H{"uid": existing.UID, "reused": true})
			return
		}
	}

	seq, err := h.db.GetNextSequence(ctx, "device_uid")
	if err != nil {
		h.logger.Error("failed to generate claim UID", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate uid"})
		return
	}
	uid := fmt.Sprintf("%04d", seq)

	// create placeholder board record so heartbeat can be accepted immediately
	board := models.Board{
		ID:            uuid.New().String(),
		UID:           uid,
		Name:          fmt.Sprintf("STN-%s", uid),
		MACAddress:    "",
		LastHeartbeat: time.Time{},
		IsActive:      false,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	if _, err := h.db.Boards().InsertOne(ctx, board); err != nil {
		h.logger.Error("failed to create placeholder board", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to claim uid"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"uid": uid})
}

func (h *Handler) ListBoards(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.Boards().Find(ctx, bson.M{
		"pending_action": bson.M{"$ne": "deleted"},
	}, options.Find().SetSort(bson.M{"created_at": -1}))
	if err != nil {
		h.logger.Error("failed to list boards", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list boards"})
		return
	}
	defer cursor.Close(ctx)

	var boards []models.Board
	if err := cursor.All(ctx, &boards); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decode boards"})
		return
	}
	if boards == nil {
		boards = []models.Board{}
	}

	c.JSON(http.StatusOK, boards)
}

func (h *Handler) GetBoard(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": id}).Decode(&board); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	c.JSON(http.StatusOK, board)
}

func (h *Handler) UpdateBoard(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Name            string  `json:"name,omitempty"`
		FirmwareVersion string  `json:"firmware_version,omitempty"`
		Location        *string `json:"location"`
		ProtocolID      *string `json:"protocol_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	update := bson.M{"updated_at": time.Now()}
	unset := bson.M{}
	if req.Name != "" {
		update["name"] = req.Name
	}
	if req.FirmwareVersion != "" {
		update["firmware_version"] = req.FirmwareVersion
	}
	if req.Location != nil {
		update["location"] = *req.Location
	}
	if req.ProtocolID != nil {
		if *req.ProtocolID == "" {
			unset["protocol_id"] = ""
		} else if err := h.validateProtocolID(ctx, *req.ProtocolID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		} else {
			update["protocol_id"] = *req.ProtocolID
		}
	}

	updateDoc := bson.M{"$set": update}
	if len(unset) > 0 {
		updateDoc["$unset"] = unset
	}

	result, err := h.db.Boards().UpdateOne(ctx, bson.M{"_id": id}, updateDoc)
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": id}).Decode(&board); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "updated"})
		return
	}

	c.JSON(http.StatusOK, board)
}

func (h *Handler) DeleteBoard(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": id}).Decode(&board); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	if board.PendingAction == "deleted" {
		c.JSON(http.StatusOK, gin.H{"message": "delete_pending", "pending": true})
		return
	}

	now := time.Now()
	if isBoardOnline(board, now) {
		_, err := h.db.Boards().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{
			"pending_action":    "deleted",
			"pending_action_at": now,
			"updated_at":        now,
		}})
		if err != nil {
			h.logger.Error("failed to mark board for deletion", zap.String("board_id", id), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete board"})
			return
		}
		h.logger.Info("board delete pending — will notify on next heartbeat", zap.String("board_id", id))
		c.JSON(http.StatusOK, gin.H{"message": "delete_pending", "pending": true})
		return
	}

	stats, err := h.db.DeleteBoardCascade(ctx, id)
	if err != nil {
		if errors.Is(err, db.ErrBoardNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
			return
		}
		h.logger.Error("failed to delete board", zap.String("board_id", id), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete board"})
		return
	}

	h.logger.Info("board deleted",
		zap.String("board_id", id),
		zap.Int64("uart_data", stats.UartData),
		zap.Int64("sessions", stats.Sessions),
		zap.Int64("temperatures", stats.Temperatures),
		zap.Int64("heartbeats", stats.Heartbeats),
		zap.Int64("viz_profiles", stats.VizProfiles),
	)
	c.JSON(http.StatusOK, gin.H{"message": "deleted", "pending": false, "deleted": stats})
}

func (h *Handler) Heartbeat(c *gin.Context) {
	var req struct {
		BoardID         string `json:"board_id"`
		UID             string `json:"uid"`
		FirmwareVersion string `json:"firmware_version"`
		WifiRSSI        *int   `json:"wifi_rssi"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.logger.Info("heartbeat received",
		zap.String("board_id", req.BoardID),
		zap.String("uid", req.UID),
		zap.String("firmware_version", req.FirmwareVersion),
	)

	now := time.Now()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, req.UID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&board); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	if board.PendingAction == "deleted" {
		stats, err := h.db.DeleteBoardCascade(ctx, boardID)
		if err != nil {
			h.logger.Error("failed to cascade delete board after notify", zap.String("board_id", boardID), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
			return
		}
		h.logger.Info("board deleted after device notification",
			zap.String("board_id", boardID),
			zap.Int64("uart_data", stats.UartData),
			zap.Int64("sessions", stats.Sessions),
			zap.Int64("temperatures", stats.Temperatures),
			zap.Int64("heartbeats", stats.Heartbeats),
			zap.Int64("viz_profiles", stats.VizProfiles),
		)
		c.JSON(http.StatusOK, gin.H{"message": "ok", "action": "deleted"})
		return
	}

	update := bson.M{"last_heartbeat": now, "is_active": true, "updated_at": now}
	if mac := wifiMacFromBoardID(req.BoardID); mac != "" {
		update["wifi_mac"] = mac
	}
	if req.FirmwareVersion != "" {
		update["firmware_version"] = req.FirmwareVersion
	}
	if req.WifiRSSI != nil {
		update["wifi_rssi"] = *req.WifiRSSI
	}
	result, err := h.db.Boards().UpdateOne(ctx,
		bson.M{"_id": boardID},
		bson.M{"$set": update},
	)
	if err != nil {
		h.logger.Error("heartbeat update failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "heartbeat failed"})
		return
	}

	if result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	heartbeat := models.Heartbeat{
		BoardID:   boardID,
		Timestamp: now,
	}
	if _, err := h.db.Heartbeats().InsertOne(ctx, heartbeat); err != nil {
		h.logger.Warn("failed to log heartbeat", zap.Error(err))
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *Handler) IngestUART(c *gin.Context) {
	var req struct {
		BoardID    string    `json:"board_id"`
		UID        string    `json:"uid"`
		RawHex     string    `json:"raw_hex" binding:"required"`
		Direction  string    `json:"direction" binding:"required"`
		Timestamp  time.Time `json:"timestamp"`
		ProtocolID string    `json:"protocol_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Timestamp.IsZero() {
		req.Timestamp = time.Now()
	}
	if req.Direction != "TX" && req.Direction != "RX" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "direction must be TX or RX"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, req.UID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	data := models.UartData{
		ID:        uuid.New().String(),
		BoardID:   boardID,
		Timestamp: req.Timestamp,
		RawHex:    req.RawHex,
		Direction: req.Direction,
	}

	if parsed := h.parseUartFields(ctx, req.RawHex, req.ProtocolID, boardID); parsed != nil {
		data.ParsedFields = parsed
	}

	if _, err := h.db.UartData().InsertOne(ctx, data); err != nil {
		h.logger.Error("failed to ingest UART data", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ingest data"})
		return
	}

	c.JSON(http.StatusCreated, data)
}

func (h *Handler) IngestUARTBatch(c *gin.Context) {
	var req struct {
		BoardID string `json:"board_id"`
		UID     string `json:"uid"`
		Entries []struct {
			RawHex    string    `json:"raw_hex" binding:"required"`
			Direction string    `json:"direction" binding:"required"`
			Timestamp time.Time `json:"timestamp"`
		} `json:"entries" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, req.UID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now()
	docs := make([]interface{}, len(req.Entries))
	for i, e := range req.Entries {
		ts := e.Timestamp
		if ts.IsZero() {
			ts = now
		}
		doc := models.UartData{
			ID:        uuid.New().String(),
			BoardID:   boardID,
			Timestamp: ts,
			RawHex:    e.RawHex,
			Direction: e.Direction,
		}
		if parsed := h.parseUartFields(ctx, e.RawHex, "", boardID); parsed != nil {
			doc.ParsedFields = parsed
		}
		docs[i] = doc
	}

	if _, err := h.db.UartData().InsertMany(ctx, docs); err != nil {
		h.logger.Error("failed to batch ingest UART data", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ingest data"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"inserted": len(docs)})
}

const (
	uartQueryDefaultLimit = 100
	uartQueryMaxLimit     = 5000
)

func parseTimeQuery(value string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, value)
}

func (h *Handler) uartQueryFilter(ctx context.Context, c *gin.Context) (bson.M, error) {
	filter := bson.M{}
	boardID := c.Query("board_id")
	if boardID != "" || c.Query("uid") != "" {
		resolved, err := h.resolveBoardID(ctx, boardID, c.Query("uid"))
		if err != nil {
			return nil, err
		}
		filter["board_id"] = resolved
	}
	if sessionID := c.Query("session_id"); sessionID != "" {
		filter["session_id"] = sessionID
	}
	if direction := c.Query("direction"); direction != "" {
		filter["direction"] = direction
	}

	timeFilter := bson.M{}
	if since := c.Query("since"); since != "" {
		t, err := parseTimeQuery(since)
		if err != nil {
			return nil, fmt.Errorf("invalid since: %w", err)
		}
		timeFilter["$gte"] = t
	}
	if until := c.Query("until"); until != "" {
		t, err := parseTimeQuery(until)
		if err != nil {
			return nil, fmt.Errorf("invalid until: %w", err)
		}
		timeFilter["$lte"] = t
	}

	var andParts []bson.M
	if len(timeFilter) > 0 {
		andParts = append(andParts, bson.M{"timestamp": timeFilter})
	}

	beforeTS := c.Query("before_ts")
	beforeID := c.Query("before_id")
	if beforeTS != "" && beforeID != "" {
		bt, err := parseTimeQuery(beforeTS)
		if err != nil {
			return nil, fmt.Errorf("invalid before_ts: %w", err)
		}
		andParts = append(andParts, bson.M{
			"$or": bson.A{
				bson.M{"timestamp": bson.M{"$lt": bt}},
				bson.M{"timestamp": bt, "_id": bson.M{"$lt": beforeID}},
			},
		})
	}

	if len(andParts) > 0 {
		filter["$and"] = andParts
	}

	return filter, nil
}

func (h *Handler) QueryUART(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", strconv.Itoa(uartQueryDefaultLimit))
	includeTotal := c.Query("include_total") == "true"

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	filter, err := h.uartQueryFilter(ctx, c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	limit := int64(uartQueryDefaultLimit)
	if limitStr != "" {
		if n, err := strconv.ParseInt(limitStr, 10, 64); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > uartQueryMaxLimit {
		limit = uartQueryMaxLimit
	}

	var total *int64
	if includeTotal {
		countFilter := bson.M{}
		for k, v := range filter {
			if k == "$and" {
				parts, ok := v.([]bson.M)
				if !ok {
					continue
				}
				trimmed := make([]bson.M, 0, len(parts))
				for _, part := range parts {
					if _, hasOr := part["$or"]; hasOr {
						continue
					}
					trimmed = append(trimmed, part)
				}
				if len(trimmed) > 0 {
					countFilter["$and"] = trimmed
				}
				continue
			}
			countFilter[k] = v
		}
		n, err := h.db.UartData().CountDocuments(ctx, countFilter)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "count failed"})
			return
		}
		total = &n
	}

	opts := options.Find().
		SetSort(bson.D{{Key: "timestamp", Value: -1}, {Key: "_id", Value: -1}}).
		SetLimit(limit + 1)
	cursor, err := h.db.UartData().Find(ctx, filter, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.UartData
	if err := cursor.All(ctx, &results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}
	if results == nil {
		results = []models.UartData{}
	}

	hasMore := int64(len(results)) > limit
	if hasMore {
		results = results[:limit]
	}

	resp := models.UartQueryResult{
		Items:   results,
		Total:   total,
		HasMore: hasMore,
	}
	if hasMore && len(results) > 0 {
		last := results[len(results)-1]
		resp.NextBefore = &models.UartCursor{
			Timestamp: last.Timestamp,
			ID:        last.ID,
		}
	}

	c.JSON(http.StatusOK, resp)
}

func (h *Handler) IngestTemperature(c *gin.Context) {
	var req struct {
		BoardID      string    `json:"board_id"`
		UID          string    `json:"uid"`
		ValueCelsius float64   `json:"value_celsius" binding:"required"`
		Timestamp    time.Time `json:"timestamp"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Timestamp.IsZero() {
		req.Timestamp = time.Now()
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, req.UID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	temp := models.Temperature{
		ID:           uuid.New().String(),
		BoardID:      boardID,
		Timestamp:    req.Timestamp,
		ValueCelsius: req.ValueCelsius,
	}

	if _, err := h.db.Temperatures().InsertOne(ctx, temp); err != nil {
		h.logger.Error("failed to ingest temperature", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ingest temperature"})
		return
	}

	if err := h.db.InsertTemperatureUartFrame(ctx, boardID, req.Timestamp, req.ValueCelsius); err != nil {
		h.logger.Warn("failed to mirror temperature to uart_data", zap.Error(err))
	}

	c.JSON(http.StatusCreated, temp)
}

func (h *Handler) QueryTemperature(c *gin.Context) {
	boardID := c.Query("board_id")
	uid := c.Query("uid")
	since := c.Query("since")
	limitStr := c.DefaultQuery("limit", "2000")

	filter := bson.M{}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if boardID != "" || uid != "" {
		resolved, err := h.resolveBoardID(ctx, boardID, uid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		filter["board_id"] = resolved
	}

	if since != "" {
		t, err := time.Parse(time.RFC3339, since)
		if err == nil {
			filter["timestamp"] = bson.M{"$gt": t}
		}
	}

	limit := int64(2000)
	if limitStr != "" {
		if n, err := strconv.ParseInt(limitStr, 10, 64); err == nil && n > 0 {
			limit = n
		}
	}

	opts := options.Find().SetSort(bson.M{"timestamp": -1}).SetLimit(limit)
	cursor, err := h.db.Temperatures().Find(ctx, filter, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.Temperature
	if err := cursor.All(ctx, &results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}
	if results == nil {
		results = []models.Temperature{}
	}

	c.JSON(http.StatusOK, results)
}

func (h *Handler) CreateProtocol(c *gin.Context) {
	var req struct {
		Name        string                       `json:"name" binding:"required"`
		Version     string                       `json:"version" binding:"required"`
		Description string                       `json:"description,omitempty"`
		ParseRules  *ruleparser.JsonRuleDocument `json:"parse_rules" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ParseRules == nil || len(req.ParseRules.Fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parse_rules.fields required"})
		return
	}

	proto := models.ProtocolSpec{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Version:     req.Version,
		Description: req.Description,
		ParseRules:  req.ParseRules,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if _, err := h.db.Protocols().InsertOne(ctx, proto); err != nil {
		h.logger.Error("failed to create protocol", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create protocol"})
		return
	}

	c.JSON(http.StatusCreated, proto)
}

func (h *Handler) ListProtocols(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.Protocols().Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"name": 1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.ProtocolSpec
	if err := cursor.All(ctx, &results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}
	if results == nil {
		results = []models.ProtocolSpec{}
	}

	c.JSON(http.StatusOK, results)
}

func (h *Handler) GetProtocol(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var proto models.ProtocolSpec
	if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": id}).Decode(&proto); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "protocol not found"})
		return
	}

	c.JSON(http.StatusOK, proto)
}

func (h *Handler) UpdateProtocol(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Name        string                       `json:"name,omitempty"`
		Version     string                       `json:"version,omitempty"`
		Description string                       `json:"description,omitempty"`
		ParseRules  *ruleparser.JsonRuleDocument `json:"parse_rules,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	update := bson.M{"updated_at": time.Now()}
	if req.Name != "" {
		update["name"] = req.Name
	}
	if req.Version != "" {
		update["version"] = req.Version
	}
	if req.Description != "" {
		update["description"] = req.Description
	}
	if req.ParseRules != nil {
		update["parse_rules"] = req.ParseRules
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.Protocols().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": update})
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "protocol not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *Handler) DeleteProtocol(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.Protocols().DeleteOne(ctx, bson.M{"_id": id})
	if err != nil || result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "protocol not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) SeedDefaultProtocol(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	count, err := h.db.Protocols().CountDocuments(ctx, bson.M{"name": "LCP Protocol"})
	if err == nil && count > 0 {
		c.JSON(http.StatusOK, gin.H{"message": "default protocol already exists"})
		return
	}

	proto := protocol.DefaultLCPProtocolSpec(uuid.New().String())
	proto.CreatedAt = time.Now()
	proto.UpdatedAt = time.Now()

	if _, err := h.db.Protocols().InsertOne(ctx, proto); err != nil {
		h.logger.Error("failed to seed default protocol", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to seed protocol"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "default protocol seeded", "id": proto.ID})
}
