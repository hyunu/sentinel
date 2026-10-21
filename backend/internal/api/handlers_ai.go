package api

import (
	"context"
	"encoding/json"
	"fmt"
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

type aiQueryFailure struct {
	Status  int
	Code    string
	Message string
	Err     error
}

func (f *aiQueryFailure) Error() string {
	if f.Err != nil {
		return f.Message + ": " + f.Err.Error()
	}
	return f.Message
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
	if !h.authorizeAI(c) {
		return
	}
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), aiRequestTimeout)
	defer cancel()

	result, boardID, protocolID, err := h.runAIQuery(ctx, req, nil)
	if err != nil {
		failure := asAIQueryFailure(err)
		c.JSON(failure.Status, gin.H{
			"error": failure.Message,
			"code":  failure.Code,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"answer":      result.Answer,
		"provider":    result.Provider,
		"model":       result.Model,
		"board_id":    boardID,
		"protocol_id": protocolID,
		"tool_calls":  result.ToolCalls,
		"chart":       result.Chart,
		"usage":       result.Usage,
		"rounds":      result.Rounds,
	})
}

// AIQueryStream streams progress events and token deltas as Server-Sent Events.
func (h *Handler) AIQueryStream(c *gin.Context) {
	if !h.authorizeAI(c) {
		return
	}
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), aiRequestTimeout)
	defer cancel()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	send := func(event ai.Event) error {
		return writeAIEvent(c.Writer, event)
	}

	_, _, _, err := h.runAIQuery(ctx, req, send)
	if err != nil {
		failure := asAIQueryFailure(err)
		if failure.Err != nil {
			h.logger.Error("ai stream failed",
				zap.String("code", failure.Code),
				zap.Error(failure.Err),
			)
		}
		_ = send(ai.Event{
			Type:    "error",
			Code:    failure.Code,
			Content: failure.Message,
		})
	}
}

func (h *Handler) runAIQuery(
	ctx context.Context,
	req aiQueryRequest,
	onEvent func(ai.Event) error,
) (*ai.Result, string, string, error) {
	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" {
		return nil, "", "", &aiQueryFailure{Status: http.StatusBadRequest, Code: "query_required", Message: "query is required"}
	}

	resolvedBoardID, err := h.resolveBoardID(ctx, req.BoardID, "")
	if err != nil {
		return nil, "", "", &aiQueryFailure{Status: http.StatusNotFound, Code: "board_not_found", Message: "board not found"}
	}
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": resolvedBoardID}).Decode(&board); err != nil {
		return nil, "", "", &aiQueryFailure{Status: http.StatusNotFound, Code: "board_not_found", Message: "board not found"}
	}

	systemContext, proto, err := h.buildAIContext(ctx, board, req.ProtocolID)
	if err != nil {
		return nil, "", "", &aiQueryFailure{Status: http.StatusBadRequest, Code: "protocol_not_found", Message: err.Error(), Err: err}
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
		OnEvent:       onEvent,
	}, registry)
	if err != nil {
		status := http.StatusBadGateway
		if ctx.Err() == context.DeadlineExceeded {
			status = http.StatusGatewayTimeout
		}
		return nil, "", "", &aiQueryFailure{
			Status:  status,
			Code:    "ai_request_failed",
			Message: "AI request failed. Check the provider configuration and backend logs.",
			Err:     err,
		}
	}
	return result, board.ID, protocolID, nil
}

func asAIQueryFailure(err error) *aiQueryFailure {
	if failure, ok := err.(*aiQueryFailure); ok {
		return failure
	}
	return &aiQueryFailure{
		Status:  http.StatusInternalServerError,
		Code:    "ai_request_failed",
		Message: "AI request failed.",
		Err:     err,
	}
}

func writeAIEvent(w gin.ResponseWriter, event ai.Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return err
	}
	w.Flush()
	return nil
}
