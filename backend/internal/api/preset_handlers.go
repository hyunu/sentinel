package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

func (h *Handler) ListSchemaPresets(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	filter := bson.M{}
	if cat := c.Query("category"); cat != "" {
		filter["category"] = cat
	}

	cursor, err := h.db.SchemaPresets().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "category", Value: 1}, {Key: "name", Value: 1}}))
	if err != nil {
		h.logger.Error("list schema presets query failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.SchemaPreset
	if err := cursor.All(ctx, &results); err != nil {
		h.logger.Error("list schema presets decode failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode failed"})
		return
	}
	if results == nil {
		results = []models.SchemaPreset{}
	}
	c.JSON(http.StatusOK, results)
}

func (h *Handler) GetSchemaPreset(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var preset models.SchemaPreset
	if err := h.db.SchemaPresets().FindOne(ctx, bson.M{"_id": id}).Decode(&preset); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "preset not found"})
		return
	}
	c.JSON(http.StatusOK, preset)
}

func (h *Handler) CreateSchemaPreset(c *gin.Context) {
	var req models.SchemaPreset
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name == "" || req.Category == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and category required"})
		return
	}
	if req.Category != "payload" && req.Category != "frame" && req.Category != "protocol" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category must be payload, frame, or protocol"})
		return
	}

	now := time.Now()
	preset := models.SchemaPreset{
		ID:              uuid.New().String(),
		Name:            req.Name,
		Description:     req.Description,
		Category:        req.Category,
		Fields:          req.Fields,
		FrameDef:        req.FrameDef,
		FIDPayloads:     req.FIDPayloads,
		ProtocolVersion: req.ProtocolVersion,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if _, err := h.db.SchemaPresets().InsertOne(ctx, preset); err != nil {
		h.logger.Error("failed to create schema preset", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create preset"})
		return
	}
	c.JSON(http.StatusCreated, preset)
}

func (h *Handler) UpdateSchemaPreset(c *gin.Context) {
	id := c.Param("id")
	var req models.SchemaPreset
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	update := bson.M{"updated_at": time.Now()}
	if req.Name != "" {
		update["name"] = req.Name
	}
	update["description"] = req.Description
	if req.Category != "" {
		update["category"] = req.Category
	}
	if req.Fields != nil {
		update["fields"] = req.Fields
	}
	if req.FrameDef != nil {
		update["frame_def"] = req.FrameDef
	}
	if req.FIDPayloads != nil {
		update["fid_payloads"] = req.FIDPayloads
	}
	if req.ProtocolVersion != "" {
		update["protocol_version"] = req.ProtocolVersion
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.SchemaPresets().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": update})
	if err != nil || result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "preset not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *Handler) DeleteSchemaPreset(c *gin.Context) {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	result, err := h.db.SchemaPresets().DeleteOne(ctx, bson.M{"_id": id})
	if err != nil || result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "preset not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) SeedSchemaPresets(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	inserted := 0
	for _, preset := range protocol.DefaultSchemaPresets(time.Now()) {
		count, err := h.db.SchemaPresets().CountDocuments(ctx, bson.M{"_id": preset.ID})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "count failed"})
			return
		}
		if count > 0 {
			continue
		}
		if _, err := h.db.SchemaPresets().InsertOne(ctx, preset); err != nil {
			h.logger.Error("failed to seed preset", zap.String("id", preset.ID), zap.Error(err))
			continue
		}
		inserted++
	}
	c.JSON(http.StatusOK, gin.H{"message": "schema presets seeded", "inserted": inserted})
}
