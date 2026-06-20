package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

func (h *Handler) CreateSession(c *gin.Context) {
	var req struct {
		BoardID     string   `json:"board_id" binding:"required"`
		Name        string   `json:"name" binding:"required"`
		Description string   `json:"description,omitempty"`
		StartTime   string   `json:"start_time,omitempty"`
		EndTime     string   `json:"end_time,omitempty"`
		Tags        []string `json:"tags,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	session := models.Session{
		ID:          uuid.New().String(),
		BoardID:     req.BoardID,
		Name:        req.Name,
		Description: req.Description,
		Tags:        req.Tags,
		CreatedAt:   time.Now(),
	}

	if req.StartTime != "" {
		if t, err := time.Parse(time.RFC3339, req.StartTime); err == nil {
			session.StartTime = t
		}
	}
	if req.EndTime != "" {
		if t, err := time.Parse(time.RFC3339, req.EndTime); err == nil {
			session.EndTime = t
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if _, err := h.db.Sessions().InsertOne(ctx, session); err != nil {
		h.logger.Error("failed to create session", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
		return
	}

	c.JSON(http.StatusCreated, session)
}

func (h *Handler) ListSessions(c *gin.Context) {
	boardID := c.Query("board_id")
	filter := bson.M{}
	if boardID != "" {
		filter["board_id"] = boardID
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.Sessions().Find(ctx, filter, options.Find().SetSort(bson.M{"start_time": -1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.Session
	if err := cursor.All(ctx, &results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}
	if results == nil {
		results = []models.Session{}
	}

	c.JSON(http.StatusOK, results)
}

func (h *Handler) UpdateSession(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Name        string   `json:"name,omitempty"`
		Description string   `json:"description,omitempty"`
		EndTime     string   `json:"end_time,omitempty"`
		Tags        []string `json:"tags,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	update := bson.M{}
	if req.Name != "" {
		update["name"] = req.Name
	}
	if req.Description != "" {
		update["description"] = req.Description
	}
	if req.EndTime != "" {
		if t, err := time.Parse(time.RFC3339, req.EndTime); err == nil {
			update["end_time"] = t
		}
	}
	if req.Tags != nil {
		update["tags"] = req.Tags
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.Sessions().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": update})
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *Handler) DeleteSession(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.Sessions().DeleteOne(ctx, bson.M{"_id": id})
	if err != nil || result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	go func() {
		uctx, ucancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer ucancel()
		if _, err := h.db.UartData().UpdateMany(uctx, bson.M{"session_id": id}, bson.M{"$unset": bson.M{"session_id": ""}}); err != nil {
			h.logger.Warn("failed to unlink session from UART data", zap.Error(err))
		}
	}()

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) AutoSplitSessions(c *gin.Context) {
	var req struct {
		BoardID string `json:"board_id" binding:"required"`
		Type    string `json:"type" binding:"required"`
		Params  struct {
			GapSeconds int `json:"gap_seconds,omitempty"`
		} `json:"params,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	gap := 60
	if req.Params.GapSeconds > 0 {
		gap = req.Params.GapSeconds
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	cursor, err := h.db.UartData().Find(ctx,
		bson.M{"board_id": req.BoardID, "session_id": bson.M{"$exists": false}},
		options.Find().SetSort(bson.M{"timestamp": 1}),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	type gapEntry struct {
		ID        string    `bson:"_id"`
		Timestamp time.Time `bson:"timestamp"`
	}

	var entries []gapEntry
	if err := cursor.All(ctx, &entries); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}

	if len(entries) == 0 {
		c.JSON(http.StatusOK, gin.H{"sessions_created": 0})
		return
	}

	created := 0
	sessionStart := entries[0].Timestamp
	sessionEnd := sessionStart
	sessionIndices := []int{0}

	for i := 1; i < len(entries); i++ {
		diff := entries[i].Timestamp.Sub(entries[i-1].Timestamp).Seconds()
		if diff > float64(gap) {
			sessionID := uuid.New().String()
			_, err := h.db.UartData().UpdateMany(ctx,
				bson.M{"board_id": req.BoardID, "timestamp": bson.M{"$gte": sessionStart, "$lte": sessionEnd}},
				bson.M{"$set": bson.M{"session_id": sessionID}},
			)
			if err == nil {
				h.db.Sessions().InsertOne(ctx, models.Session{
					ID:        sessionID,
					BoardID:   req.BoardID,
					Name:      "Auto-split",
					StartTime: sessionStart,
					EndTime:   sessionEnd,
					CreatedAt: time.Now(),
				})
				created++
			}
			sessionStart = entries[i].Timestamp
			sessionEnd = sessionStart
			sessionIndices = []int{i}
		} else {
			sessionEnd = entries[i].Timestamp
			sessionIndices = append(sessionIndices, i)
		}
	}

	if len(sessionIndices) > 0 {
		sessionID := uuid.New().String()
		h.db.UartData().UpdateMany(ctx,
			bson.M{"board_id": req.BoardID, "timestamp": bson.M{"$gte": sessionStart, "$lte": sessionEnd}},
			bson.M{"$set": bson.M{"session_id": sessionID}},
		)
		h.db.Sessions().InsertOne(ctx, models.Session{
			ID:        sessionID,
			BoardID:   req.BoardID,
			Name:      "Auto-split",
			StartTime: sessionStart,
			EndTime:   sessionEnd,
			CreatedAt: time.Now(),
		})
		created++
	}

	_ = sessionIndices
	c.JSON(http.StatusOK, gin.H{"sessions_created": created})
}
