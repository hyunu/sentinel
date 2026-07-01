package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

const maxVizProfilesPerBoard = 5

func (h *Handler) CreateVizProfile(c *gin.Context) {
	var profile models.VizProfile
	if err := c.ShouldBindJSON(&profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if profile.BoardID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "board_id required"})
		return
	}
	if profile.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	count, err := h.db.VizProfiles().CountDocuments(ctx, bson.M{"board_id": profile.BoardID})
	if err != nil {
		h.logger.Error("failed to count viz profiles", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create profile"})
		return
	}
	if count >= maxVizProfilesPerBoard {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("maximum %d profiles per board", maxVizProfilesPerBoard),
		})
		return
	}

	profile.ID = uuid.New().String()
	now := time.Now()
	profile.CreatedAt = now
	profile.UpdatedAt = now

	if _, err := h.db.VizProfiles().InsertOne(ctx, profile); err != nil {
		h.logger.Error("failed to create viz profile", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create profile"})
		return
	}

	c.JSON(http.StatusCreated, profile)
}

func (h *Handler) ListVizProfiles(c *gin.Context) {
	boardID := c.Query("board_id")
	filter := bson.M{}
	if boardID != "" {
		filter["board_id"] = boardID
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.VizProfiles().Find(ctx, filter, options.Find().SetSort(bson.D{
		{Key: "updated_at", Value: -1},
		{Key: "name", Value: 1},
	}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.VizProfile
	if err := cursor.All(ctx, &results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}
	if results == nil {
		results = []models.VizProfile{}
	}

	c.JSON(http.StatusOK, results)
}

func (h *Handler) GetVizProfile(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var profile models.VizProfile
	if err := h.db.VizProfiles().FindOne(ctx, bson.M{"_id": id}).Decode(&profile); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	c.JSON(http.StatusOK, profile)
}

func (h *Handler) UpdateVizProfile(c *gin.Context) {
	id := c.Param("id")
	var profile models.VizProfile
	if err := c.ShouldBindJSON(&profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile.UpdatedAt = time.Now()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.VizProfiles().ReplaceOne(ctx, bson.M{"_id": id}, profile)
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *Handler) DeleteVizProfile(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.VizProfiles().DeleteOne(ctx, bson.M{"_id": id})
	if err != nil || result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) ApplyVizProfile(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var profile models.VizProfile
	if err := h.db.VizProfiles().FindOne(ctx, bson.M{"_id": id}).Decode(&profile); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	filter := bson.M{"board_id": profile.BoardID}
	if len(profile.SessionIDs) > 0 {
		filter["session_id"] = bson.M{"$in": profile.SessionIDs}
	}
	if profile.TimeRange != nil && !profile.TimeRange.Start.IsZero() {
		filter["timestamp"] = bson.M{
			"$gte": profile.TimeRange.Start,
			"$lte": profile.TimeRange.End,
		}
	}

	results, meta, err := h.queryVizSeries(ctx, filter, profile.Items, vizDefaultPointLimit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"profile": profile,
		"data":    results,
		"meta":    meta,
	})
}

func (h *Handler) VizQuery(c *gin.Context) {
	var req struct {
		BoardID    string   `json:"board_id" binding:"required"`
		SessionID  string   `json:"session_id,omitempty"`
		FieldNames []string `json:"field_names" binding:"required"`
		Aggregate  string   `json:"aggregate,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	filter := bson.M{"board_id": req.BoardID}
	if req.SessionID != "" {
		filter["session_id"] = req.SessionID
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.UartData().Find(ctx, filter, options.Find().SetSort(bson.M{"timestamp": 1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var data []models.UartData
	if err := cursor.All(ctx, &data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}

	_ = req.Aggregate
	type resultPoint struct {
		Timestamp time.Time              `json:"timestamp"`
		Values    map[string]interface{} `json:"values"`
	}

	results := make([]resultPoint, 0, len(data))
	for _, d := range data {
		vals := make(map[string]interface{})
		for _, name := range req.FieldNames {
			if d.ParsedFields != nil {
				if v, ok := d.ParsedFields[name]; ok {
					vals[name] = v
				}
			}
		}
		if len(vals) > 0 {
			results = append(results, resultPoint{Timestamp: d.Timestamp, Values: vals})
		}
	}

	c.JSON(http.StatusOK, results)
}

type VizQueryItemsRequest struct {
	BoardID   string            `json:"board_id" binding:"required"`
	Items     []models.VizItem  `json:"items" binding:"required"`
	TimeRange *models.TimeRange `json:"time_range,omitempty"`
	Since     string            `json:"since,omitempty"`
	Limit     *int              `json:"limit,omitempty"`
}

func (h *Handler) VizQueryItems(c *gin.Context) {
	var req VizQueryItemsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	filter := bson.M{"board_id": req.BoardID}
	if req.Since != "" {
		if st, err := time.Parse(time.RFC3339, req.Since); err == nil {
			filter["timestamp"] = bson.M{"$gt": st}
		}
	} else if req.TimeRange != nil && !req.TimeRange.Start.IsZero() {
		tsFilter := bson.M{"$gte": req.TimeRange.Start}
		if !req.TimeRange.End.IsZero() {
			tsFilter["$lte"] = req.TimeRange.End
		}
		filter["timestamp"] = tsFilter
	}

	limit := vizDefaultPointLimit
	if req.Limit != nil {
		limit = *req.Limit
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), queryTimeoutForVizLimit(limit))
	defer cancel()

	results, meta, err := h.queryVizSeries(ctx, filter, req.Items, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": results,
		"meta": meta,
	})
}
