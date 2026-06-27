package api

import (
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

const boardOnlineWindow = 120 * time.Second

func isBoardOnline(b models.Board, now time.Time) bool {
	return b.IsActive && !b.LastHeartbeat.IsZero() && now.Sub(b.LastHeartbeat) < boardOnlineWindow
}
