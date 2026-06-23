package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/db"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
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
		// 3) try mac_address match (exact)
		if err := h.db.Boards().FindOne(ctx, bson.M{"mac_address": boardID}).Decode(&board); err == nil {
			return board.ID, nil
		}
		// 4) try name match
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

func (h *Handler) RegisterBoard(c *gin.Context) {
	var req struct {
		Name       string `json:"name"`
		MACAddress string `json:"mac_address" binding:"required"`
		UID        string `json:"uid,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
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
	}
	_ = c.ShouldBindJSON(&req)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if req.MACAddress != "" {
		var existing models.Board
		err := h.db.Boards().FindOne(
			ctx,
			bson.M{"mac_address": req.MACAddress},
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

	cursor, err := h.db.Boards().Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"created_at": -1}))
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
		Name            string `json:"name,omitempty"`
		FirmwareVersion string `json:"firmware_version,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	update := bson.M{"updated_at": time.Now()}
	if req.Name != "" {
		update["name"] = req.Name
	}
	if req.FirmwareVersion != "" {
		update["firmware_version"] = req.FirmwareVersion
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.Boards().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": update})
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *Handler) Heartbeat(c *gin.Context) {
	var req struct {
		BoardID string `json:"board_id"`
		UID     string `json:"uid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Log inbound heartbeat for debugging
	h.logger.Info("heartbeat received", zap.String("board_id", req.BoardID), zap.String("uid", req.UID))

	now := time.Now()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, req.UID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.db.Boards().UpdateOne(ctx,
		bson.M{"_id": boardID},
		bson.M{"$set": bson.M{"last_heartbeat": now, "is_active": true, "updated_at": now}},
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

	if req.ProtocolID != "" {
		var proto models.ProtocolSpec
		if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": req.ProtocolID}).Decode(&proto); err == nil {
			if parsed, err := protocol.ParseAndFlatten(req.RawHex, &proto); err == nil {
				data.ParsedFields = parsed
			}
		}
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
		docs[i] = models.UartData{
			ID:        uuid.New().String(),
			BoardID:   boardID,
			Timestamp: ts,
			RawHex:    e.RawHex,
			Direction: e.Direction,
		}
	}

	if _, err := h.db.UartData().InsertMany(ctx, docs); err != nil {
		h.logger.Error("failed to batch ingest UART data", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ingest data"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"inserted": len(docs)})
}

func (h *Handler) QueryUART(c *gin.Context) {
	boardID := c.Query("board_id")
	sessionID := c.Query("session_id")
	direction := c.Query("direction")
	since := c.Query("since")
	limit := c.DefaultQuery("limit", "100")

	filter := bson.M{}
	if boardID != "" {
		filter["board_id"] = boardID
	}
	if sessionID != "" {
		filter["session_id"] = sessionID
	}
	if direction != "" {
		filter["direction"] = direction
	}
	if since != "" {
		t, err := time.Parse(time.RFC3339, since)
		if err == nil {
			filter["timestamp"] = bson.M{"$gt": t}
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	opts := options.Find().SetSort(bson.M{"timestamp": -1})
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

	_ = limit
	c.JSON(http.StatusOK, results)
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

	c.JSON(http.StatusCreated, temp)
}

func (h *Handler) QueryTemperature(c *gin.Context) {
	boardID := c.Query("board_id")
	filter := bson.M{}
	if boardID != "" {
		filter["board_id"] = boardID
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.Temperatures().Find(ctx, filter, options.Find().SetSort(bson.M{"timestamp": -1}))
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
		Name        string             `json:"name" binding:"required"`
		Version     string             `json:"version" binding:"required"`
		Description string             `json:"description,omitempty"`
		Fields      []models.FieldSpec `json:"fields" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	proto := models.ProtocolSpec{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Version:     req.Version,
		Description: req.Description,
		Fields:      req.Fields,
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
		Name        string             `json:"name,omitempty"`
		Version     string             `json:"version,omitempty"`
		Description string             `json:"description,omitempty"`
		Fields      []models.FieldSpec `json:"fields,omitempty"`
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
	if req.Fields != nil {
		update["fields"] = req.Fields
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

	proto := models.ProtocolSpec{
		ID:          uuid.New().String(),
		Name:        "LCP Protocol",
		Version:     "1.0",
		Description: "LCP↔OSP UART binary protocol: AA header + FID-based payload + CRC16 + BB tail",
		FrameDef: &models.FrameDef{
			StartByte:   "AA",
			EndByte:     "BB",
			Endian:      "big",
			CrcPosition: "before_end",
			Header: []models.FieldSpec{
				{Name: "length", Length: 2, Type: "uint16", Endian: "big"},
				{Name: "fid", Length: 1, Type: "uint8"},
				{Name: "seq_no", Length: 2, Type: "uint16", Endian: "big"},
				{Name: "attr", Length: 1, Type: "uint8"},
			},
			Tail: []models.FieldSpec{
				{Name: "crc16", Length: 2, Type: "uint16", Endian: "big"},
			},
		},
		Fields: []models.FieldSpec{
			{Name: "start_byte", Offset: 0, Length: 1, Type: "hex"},
			{Name: "length", Offset: 1, Length: 2, Type: "uint16", Endian: "big"},
			{Name: "fid", Offset: 3, Length: 1, Type: "uint8"},
			{Name: "seq_no", Offset: 4, Length: 2, Type: "uint16", Endian: "big"},
			{Name: "attr", Offset: 6, Length: 1, Type: "uint8"},
			{Name: "crc16", Offset: 0, Length: 2, Type: "uint16", Endian: "big"},
			{Name: "end_byte", Offset: 0, Length: 1, Type: "hex"},
		},
		FIDPayloads: []models.FIDPayload{
			{
				FID: "CF", Name: "Function Call",
				Fields: []models.FieldSpec{
					{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
					{Name: "arguments", Type: "function_args", Fields: []models.FieldSpec{
						{Flag: "FA", Name: "arg", Fields: []models.FieldSpec{
							{Name: "type_id", Length: 1, Type: "uint8"},
							{Name: "value", Type: "dynamic"},
						}},
					}},
				},
			},
			{
				FID: "CD", Name: "Function ACK",
				Fields: []models.FieldSpec{
					{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
					{Name: "result", Type: "func_result", Fields: []models.FieldSpec{
						{Flag: "FD", Name: "success", Fields: []models.FieldSpec{
							{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
							{Name: "result_data", Type: "raw"},
						}},
						{Flag: "FE", Name: "error", Fields: []models.FieldSpec{
							{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
							{Name: "error_code", Length: 1, Type: "uint8"},
						}},
					}},
				},
			},
			{FID: "CA", Name: "Data Transfer", Fields: []models.FieldSpec{
				{Name: "raw_data", Type: "raw"},
			}},
			{FID: "CE", Name: "Ping"},
			{FID: "CC", Name: "Packet ACK", Fields: []models.FieldSpec{
				{Name: "ack_seq", Length: 2, Type: "uint16", Endian: "big"},
				{Name: "error_code", Length: 1, Type: "uint8"},
			}},
			{FID: "BC", Name: "Heartbeat", Fields: []models.FieldSpec{
				{Name: "timestamp_raw", Length: 4, Type: "uint32", Endian: "little"},
				{Name: "status", Length: 1, Type: "uint8"},
			}},
			{FID: "C9", Name: "Event", Fields: []models.FieldSpec{
				{Name: "event_id", Length: 1, Type: "uint8"},
				{Name: "event_data", Type: "raw"},
			}},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if _, err := h.db.Protocols().InsertOne(ctx, proto); err != nil {
		h.logger.Error("failed to seed default protocol", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to seed protocol"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "default protocol seeded", "id": proto.ID})
}
