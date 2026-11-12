package api

import (
	"context"
	"errors"
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

type sessionRuleMatch struct {
	TS   time.Time
	Role string
}

type sessionTimeRange struct {
	Start time.Time
	End   time.Time
}

// sessionRangesFromMatches pairs start and end packets. A start packet opens
// a session and the first following end packet closes it. Repeated starts are
// ignored until the open range closes.
func sessionRangesFromMatches(matches []sessionRuleMatch) ([]sessionTimeRange, int) {
	ranges := make([]sessionTimeRange, 0, 16)
	unclosed := 0
	var open *time.Time
	for _, match := range matches {
		switch match.Role {
		case "start":
			if open == nil {
				start := match.TS
				open = &start
			}
		case "end":
			if open == nil {
				continue
			}
			if match.TS.After(*open) {
				ranges = append(ranges, sessionTimeRange{Start: *open, End: match.TS})
			}
			open = nil
		}
	}
	if open != nil {
		unclosed = 1
	}
	return ranges, unclosed
}

type sessionSplitRequest struct {
	BoardID       string `json:"board_id" binding:"required"`
	Replace       *bool  `json:"replace,omitempty"`
	MinGapSeconds int    `json:"min_gap_seconds,omitempty"`
	// Start/End optionally limit the split to a time window.
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
}

type sessionSplitResult struct {
	SessionsCreated int    `json:"sessions_created"`
	Cuts            int    `json:"cuts"`
	Ranges          int    `json:"ranges"`
	RowsAssigned    int64  `json:"rows_assigned"`
	UnclosedStarts  int    `json:"unclosed_starts"`
	Mode            string `json:"mode"`
}

type sessionSplitSetup struct {
	BoardID  string
	Board    models.Board
	Rules    []models.SessionSplitRule
	Mode     string
	Protocol models.ProtocolSpec
}

func (h *Handler) prepareSessionSplit(
	ctx context.Context,
	req sessionSplitRequest,
) (*sessionSplitSetup, int, error) {
	boardID, err := h.resolveBoardID(ctx, req.BoardID, "")
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	var board models.Board
	if err := h.db.Boards().FindOne(ctx, bson.M{"_id": boardID}).Decode(&board); err != nil {
		return nil, http.StatusNotFound, errors.New("board not found")
	}
	mode := strings.ToLower(strings.TrimSpace(board.SessionRuleMode))
	if mode == "" {
		mode = "cut"
	}
	if mode != "cut" && mode != "range" {
		return nil, http.StatusBadRequest, errors.New("invalid session rule mode")
	}

	rules := make([]models.SessionSplitRule, 0, len(board.SessionRules))
	for _, rule := range board.SessionRules {
		if rule.Enabled {
			rules = append(rules, rule)
		}
	}
	if len(rules) == 0 {
		return nil, http.StatusBadRequest, errors.New("no enabled session split rules")
	}
	if mode == "range" {
		hasStart, hasEnd := false, false
		for _, rule := range rules {
			switch strings.ToLower(strings.TrimSpace(rule.Role)) {
			case "start":
				hasStart = true
			case "end":
				hasEnd = true
			}
		}
		if !hasStart || !hasEnd {
			return nil, http.StatusBadRequest, errors.New("range mode requires at least one start and one end rule")
		}
	}
	if board.ProtocolID == "" {
		return nil, http.StatusBadRequest, errors.New("board has no protocol")
	}
	var proto models.ProtocolSpec
	if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": board.ProtocolID}).Decode(&proto); err != nil {
		return nil, http.StatusBadRequest, errors.New("board protocol not found")
	}

	return &sessionSplitSetup{
		BoardID:  boardID,
		Board:    board,
		Rules:    rules,
		Mode:     mode,
		Protocol: proto,
	}, 0, nil
}

// executeSessionSplit scans the selected range, builds session ranges and
// assigns unassigned rows. It is shared by the synchronous endpoint and the
// asynchronous job worker. onProgress receives the scanned row count.
func (h *Handler) executeSessionSplit(
	ctx context.Context,
	req sessionSplitRequest,
	setup *sessionSplitSetup,
	onProgress func(processed int64),
	onPhase func(phase string),
) (sessionSplitResult, error) {
	result := sessionSplitResult{Mode: setup.Mode}

	filter := bson.M{"board_id": setup.BoardID}
	if req.Start != "" || req.End != "" {
		timeFilter := bson.M{}
		if req.Start != "" {
			start, err := parseTimeQuery(req.Start)
			if err != nil {
				return result, errors.New("invalid start")
			}
			timeFilter["$gte"] = start
		}
		if req.End != "" {
			end, err := parseTimeQuery(req.End)
			if err != nil {
				return result, errors.New("invalid end")
			}
			timeFilter["$lte"] = end
		}
		filter["timestamp"] = timeFilter
	}

	cur, err := h.db.UartData().Find(
		ctx,
		filter,
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
		return result, err
	}
	defer cur.Close(ctx)

	matches := make([]sessionRuleMatch, 0, 64)
	var firstTs, lastTs time.Time
	var processed int64
	for cur.Next(ctx) {
		processed += 1
		if processed%1000 == 0 {
			if onProgress != nil {
				onProgress(processed)
			}
			if err := ctx.Err(); err != nil {
				return result, err
			}
		}
		var doc models.UartData
		if err := cur.Decode(&doc); err != nil {
			continue
		}
		if firstTs.IsZero() {
			firstTs = doc.Timestamp
		}
		lastTs = doc.Timestamp

		parsed := protocol.ParseForStorage(doc.RawHex, setup.Protocol.ID, &setup.Protocol)
		if parsed == nil {
			continue
		}
		role := ""
		matched := false
		for _, rule := range setup.Rules {
			if !sessionRuleMatches(rule, parsed, doc.Direction) {
				continue
			}
			matched = true
			if setup.Mode == "range" {
				// The first matching rule in list order decides the role.
				role = strings.ToLower(strings.TrimSpace(rule.Role))
			}
			break
		}
		if !matched {
			continue
		}
		if setup.Mode == "range" && role != "start" && role != "end" {
			continue
		}
		matches = append(matches, sessionRuleMatch{TS: doc.Timestamp, Role: role})
	}
	if err := cur.Err(); err != nil {
		return result, err
	}
	if onProgress != nil {
		onProgress(processed)
	}

	ranges := make([]sessionTimeRange, 0, 32)
	cuts := make([]time.Time, 0, 32)
	unclosedStarts := 0
	if setup.Mode == "range" {
		ranges, unclosedStarts = sessionRangesFromMatches(matches)
	} else {
		minGap := time.Duration(req.MinGapSeconds) * time.Second
		if minGap <= 0 {
			minGap = time.Second
		}
		var lastCut time.Time
		for _, match := range matches {
			if !lastCut.IsZero() && match.TS.Sub(lastCut) < minGap {
				continue
			}
			lastCut = match.TS
			cuts = append(cuts, match.TS)
		}
		if firstTs.IsZero() || len(cuts) == 0 {
			return result, nil
		}
		boundaries := make([]time.Time, 0, len(cuts)+2)
		boundaries = append(boundaries, firstTs)
		for _, cut := range cuts {
			if cut.After(firstTs) && cut.Before(lastTs) {
				boundaries = append(boundaries, cut)
			}
		}
		boundaries = append(boundaries, lastTs)
		for i := 0; i < len(boundaries)-1; i += 1 {
			if boundaries[i+1].After(boundaries[i]) {
				ranges = append(ranges, sessionTimeRange{Start: boundaries[i], End: boundaries[i+1]})
			}
		}
	}

	result.Cuts = len(cuts)
	result.UnclosedStarts = unclosedStarts
	result.Ranges = len(ranges)
	if len(ranges) == 0 {
		return result, nil
	}
	if onPhase != nil {
		onPhase("create")
	}

	replace := true
	if req.Replace != nil {
		replace = *req.Replace
	}
	if replace {
		if _, err := h.db.Sessions().DeleteMany(ctx, bson.M{"board_id": setup.BoardID}); err != nil {
			return result, errors.New("failed to clear sessions")
		}
		if _, err := h.db.UartData().UpdateMany(
			ctx,
			bson.M{"board_id": setup.BoardID},
			bson.M{"$unset": bson.M{"session_id": ""}},
		); err != nil {
			return result, errors.New("failed to reset session assignment")
		}
	}

	assign := func(sessionID string, start time.Time, inclusiveEnd bool, end time.Time) (int64, error) {
		tsFilter := bson.M{"$gte": start}
		if inclusiveEnd {
			tsFilter["$lte"] = end
		} else {
			tsFilter["$lt"] = end
		}
		res, err := h.db.UartData().UpdateMany(ctx,
			bson.M{
				"board_id":   setup.BoardID,
				"timestamp":  tsFilter,
				"session_id": bson.M{"$exists": false},
			},
			bson.M{"$set": bson.M{"session_id": sessionID}},
		)
		if err != nil {
			return 0, err
		}
		return res.ModifiedCount, nil
	}

	for i, item := range ranges {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if !item.End.After(item.Start) {
			continue
		}
		sessionID := uuid.NewString()
		name := fmt.Sprintf("Rule split %d", i+1)
		if setup.Mode == "range" {
			name = fmt.Sprintf("Packet range %d", i+1)
		}
		session := models.Session{
			ID:        sessionID,
			BoardID:   setup.BoardID,
			Name:      name,
			Tags:      []string{"rule-split"},
			StartTime: item.Start,
			EndTime:   item.End,
			CreatedAt: time.Now(),
		}
		// Cut mode excludes the end boundary from all but the final segment so
		// boundary packets are not assigned twice. Range mode includes the end
		// packet because it is the closing marker.
		inclusiveEnd := setup.Mode == "range" || i == len(ranges)-1
		modified, err := assign(sessionID, item.Start, inclusiveEnd, item.End)
		if err != nil {
			return result, errors.New("failed to assign session")
		}
		if modified == 0 {
			continue
		}
		result.RowsAssigned += modified
		if _, err := h.db.Sessions().InsertOne(ctx, session); err != nil {
			h.logger.Error("failed to insert split session", zap.Error(err))
			continue
		}
		result.SessionsCreated += 1
	}

	return result, nil
}

// SplitSessionsByRules builds sessions from packets matching the board's
// configured rules. It supports two modes:
//
//	cut   - every matching packet is a boundary; sessions fill the segments
//	        between cuts.
//	range - rules with role "start" open a session and rules with role "end"
//	        close it; only the covered ranges become sessions.
//
// Idle gaps are never used as boundaries.
func (h *Handler) SplitSessionsByRules(c *gin.Context) {
	var req sessionSplitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 180*time.Second)
	defer cancel()

	setup, status, err := h.prepareSessionSplit(ctx, req)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	result, err := h.executeSessionSplit(ctx, req, setup, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
