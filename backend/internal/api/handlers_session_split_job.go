package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.uber.org/zap"
)

const sessionSplitJobsCollection = "session_split_jobs"

var (
	sessionSplitJobsMu     sync.Mutex
	sessionSplitJobCancels = map[string]context.CancelFunc{}
)

type sessionSplitJob struct {
	ID              string     `bson:"_id" json:"id"`
	BoardID         string     `bson:"board_id" json:"board_id"`
	Mode            string     `bson:"mode" json:"mode"`
	State           string     `bson:"state" json:"state"`
	Phase           string     `bson:"phase" json:"phase"`
	Processed       int64      `bson:"processed" json:"processed"`
	SessionsCreated int        `bson:"sessions_created" json:"sessions_created"`
	RowsAssigned    int64      `bson:"rows_assigned" json:"rows_assigned"`
	Cuts            int        `bson:"cuts" json:"cuts"`
	Ranges          int        `bson:"ranges" json:"ranges"`
	UnclosedStarts  int        `bson:"unclosed_starts" json:"unclosed_starts"`
	Error           string     `bson:"error,omitempty" json:"error,omitempty"`
	CancelRequested bool       `bson:"cancel_requested" json:"cancel_requested"`
	CreatedAt       time.Time  `bson:"created_at" json:"created_at"`
	StartedAt       time.Time  `bson:"started_at" json:"started_at"`
	UpdatedAt       time.Time  `bson:"updated_at" json:"updated_at"`
	FinishedAt      *time.Time `bson:"finished_at,omitempty" json:"finished_at,omitempty"`
}

func (h *Handler) updateSessionSplitJob(jobID string, update bson.M) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	update["updated_at"] = time.Now()
	if _, err := h.db.Collection(sessionSplitJobsCollection).UpdateOne(
		ctx,
		bson.M{"_id": jobID},
		bson.M{"$set": update},
	); err != nil {
		h.logger.Warn("failed to update session split job", zap.String("job_id", jobID), zap.Error(err))
	}
}

// StartSessionSplitJob starts an asynchronous packet-rule split. The worker
// reuses the same code path as the synchronous endpoint.
func (h *Handler) StartSessionSplitJob(c *gin.Context) {
	var req sessionSplitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	boardID, err := h.resolveBoardID(ctx, req.BoardID, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	collection := h.db.Collection(sessionSplitJobsCollection)
	// Clear jobs that were left running by a restart.
	_, _ = collection.UpdateMany(ctx,
		bson.M{
			"state":      "running",
			"updated_at": bson.M{"$lt": time.Now().Add(-2 * time.Hour)},
		},
		bson.M{"$set": bson.M{
			"state":       "failed",
			"error":       "stale job",
			"finished_at": time.Now(),
			"updated_at":  time.Now(),
		}},
	)
	running, err := collection.CountDocuments(ctx, bson.M{"board_id": boardID, "state": "running"})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check running jobs"})
		return
	}
	if running > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "a session split is already running for this board"})
		return
	}

	now := time.Now()
	job := sessionSplitJob{
		ID:        uuid.NewString(),
		BoardID:   boardID,
		State:     "running",
		Phase:     "scan",
		CreatedAt: now,
		StartedAt: now,
		UpdatedAt: now,
	}
	if _, err := collection.InsertOne(ctx, job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create split job"})
		return
	}

	go h.runSessionSplitJob(job, req)

	c.JSON(http.StatusAccepted, job)
}

func (h *Handler) runSessionSplitJob(job sessionSplitJob, req sessionSplitRequest) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sessionSplitJobsMu.Lock()
	sessionSplitJobCancels[job.ID] = cancel
	sessionSplitJobsMu.Unlock()
	defer func() {
		sessionSplitJobsMu.Lock()
		delete(sessionSplitJobCancels, job.ID)
		sessionSplitJobsMu.Unlock()
	}()

	setup, _, err := h.prepareSessionSplit(ctx, req)
	if err != nil {
		h.finishSessionSplitJob(job.ID, "failed", err.Error())
		return
	}
	h.updateSessionSplitJob(job.ID, bson.M{"mode": setup.Mode})

	lastProgress := time.Time{}
	onProgress := func(processed int64) {
		if time.Since(lastProgress) < time.Second && processed > 0 {
			return
		}
		lastProgress = time.Now()
		h.updateSessionSplitJob(job.ID, bson.M{
			"processed": processed,
			"phase":     "scan",
		})
	}
	onPhase := func(phase string) {
		h.updateSessionSplitJob(job.ID, bson.M{"phase": phase})
	}

	result, err := h.executeSessionSplit(ctx, req, setup, onProgress, onPhase)
	if ctx.Err() == context.Canceled {
		h.finishSessionSplitJob(job.ID, "canceled", "")
		return
	}
	if err != nil {
		h.finishSessionSplitJob(job.ID, "failed", err.Error())
		return
	}

	now := time.Now()
	finishCtx, finishCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer finishCancel()
	if _, err := h.db.Collection(sessionSplitJobsCollection).UpdateOne(
		finishCtx,
		bson.M{"_id": job.ID},
		bson.M{"$set": bson.M{
			"state":            "done",
			"phase":            "done",
			"mode":             result.Mode,
			"sessions_created": result.SessionsCreated,
			"rows_assigned":    result.RowsAssigned,
			"cuts":             result.Cuts,
			"ranges":           result.Ranges,
			"unclosed_starts":  result.UnclosedStarts,
			"finished_at":      now,
			"updated_at":       now,
		}},
	); err != nil {
		h.logger.Warn("failed to finish session split job", zap.String("job_id", job.ID), zap.Error(err))
	}
}

func (h *Handler) finishSessionSplitJob(jobID string, state string, message string) {
	now := time.Now()
	update := bson.M{
		"state":       state,
		"finished_at": now,
		"updated_at":  now,
	}
	if message != "" {
		update["error"] = message
	}
	finishCtx, finishCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer finishCancel()
	if _, err := h.db.Collection(sessionSplitJobsCollection).UpdateOne(
		finishCtx,
		bson.M{"_id": jobID},
		bson.M{"$set": update},
	); err != nil {
		h.logger.Warn("failed to finish session split job", zap.String("job_id", jobID), zap.Error(err))
	}
}

func (h *Handler) GetSessionSplitJob(c *gin.Context) {
	jobID := c.Param("job_id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var job sessionSplitJob
	if err := h.db.Collection(sessionSplitJobsCollection).FindOne(
		ctx,
		bson.M{"_id": jobID},
	).Decode(&job); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "split job not found"})
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *Handler) CancelSessionSplitJob(c *gin.Context) {
	jobID := c.Param("job_id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var job sessionSplitJob
	if err := h.db.Collection(sessionSplitJobsCollection).FindOne(
		ctx,
		bson.M{"_id": jobID},
	).Decode(&job); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "split job not found"})
		return
	}
	if job.State != "running" {
		c.JSON(http.StatusOK, job)
		return
	}

	if _, err := h.db.Collection(sessionSplitJobsCollection).UpdateOne(
		ctx,
		bson.M{"_id": jobID},
		bson.M{"$set": bson.M{"cancel_requested": true, "updated_at": time.Now()}},
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel split job"})
		return
	}
	sessionSplitJobsMu.Lock()
	cancelJob := sessionSplitJobCancels[jobID]
	sessionSplitJobsMu.Unlock()
	if cancelJob != nil {
		cancelJob()
	}

	job.CancelRequested = true
	c.JSON(http.StatusOK, job)
}
