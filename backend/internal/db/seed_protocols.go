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
	if _, _, err := m.EnsureLCPProtocol(ctx); err != nil {
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

// EnsureLCPProtocol inserts or refreshes the built-in LCP/OSP RPC protocol spec.
// It reports whether a new document was created. Installations that predate the
// stable id are matched by their legacy display name and migrated in place, so
// existing references to the protocol keep working and no duplicate is created.
func (m *MongoDB) EnsureLCPProtocol(ctx context.Context) (models.ProtocolSpec, bool, error) {
	spec := protocol.DefaultLCPProtocolSpec(protocol.LCPProtocolID)
	now := time.Now()

	result, err := m.Protocols().UpdateMany(ctx, lcpProtocolMatchFilter(spec.Name), bson.M{"$set": bson.M{
		"parse_rules": spec.ParseRules,
		"version":     spec.Version,
		"description": spec.Description,
		"updated_at":  now,
	}})
	if err != nil {
		return spec, false, err
	}

	// Built-in documents still carrying the pre-2.0 name adopt the canonical one.
	// Protocols renamed by hand keep their label because they never match here.
	if _, err := m.Protocols().UpdateMany(ctx, bson.M{"name": protocol.LCPProtocolLegacyName}, bson.M{"$set": bson.M{
		"name":       spec.Name,
		"updated_at": now,
	}}); err != nil {
		return spec, false, err
	}

	if result.MatchedCount > 0 {
		m.logger.Info("synced built-in LCP protocol parse_rules", zap.Int64("documents", result.MatchedCount))
		return spec, false, nil
	}

	spec.CreatedAt = now
	spec.UpdatedAt = now
	if _, err := m.Protocols().InsertOne(ctx, spec); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return spec, false, nil
		}
		return spec, false, err
	}
	m.logger.Info("seeded protocol", zap.String("id", spec.ID), zap.String("name", spec.Name))
	return spec, true, nil
}

// lcpProtocolMatchFilter matches the built-in LCP protocol by its stable id or by
// any display name it has shipped under.
func lcpProtocolMatchFilter(canonicalName string) bson.M {
	return bson.M{"$or": []bson.M{
		{"_id": protocol.LCPProtocolID},
		{"name": canonicalName},
		{"name": protocol.LCPProtocolLegacyName},
	}}
}
