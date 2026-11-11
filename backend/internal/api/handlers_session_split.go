package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

func sessionRuleMatches(
	rule models.SessionSplitRule,
	parsed map[string]interface{},
	direction string,
) bool {
	if !rule.Enabled {
		return false
	}
	if rule.Direction != "" && !strings.EqualFold(rule.Direction, direction) {
		return false
	}
	if rule.FID != "" {
		want, err := parseFIDValue(rule.FID)
		if err != nil || asInt(parsed["fid"]) != want {
			return false
		}
	}
	if rule.Field == "" {
		return true
	}

	value := getPath(parsed, rule.Field)
	operator := strings.ToLower(strings.TrimSpace(rule.Operator))
	if operator == "" {
		operator = "eq"
	}
	if operator == "exists" {
		return value != nil
	}
	if value == nil {
		return false
	}
	left := fmt.Sprint(value)
	right := strings.TrimSpace(rule.Value)
	switch operator {
	case "eq":
		return compareSessionValue(left, right) == 0
	case "neq":
		return compareSessionValue(left, right) != 0
	case "contains":
		return strings.Contains(strings.ToLower(left), strings.ToLower(right))
	case "gt", "gte", "lt", "lte":
		leftN, leftErr := strconv.ParseFloat(left, 64)
		rightN, rightErr := strconv.ParseFloat(right, 64)
		if leftErr != nil || rightErr != nil {
			return false
		}
		switch operator {
		case "gt":
			return leftN > rightN
		case "gte":
			return leftN >= rightN
		case "lt":
			return leftN < rightN
		default:
			return leftN <= rightN
		}
	default:
		return false
	}
}

func compareSessionValue(left, right string) int {
	leftN, leftErr := strconv.ParseFloat(left, 64)
	rightN, rightErr := strconv.ParseFloat(right, 64)
	if leftErr == nil && rightErr == nil {
		switch {
		case leftN < rightN:
			return -1
		case leftN > rightN:
			return 1
		default:
			return 0
		}
	}
	return strings.Compare(left, right)
}

// SplitSessionsByRules cuts sessions at packets matching the board's configured
// rules. It does not use idle gaps; only explicit packet matches create cuts.
func (h *Handler) SplitSessionsByRules(c *gin.Context) {
	var req struct {
		BoardID       string `json:"board_id" binding:"required"`
		Replace       *bool  `json:"replace,omitempty"`
		MinGapSeconds int    `json:"min_gap_seconds,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&board); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "board not found"})
		return
	}
	rules := make([]models.SessionSplitRule, 0, len(board.SessionRules))
	for _, rule := range board.SessionRules {
		if rule.Enabled {
			rules = append(rules, rule)
		}
	}
	if len(rules) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no enabled session split rules"})
		return
	}
	if board.ProtocolID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "board has no protocol"})
		return
	}
	var proto models.ProtocolSpec
	if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": board.ProtocolID}).Decode(&proto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "board protocol not found"})
		return
	}

	minGap := time.Duration(req.MinGapSeconds) * time.Second
	if minGap <= 0 {
		minGap = time.Second
	}

	cur, err := h.db.UartData().Find(
		ctx,
		bson.M{"board_id": boardID},
		options.Find().
			SetSort(bson.D{{Key: "timestamp", Value: 1}}).
			SetProjection(bson.M{
				"timestamp": 1,
				"raw_hex":   1,
				"direction": 1,
			}).
			SetBatchSize(1000),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer cur.Close(ctx)

	var firstTs, lastTs time.Time
	cuts := make([]time.Time, 0, 32)
	var lastCut time.Time
	for cur.Next(ctx) {
		var doc models.UartData
		if err := cur.Decode(&doc); err != nil {
			continue
		}
		if firstTs.IsZero() {
			firstTs = doc.Timestamp
		}
		lastTs = doc.Timestamp

		parsed := protocol.ParseForStorage(doc.RawHex, proto.ID, &proto)
		if parsed == nil {
			continue
		}
		matched := false
		for _, rule := range rules {
			if sessionRuleMatches(rule, parsed, doc.Direction) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		if !lastCut.IsZero() && doc.Timestamp.Sub(lastCut) < minGap {
			continue
		}
		lastCut = doc.Timestamp
		cuts = append(cuts, doc.Timestamp)
	}
	if err := cur.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	if firstTs.IsZero() {
		c.JSON(http.StatusOK, gin.H{"sessions_created": 0, "cuts": 0, "rows_assigned": 0})
		return
	}
	if len(cuts) == 0 {
		c.JSON(http.StatusOK, gin.H{"sessions_created": 0, "cuts": 0, "rows_assigned": 0})
		return
	}

	replace := true
	if req.Replace != nil {
		replace = *req.Replace
	}
	if replace {
		if _, err := h.db.Sessions().DeleteMany(ctx, bson.M{"board_id": boardID}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear sessions"})
			return
		}
		if _, err := h.db.UartData().UpdateMany(
			ctx,
			bson.M{"board_id": boardID},
			bson.M{"$unset": bson.M{"session_id": ""}},
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset session assignment"})
			return
		}
	}

	boundaries := make([]time.Time, 0, len(cuts)+2)
	boundaries = append(boundaries, firstTs)
	for _, cut := range cuts {
		if cut.After(firstTs) && cut.Before(lastTs) {
			boundaries = append(boundaries, cut)
		}
	}
	boundaries = append(boundaries, lastTs)

	created := 0
	var rowsAssigned int64
	for i := 0; i < len(boundaries)-1; i += 1 {
		start := boundaries[i]
		end := boundaries[i+1]
		if !end.After(start) {
			continue
		}
		sessionID := uuid.NewString()
		session := models.Session{
			ID:        sessionID,
			BoardID:   boardID,
			Name:      fmt.Sprintf("Rule split %d", i+1),
			Tags:      []string{"rule-split"},
			StartTime: start,
			EndTime:   end,
			CreatedAt: time.Now(),
		}
		if i == len(boundaries)-2 {
			// Last segment includes the final packet.
			res, err := h.db.UartData().UpdateMany(ctx,
				bson.M{"board_id": boardID, "timestamp": bson.M{"$gte": start, "$lte": end}},
				bson.M{"$set": bson.M{"session_id": sessionID}},
			)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to assign session"})
				return
			}
			if res.ModifiedCount == 0 {
				continue
			}
			rowsAssigned += res.ModifiedCount
		} else {
			res, err := h.db.UartData().UpdateMany(ctx,
				bson.M{"board_id": boardID, "timestamp": bson.M{"$gte": start, "$lt": end}},
				bson.M{"$set": bson.M{"session_id": sessionID}},
			)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to assign session"})
				return
			}
			if res.ModifiedCount == 0 {
				continue
			}
			rowsAssigned += res.ModifiedCount
		}
		if _, err := h.db.Sessions().InsertOne(ctx, session); err != nil {
			h.logger.Error("failed to insert split session", zap.Error(err))
			continue
		}
		created += 1
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions_created": created,
		"cuts":             len(cuts),
		"rows_assigned":    rowsAssigned,
	})
}
