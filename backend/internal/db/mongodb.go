package db

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/config"
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
	CollectionTemperatures = "temperatures"
	CollectionVizProfiles = "viz_profiles"
)

func (m *MongoDB) Boards() *mongo.Collection      { return m.Collection(CollectionBoards) }
func (m *MongoDB) Heartbeats() *mongo.Collection   { return m.Collection(CollectionHeartbeats) }
func (m *MongoDB) UartData() *mongo.Collection     { return m.Collection(CollectionUartData) }
func (m *MongoDB) Sessions() *mongo.Collection     { return m.Collection(CollectionSessions) }
func (m *MongoDB) Protocols() *mongo.Collection    { return m.Collection(CollectionProtocols) }
func (m *MongoDB) Temperatures() *mongo.Collection { return m.Collection(CollectionTemperatures) }
func (m *MongoDB) VizProfiles() *mongo.Collection  { return m.Collection(CollectionVizProfiles) }
