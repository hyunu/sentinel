package db

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"
)

// EnsureProtocols inserts built-in protocol specs when missing and keeps parse_rules in sync.
func (m *MongoDB) EnsureProtocols(ctx context.Context) error {
	if err := m.ensureTemperatureProtocol(ctx); err != nil {
		return err
	}
	return nil
}

func (m *MongoDB) ensureTemperatureProtocol(ctx context.Context) error {
	id := protocol.TemperatureProtocolID
	spec := protocol.TemperatureTelemetrySpec(id)
	now := time.Now()

	var existing models.ProtocolSpec
	err := m.Protocols().FindOne(ctx, bson.M{"_id": id}).Decode(&existing)
	if err == mongo.ErrNoDocuments {
		spec.CreatedAt = now
		spec.UpdatedAt = now
		if _, err := m.Protocols().InsertOne(ctx, spec); err != nil {
			if mongo.IsDuplicateKeyError(err) {
				return nil
			}
			return err
		}
		m.logger.Info("seeded protocol", zap.String("id", id), zap.String("name", spec.Name))
		return nil
	}
	if err != nil {
		return err
	}

	_, err = m.Protocols().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{
		"parse_rules": spec.ParseRules,
		"name":        spec.Name,
		"version":     spec.Version,
		"description": spec.Description,
		"updated_at":  now,
	}})
	if err != nil {
		return err
	}
	m.logger.Info("synced built-in protocol parse_rules", zap.String("id", id))
	return nil
}
