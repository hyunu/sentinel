package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (h *Handler) AIQuery(c *gin.Context) {
	var req struct {
		BoardID string `json:"board_id" binding:"required"`
		Query   string `json:"query" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": req.BoardID}).Decode(&board); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}

	cursor, err := h.db.UartData().Find(ctx,
		bson.M{"board_id": req.BoardID},
		options.Find().SetSort(bson.M{"timestamp": -1}).SetLimit(100),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "data query failed"})
		return
	}

	var recentData []models.UartData
	if err := cursor.All(ctx, &recentData); err != nil {
		recentData = []models.UartData{}
	}

	dataSummary := ""
	for _, d := range recentData {
		parsed := ""
		if d.ParsedFields != nil {
			for k, v := range d.ParsedFields {
				parsed += k + ":" + interfaceToString(v) + " "
			}
		}
		dataSummary += d.Timestamp.Format(time.RFC3339) + " " + d.Direction + " " + d.RawHex + " [" + parsed + "]\n"
	}

	_ = board

	c.JSON(http.StatusOK, gin.H{
		"query":  req.Query,
		"answer": "AI query received. Data context: " + string(len(recentData)) + " recent records. Query: " + req.Query,
		"context": gin.H{
			"board_id":         req.BoardID,
			"recent_data_size": len(recentData),
			"data_summary":     dataSummary,
		},
	})
}

func interfaceToString(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return fmt.Sprintf("%v", val)
	default:
		return fmt.Sprintf("%v", val)
	}
}
