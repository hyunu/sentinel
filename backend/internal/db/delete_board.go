package db

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"
)

var ErrBoardNotFound = errors.New("board not found")

// BoardDeleteStats counts documents removed during cascade delete.
type BoardDeleteStats struct {
	UartData     int64 `json:"uart_data"`
	Sessions     int64 `json:"sessions"`
	Temperatures int64 `json:"temperatures"`
	Heartbeats   int64 `json:"heartbeats"`
	VizProfiles  int64 `json:"viz_profiles"`
}

// DeleteBoardCascade removes a board and all documents that reference its id.
func (m *MongoDB) DeleteBoardCascade(ctx context.Context, boardID string) (BoardDeleteStats, error) {
	var stats BoardDeleteStats

	count, err := m.Boards().CountDocuments(ctx, bson.M{"_id": boardID})
	if err != nil {
		return stats, fmt.Errorf("count board: %w", err)
	}
	if count == 0 {
		return stats, ErrBoardNotFound
	}

	filter := bson.M{"board_id": boardID}

	if res, err := m.UartData().DeleteMany(ctx, filter); err != nil {
		return stats, fmt.Errorf("delete uart data: %w", err)
	} else {
		stats.UartData = res.DeletedCount
	}

	if res, err := m.Sessions().DeleteMany(ctx, filter); err != nil {
		return stats, fmt.Errorf("delete sessions: %w", err)
	} else {
		stats.Sessions = res.DeletedCount
	}

	if res, err := m.Temperatures().DeleteMany(ctx, filter); err != nil {
		return stats, fmt.Errorf("delete temperatures: %w", err)
	} else {
		stats.Temperatures = res.DeletedCount
	}

	if res, err := m.Heartbeats().DeleteMany(ctx, filter); err != nil {
		return stats, fmt.Errorf("delete heartbeats: %w", err)
	} else {
		stats.Heartbeats = res.DeletedCount
	}

	if res, err := m.VizProfiles().DeleteMany(ctx, filter); err != nil {
		return stats, fmt.Errorf("delete viz profiles: %w", err)
	} else {
		stats.VizProfiles = res.DeletedCount
	}

	if res, err := m.Boards().DeleteOne(ctx, bson.M{"_id": boardID}); err != nil {
		return stats, fmt.Errorf("delete board: %w", err)
	} else if res.DeletedCount == 0 {
		return stats, ErrBoardNotFound
	}

	return stats, nil
}
