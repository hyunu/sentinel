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

func (h *Handler) ListSchemaPresets(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	cursor, err := h.db.SchemaPresets().Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"name": 1}))
	if err != nil {
		h.logger.Error("list schema presets query failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cursor.Close(ctx)

	var results []models.SchemaPreset
	if err := cursor.All(ctx, &results); err != nil {
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
	if req.Name == "" || req.ParseRules == nil || len(req.ParseRules.Fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and parse_rules.fields required"})
		return
	}

	now := time.Now()
	preset := models.SchemaPreset{
		ID:              uuid.New().String(),
		Name:            req.Name,
		Description:     req.Description,
		ProtocolVersion: req.ProtocolVersion,
		ParseRules:      req.ParseRules,
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
	if req.ProtocolVersion != "" {
		update["protocol_version"] = req.ProtocolVersion
	}
	if req.ParseRules != nil {
		update["parse_rules"] = req.ParseRules
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

	if err := h.db.EnsureSchemaPresets(ctx); err != nil {
		h.logger.Error("seed schema presets failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "seed failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "schema presets seeded"})
}
