package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"github.com/hyunu/sentinel/internal/ruleparser"
	"go.mongodb.org/mongo-driver/bson"
)

// ParseProtocolHex applies parse_rules (inline or from protocol id) to raw hex.
func (h *Handler) ParseProtocolHex(c *gin.Context) {
	var req struct {
		RawHex     string                       `json:"raw_hex" binding:"required"`
		ProtocolID string                       `json:"protocol_id,omitempty"`
		ParseRules *ruleparser.JsonRuleDocument `json:"parse_rules,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	spec := &models.ProtocolSpec{ParseRules: req.ParseRules}
	if req.ProtocolID != "" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		var proto models.ProtocolSpec
		if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": req.ProtocolID}).Decode(&proto); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "protocol not found"})
			return
		}
		spec = &proto
		if req.ParseRules != nil {
			spec.ParseRules = req.ParseRules
		}
	}

	if spec.ParseRules == nil || len(spec.ParseRules.Fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parse_rules required"})
		return
	}

	result, err := protocol.Parse(req.RawHex, spec)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ParseProtocolHexBatch applies one protocol's parse_rules to multiple frames.
// It is used by the mobile app to parse v2 parse_rules without duplicating the
// rule engine on the device.
func (h *Handler) ParseProtocolHexBatch(c *gin.Context) {
	var req struct {
		ProtocolID string                       `json:"protocol_id,omitempty"`
		ParseRules *ruleparser.JsonRuleDocument `json:"parse_rules,omitempty"`
		Frames     []string                     `json:"frames" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Frames) == 0 || len(req.Frames) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "frames must contain between 1 and 200 items"})
		return
	}

	spec := &models.ProtocolSpec{ParseRules: req.ParseRules}
	if req.ProtocolID != "" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		var proto models.ProtocolSpec
		if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": req.ProtocolID}).Decode(&proto); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "protocol not found"})
			return
		}
		spec = &proto
		if req.ParseRules != nil {
			spec.ParseRules = req.ParseRules
		}
	}
	if spec.ParseRules == nil || len(spec.ParseRules.Fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parse_rules required"})
		return
	}

	results := make([]gin.H, 0, len(req.Frames))
	for _, rawHex := range req.Frames {
		item := gin.H{"raw_hex": rawHex}
		parsed, err := protocol.Parse(rawHex, spec)
		if err != nil {
			item["error"] = err.Error()
			results = append(results, item)
			continue
		}
		item["parsed_fields"] = parsed.Fields
		item["valid"] = parsed.Valid
		if parsed.Error != "" {
			item["error"] = parsed.Error
		}
		results = append(results, item)
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}
