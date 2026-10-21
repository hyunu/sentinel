package db

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"
)

// EnsureSchemaPresets inserts built-in schema presets when missing and keeps
// their parse rules in sync with the embedded defaults.
func (m *MongoDB) EnsureSchemaPresets(ctx context.Context) error {
	for _, preset := range protocol.DefaultSchemaPresets(time.Now()) {
		result, err := m.SchemaPresets().UpdateOne(ctx, bson.M{"_id": preset.ID}, bson.M{"$set": bson.M{
			"description":      preset.Description,
			"protocol_version": preset.ProtocolVersion,
			"parse_rules":      preset.ParseRules,
			"updated_at":       preset.UpdatedAt,
		}})
		if err != nil {
			return err
		}
		if result.MatchedCount > 0 {
			m.logger.Info("synced schema preset parse_rules", zap.String("id", preset.ID))
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
