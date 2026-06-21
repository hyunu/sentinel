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

func (h *Handler) CreateVizProfile(c *gin.Context) {
	var profile models.VizProfile
	if err := c.ShouldBindJSON(&profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile.ID = uuid.New().String()
	now := time.Now()
	profile.CreatedAt = now
	profile.UpdatedAt = now

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

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

	cursor, err := h.db.VizProfiles().Find(ctx, filter, options.Find().SetSort(bson.M{"name": 1}))
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

	cursor, err := h.db.UartData().Find(ctx, filter, options.Find().SetSort(bson.M{"timestamp": 1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var rawData []models.UartData
	if err := cursor.All(ctx, &rawData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}

	type transformedPoint struct {
		Timestamp time.Time              `json:"timestamp"`
		Values    map[string]interface{} `json:"values"`
	}

	results := make([]transformedPoint, 0, len(rawData))
	for _, d := range rawData {
		vals := make(map[string]interface{})
		for _, item := range profile.Items {
			if !item.Visible {
				continue
			}
			raw := d.RawHex
			if d.ParsedFields != nil {
				if v, ok := d.ParsedFields[item.FieldRef.FieldName]; ok {
					var fv float64
					switch vv := v.(type) {
					case float64:
						fv = vv
					case int:
						fv = float64(vv)
					case int32:
						fv = float64(vv)
					case int64:
						fv = float64(vv)
					default:
						continue
					}
					vals[item.Label] = fv*item.Weight + item.Offset
				}
			}
			_ = raw
		}
		if len(vals) > 0 {
			results = append(results, transformedPoint{
				Timestamp: d.Timestamp,
				Values:    vals,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"profile": profile,
		"data":    results,
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
}

func (h *Handler) VizQueryItems(c *gin.Context) {
	var req VizQueryItemsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	filter := bson.M{"board_id": req.BoardID}
	if req.TimeRange != nil && !req.TimeRange.Start.IsZero() {
		filter["timestamp"] = bson.M{
			"$gte": req.TimeRange.Start,
			"$lte": req.TimeRange.End,
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.UartData().Find(ctx, filter, options.Find().SetSort(bson.M{"timestamp": 1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var rawData []models.UartData
	if err := cursor.All(ctx, &rawData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}

	type transformedPoint struct {
		Timestamp time.Time              `json:"timestamp"`
		Values    map[string]interface{} `json:"values"`
	}

	results := make([]transformedPoint, 0, len(rawData))
	for _, d := range rawData {
		vals := make(map[string]interface{})
		for _, item := range req.Items {
			if !item.Visible {
				continue
			}
			if d.ParsedFields != nil {
				if v, ok := d.ParsedFields[item.FieldRef.FieldName]; ok {
					var fv float64
					switch vv := v.(type) {
					case float64:
						fv = vv
					case int:
						fv = float64(vv)
					case int32:
						fv = float64(vv)
					case int64:
						fv = float64(vv)
					default:
						continue
					}
					vals[item.Label] = fv*item.Weight + item.Offset
				}
			}
		}
		if len(vals) > 0 {
			results = append(results, transformedPoint{
				Timestamp: d.Timestamp,
				Values:    vals,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": results,
	})
}
