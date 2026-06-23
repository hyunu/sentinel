package db

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"
)

// EnsureProtocols inserts built-in protocol specs when missing.
func (m *MongoDB) EnsureProtocols(ctx context.Context) error {
	if err := m.ensureTemperatureProtocol(ctx); err != nil {
		return err
	}
	return nil
}

func (m *MongoDB) ensureTemperatureProtocol(ctx context.Context) error {
	id := protocol.TemperatureProtocolID
	count, err := m.Protocols().CountDocuments(ctx, bson.M{"_id": id})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	now := time.Now()
	proto := protocol.TemperatureTelemetrySpec(id)
	proto.CreatedAt = now
	proto.UpdatedAt = now

	if _, err := m.Protocols().InsertOne(ctx, proto); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil
		}
		return err
	}

	m.logger.Info("seeded protocol", zap.String("id", id), zap.String("name", proto.Name))
	return nil
}
