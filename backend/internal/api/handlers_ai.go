package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/ai"
	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.uber.org/zap"
)

const aiRequestTimeout = 120 * time.Second

type aiQueryRequest struct {
	BoardID    string       `json:"board_id" binding:"required"`
	ProtocolID string       `json:"protocol_id,omitempty"`
	Query      string       `json:"query" binding:"required"`
	History    []ai.Message `json:"history,omitempty"`
}

// AIStatus reports whether the server has a usable AI provider without
// exposing credentials.
func (h *Handler) AIStatus(c *gin.Context) {
	if h.agent == nil {
		c.JSON(http.StatusOK, gin.H{
			"configured": false,
			"tools":      aiToolCount,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"configured": true,
		"provider":   h.agent.ProviderName(),
		"model":      h.agent.Model(),
		"max_rounds": h.agent.MaxRounds(),
		"tools":      aiToolCount,
	})
}

func (h *Handler) AIQuery(c *gin.Context) {
	if h.agent == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "AI is not configured. Set AI_PROVIDER, AI_MODEL, and AI_BASE_URL/AI_API_KEY on the backend.",
			"code":  "ai_not_configured",
		})
		return
	}

	var req aiQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query is required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), aiRequestTimeout)
	defer cancel()

	resolvedBoardID, err := h.resolveBoardID(ctx, req.BoardID, "")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": resolvedBoardID}).Decode(&board); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	systemContext, proto, err := h.buildAIContext(ctx, board, req.ProtocolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	protocolID := ""
	if proto != nil {
		protocolID = proto.ID
	}

	registry := h.buildAIToolRegistry(board.ID, protocolID)
	result, err := h.agent.Run(ctx, ai.Request{
		Query:         req.Query,
		History:       req.History,
		SystemContext: systemContext,
		BoardID:       board.ID,
		ProtocolID:    protocolID,
	}, registry)
	if err != nil {
		h.logger.Error("ai query failed",
			zap.String("board_id", board.ID),
			zap.String("protocol_id", protocolID),
			zap.Error(err),
		)
		status := http.StatusBadGateway
		if ctx.Err() == context.DeadlineExceeded {
			status = http.StatusGatewayTimeout
		}
		c.JSON(status, gin.H{
			"error": "AI request failed. Check the provider configuration and backend logs.",
			"code":  "ai_request_failed",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"answer":      result.Answer,
		"provider":    result.Provider,
		"model":       result.Model,
		"board_id":    board.ID,
		"protocol_id": protocolID,
		"tool_calls":  result.ToolCalls,
		"chart":       result.Chart,
		"usage":       result.Usage,
		"rounds":      result.Rounds,
	})
}
