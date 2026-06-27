package db

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"
)

// EnsureSchemaPresets inserts built-in schema presets when missing.
func (m *MongoDB) EnsureSchemaPresets(ctx context.Context) error {
	for _, preset := range protocol.DefaultSchemaPresets(time.Now()) {
		count, err := m.SchemaPresets().CountDocuments(ctx, bson.M{"_id": preset.ID})
		if err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if _, err := m.SchemaPresets().InsertOne(ctx, preset); err != nil {
			if mongo.IsDuplicateKeyError(err) {
				continue
			}
			return err
		}
		m.logger.Info("seeded schema preset", zap.String("id", preset.ID), zap.String("name", preset.Name))
	}
	return nil
}
