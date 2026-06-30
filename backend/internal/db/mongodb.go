package db

import (
	"context"
	"fmt"
	"time"

	"github.com/hyunu/sentinel/internal/config"
	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

type MongoDB struct {
	client *mongo.Client
	db     *mongo.Database
	logger *zap.Logger
}

func New(cfg *config.MongoDBConfig, logger *zap.Logger) (*MongoDB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(cfg.URI))
	if err != nil {
		return nil, err
	}

	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}

	logger.Info("Connected to MongoDB", zap.String("database", cfg.Database))
	return &MongoDB{
		client: client,
		db:     client.Database(cfg.Database),
		logger: logger,
	}, nil
}

func (m *MongoDB) Close(ctx context.Context) error {
	return m.client.Disconnect(ctx)
}

func (m *MongoDB) Collection(name string) *mongo.Collection {
	return m.db.Collection(name)
}

const (
	CollectionBoards      = "boards"
	CollectionHeartbeats  = "heartbeats"
	CollectionUartData    = "uart_data"
	CollectionSessions    = "sessions"
	CollectionProtocols   = "protocols"
	CollectionSchemaPresets = "schema_presets"
	CollectionTemperatures = "temperatures"
	CollectionVizProfiles = "viz_profiles"
	CollectionCounters    = "counters"
)

func (m *MongoDB) Boards() *mongo.Collection      { return m.Collection(CollectionBoards) }
func (m *MongoDB) Heartbeats() *mongo.Collection   { return m.Collection(CollectionHeartbeats) }
func (m *MongoDB) UartData() *mongo.Collection     { return m.Collection(CollectionUartData) }
func (m *MongoDB) Sessions() *mongo.Collection     { return m.Collection(CollectionSessions) }
func (m *MongoDB) Protocols() *mongo.Collection    { return m.Collection(CollectionProtocols) }
func (m *MongoDB) SchemaPresets() *mongo.Collection { return m.Collection(CollectionSchemaPresets) }
func (m *MongoDB) Temperatures() *mongo.Collection { return m.Collection(CollectionTemperatures) }
func (m *MongoDB) VizProfiles() *mongo.Collection  { return m.Collection(CollectionVizProfiles) }
func (m *MongoDB) Counters() *mongo.Collection    { return m.Collection(CollectionCounters) }

func (m *MongoDB) EnsureIndexes(ctx context.Context) error {
	_, err := m.Boards().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "uid", Value: 1}},
		Options: options.Index().SetUnique(true).SetSparse(true),
	})
	if err != nil {
		m.logger.Warn("failed to create uid index", zap.Error(err))
	}

	_, err = m.UartData().Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "board_id", Value: 1},
			{Key: "timestamp", Value: -1},
			{Key: "_id", Value: -1},
		},
	})
	if err != nil {
		m.logger.Warn("failed to create uart_data board/timestamp index", zap.Error(err))
	}

	return nil
}

func (m *MongoDB) GetNextSequence(ctx context.Context, name string) (int, error) {
	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var result models.CounterSeq
	if err := m.Counters().FindOneAndUpdate(
		ctx,
		bson.M{"_id": name},
		bson.M{"$inc": bson.M{"value": 1}},
		opts,
	).Decode(&result); err != nil {
		return 0, fmt.Errorf("get next sequence: %w", err)
	}
	return result.Value, nil
}
