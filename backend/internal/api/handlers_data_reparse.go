package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

const dataReparseJobsCollection = "data_reparse_jobs"
const dataReparseBatchSize = 500

var (
	reparseJobsMu     sync.Mutex
	reparseJobCancels = map[string]context.CancelFunc{}
)

type dataReparseJob struct {
	ID              string     `bson:"_id" json:"id"`
	BoardID         string     `bson:"board_id" json:"board_id"`
	ProtocolID      string     `bson:"protocol_id" json:"protocol_id"`
	ProtocolVersion string     `bson:"protocol_version" json:"protocol_version"`
	Mode            string     `bson:"mode" json:"mode"`
	Since           *time.Time `bson:"since,omitempty" json:"since,omitempty"`
	Until           *time.Time `bson:"until,omitempty" json:"until,omitempty"`
	SessionID       string     `bson:"session_id,omitempty" json:"session_id,omitempty"`
	Direction       string     `bson:"direction,omitempty" json:"direction,omitempty"`
	BackupParsed    bool       `bson:"backup_parsed" json:"backup_parsed"`
	ClearRollups    bool       `bson:"clear_rollups" json:"clear_rollups"`
	State           string     `bson:"state" json:"state"`
	Phase           string     `bson:"phase" json:"phase"`
	Total           int64      `bson:"total" json:"total"`
	Processed       int64      `bson:"processed" json:"processed"`
	Success         int64      `bson:"success" json:"success"`
	Failed          int64      `bson:"failed" json:"failed"`
	Skipped         int64      `bson:"skipped" json:"skipped"`
	RollupsCleared  int64      `bson:"rollups_cleared" json:"rollups_cleared"`
	CancelRequested bool       `bson:"cancel_requested" json:"cancel_requested"`
	Error           string     `bson:"error,omitempty" json:"error,omitempty"`
	CreatedAt       time.Time  `bson:"created_at" json:"created_at"`
	StartedAt       time.Time  `bson:"started_at" json:"started_at"`
	UpdatedAt       time.Time  `bson:"updated_at" json:"updated_at"`
	FinishedAt      *time.Time `bson:"finished_at,omitempty" json:"finished_at,omitempty"`
}

type dataReparseRequest struct {
	BoardID      string `json:"board_id" binding:"required"`
	ProtocolID   string `json:"protocol_id" binding:"required"`
	Since        string `json:"since,omitempty"`
	Until        string `json:"until,omitempty"`
	SessionID    string `json:"session_id,omitempty"`
	Direction    string `json:"direction,omitempty"`
	Mode         string `json:"mode,omitempty"`
	BackupParsed bool   `json:"backup_parsed,omitempty"`
	ClearRollups *bool  `json:"clear_rollups,omitempty"`
}

func missingParsedFieldsFilter() bson.M {
	return bson.M{"$or": []bson.M{
		{"parsed_fields": bson.M{"$exists": false}},
		{"parsed_fields": nil},
		{"parsed_fields": bson.M{}},
	}}
}

func reparseBatchFilter(base bson.M, lastID string) bson.M {
	if lastID == "" {
		return base
	}
	return bson.M{"$and": []bson.M{base, {"_id": bson.M{"$gt": lastID}}}}
}

func (h *Handler) updateReparseJob(jobID string, update bson.M) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	update["updated_at"] = time.Now().UTC()
	if _, err := h.db.Collection(dataReparseJobsCollection).UpdateOne(
		ctx,
		bson.M{"_id": jobID},
		bson.M{"$set": update},
	); err != nil {
		h.logger.Warn("failed to update reparse job", zap.String("job_id", jobID), zap.Error(err))
	}
}

func (h *Handler) StartDataReparse(c *gin.Context) {
	var req dataReparseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Mode = strings.ToLower(strings.TrimSpace(req.Mode))
	if req.Mode == "" {
		req.Mode = "missing"
	}
	if req.Mode != "missing" && req.Mode != "all" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be missing or all"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var proto models.ProtocolSpec
	if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": req.ProtocolID}).Decode(&proto); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "protocol not found"})
		return
	}
	if proto.ParseRules == nil || len(proto.ParseRules.Fields) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "protocol has no parse rules"})
		return
	}

	var since, until *time.Time
	if raw := strings.TrimSpace(req.Since); raw != "" {
		t, parseErr := parseTimeQuery(raw)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid since"})
			return
		}
		since = &t
	}
	if raw := strings.TrimSpace(req.Until); raw != "" {
		t, parseErr := parseTimeQuery(raw)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid until"})
			return
		}
		until = &t
	}
	if since != nil && until != nil && until.Before(*since) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "until must be after since"})
		return
	}

	base := bson.M{"board_id": boardID}
	timeFilter := bson.M{}
	if since != nil {
		timeFilter["$gte"] = *since
	}
	if until != nil {
		timeFilter["$lte"] = *until
	}
	if len(timeFilter) > 0 {
		base["timestamp"] = timeFilter
	}
	if req.SessionID != "" {
		base["session_id"] = req.SessionID
	}
	if req.Direction != "" {
		base["direction"] = strings.ToUpper(req.Direction)
	}

	filter := base
	if req.Mode == "missing" {
		filter = bson.M{"$and": []bson.M{base, missingParsedFieldsFilter()}}
	}

	total, err := h.db.UartData().CountDocuments(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count uart data"})
		return
	}

	running, err := h.db.Collection(dataReparseJobsCollection).CountDocuments(ctx, bson.M{
		"board_id": boardID,
		"state":    bson.M{"$in": []string{"running", "canceling"}},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check running jobs"})
		return
	}
	if running > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "a reparse job is already running for this board"})
		return
	}

	clearRollups := true
	if req.ClearRollups != nil {
		clearRollups = *req.ClearRollups
	}
	now := time.Now().UTC()
	job := dataReparseJob{
		ID:              uuid.NewString(),
		BoardID:         boardID,
		ProtocolID:      proto.ID,
		ProtocolVersion: proto.Version,
		Mode:            req.Mode,
		Since:           since,
		Until:           until,
		SessionID:       req.SessionID,
		Direction:       strings.ToUpper(req.Direction),
		BackupParsed:    req.BackupParsed,
		ClearRollups:    clearRollups,
		State:           "running",
		Phase:           "parse",
		Total:           total,
		CreatedAt:       now,
		StartedAt:       now,
		UpdatedAt:       now,
	}
	if _, err := h.db.Collection(dataReparseJobsCollection).InsertOne(ctx, job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create reparse job"})
		return
	}

	jobCtx, jobCancel := context.WithCancel(context.Background())
	reparseJobsMu.Lock()
	reparseJobCancels[job.ID] = jobCancel
	reparseJobsMu.Unlock()

	go h.runDataReparse(jobCtx, job, filter, &proto)

	c.JSON(http.StatusAccepted, gin.H{"job_id": job.ID, "total": total})
}

func (h *Handler) GetDataReparseJob(c *gin.Context) {
	jobID := c.Param("job_id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var job dataReparseJob
	if err := h.db.Collection(dataReparseJobsCollection).FindOne(
		ctx,
		bson.M{"_id": jobID},
	).Decode(&job); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "reparse job not found"})
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *Handler) CancelDataReparseJob(c *gin.Context) {
	jobID := c.Param("job_id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var job dataReparseJob
	if err := h.db.Collection(dataReparseJobsCollection).FindOne(
		ctx,
		bson.M{"_id": jobID},
	).Decode(&job); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "reparse job not found"})
		return
	}
	if job.State != "running" && job.State != "canceling" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job is not running"})
		return
	}

	reparseJobsMu.Lock()
	if cancelFn, ok := reparseJobCancels[jobID]; ok {
		cancelFn()
	}
	reparseJobsMu.Unlock()

	h.updateReparseJob(jobID, bson.M{
		"state":            "canceling",
		"cancel_requested": true,
	})
	c.JSON(http.StatusOK, gin.H{"message": "canceling"})
}

func (h *Handler) runDataReparse(
	ctx context.Context,
	job dataReparseJob,
	filter bson.M,
	proto *models.ProtocolSpec,
) {
	defer func() {
		reparseJobsMu.Lock()
		delete(reparseJobCancels, job.ID)
		reparseJobsMu.Unlock()
	}()

	var processed, success, failed int64
	fail := func(err error) {
		finished := time.Now().UTC()
		h.updateReparseJob(job.ID, bson.M{
			"state":       "failed",
			"error":       err.Error(),
			"finished_at": finished,
		})
	}
	markCanceled := func() {
		finished := time.Now().UTC()
		h.updateReparseJob(job.ID, bson.M{
			"state":            "canceled",
			"processed":        processed,
			"success":          success,
			"failed":           failed,
			"finished_at":      finished,
			"cancel_requested": true,
		})
	}

	lastID := ""
	for {
		select {
		case <-ctx.Done():
			markCanceled()
			return
		default:
		}

		batchCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		cur, err := h.db.UartData().Find(
			batchCtx,
			reparseBatchFilter(filter, lastID),
			options.Find().
				SetSort(bson.D{{Key: "_id", Value: 1}}).
				SetLimit(dataReparseBatchSize).
				SetProjection(bson.M{
					"_id":           1,
					"raw_hex":       1,
					"parsed_fields": 1,
				}),
		)
		if err != nil {
			cancel()
			if ctx.Err() != nil {
				markCanceled()
				return
			}
			fail(err)
			return
		}
		var docs []models.UartData
		err = cur.All(batchCtx, &docs)
		_ = cur.Close(batchCtx)
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				markCanceled()
				return
			}
			fail(err)
			return
		}
		if len(docs) == 0 {
			break
		}

		now := time.Now().UTC()
		writes := make([]mongo.WriteModel, 0, len(docs))
		for _, doc := range docs {
			parsed := protocol.ParseForStorage(doc.RawHex, proto.ID, proto)
			parsedAt := now
			update := bson.M{}
			set := bson.M{
				"parse_protocol_id":      proto.ID,
				"parse_protocol_version": proto.Version,
				"parsed_at":              parsedAt,
			}
			if parsed != nil {
				set["parsed_fields"] = parsed
				set["parse_status"] = "ok"
				success++
			} else {
				set["parse_status"] = "failed"
				failed++
				if job.Mode == "all" {
					update["$unset"] = bson.M{"parsed_fields": ""}
				}
			}
			if job.BackupParsed && len(doc.ParsedFields) > 0 {
				set["parsed_fields_prev"] = doc.ParsedFields
			}
			update["$set"] = set
			writes = append(writes, mongo.NewUpdateOneModel().
				SetFilter(bson.M{"_id": doc.ID}).
				SetUpdate(update))
		}
		if len(writes) > 0 {
			writeCtx, writeCancel := context.WithTimeout(ctx, 60*time.Second)
			_, err = h.db.UartData().BulkWrite(writeCtx, writes, options.BulkWrite().SetOrdered(false))
			writeCancel()
			if err != nil {
				if ctx.Err() != nil {
					markCanceled()
					return
				}
				fail(err)
				return
			}
		}
		processed += int64(len(docs))
		lastID = docs[len(docs)-1].ID
		h.updateReparseJob(job.ID, bson.M{
			"processed": processed,
			"success":   success,
			"failed":    failed,
		})
	}

	if job.ClearRollups {
		h.updateReparseJob(job.ID, bson.M{"phase": "rollups"})
		rollupFilter := bson.M{"board_id": job.BoardID}
		rangeFilter := bson.M{}
		if job.Since != nil {
			rangeFilter["$gte"] = *job.Since
		}
		if job.Until != nil {
			rangeFilter["$lte"] = *job.Until
		}
		if len(rangeFilter) > 0 {
			rollupFilter["bucket_start"] = rangeFilter
		}
		delCtx, delCancel := context.WithTimeout(ctx, 60*time.Second)
		res, err := h.db.VizRollups().DeleteMany(delCtx, rollupFilter)
		delCancel()
		if err != nil {
			fail(fmt.Errorf("clear rollups: %w", err))
			return
		}
		h.updateReparseJob(job.ID, bson.M{
			"rollups_cleared": res.DeletedCount,
		})
	}

	finished := time.Now().UTC()
	h.updateReparseJob(job.ID, bson.M{
		"state":       "done",
		"phase":       "done",
		"processed":   processed,
		"success":     success,
		"failed":      failed,
		"finished_at": finished,
	})
}
