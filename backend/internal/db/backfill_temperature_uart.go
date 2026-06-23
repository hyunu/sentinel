package db

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

const backfillCounterID = "temp_uart_backfill_v1"

// BackfillTemperatureUart converts historical temperature rows into UART records
// so Data Viewer can parse them with the Temperature Telemetry protocol.
func (m *MongoDB) BackfillTemperatureUart(ctx context.Context) error {
	var marker models.CounterSeq
	err := m.Counters().FindOne(ctx, bson.M{"_id": backfillCounterID}).Decode(&marker)
	if err == nil && marker.Value > 0 {
		return nil
	}

	cursor, err := m.Temperatures().Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"timestamp": 1}))
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)

	var seq uint16
	inserted := 0
	for cursor.Next(ctx) {
		var temp models.Temperature
		if err := cursor.Decode(&temp); err != nil {
			continue
		}
		seq++
		rawHex, parsed, err := protocol.BuildTemperatureFrameFromValue(seq, float32(temp.ValueCelsius))
		if err != nil {
			continue
		}
		doc := models.UartData{
			ID:           uuid.New().String(),
			BoardID:      temp.BoardID,
			Timestamp:    temp.Timestamp,
			RawHex:       rawHex,
			Direction:    "RX",
			ParsedFields: parsed,
		}
		if _, err := m.UartData().InsertOne(ctx, doc); err != nil {
			m.logger.Warn("backfill uart insert failed", zap.Error(err))
			continue
		}
		inserted++
	}

	_, _ = m.Counters().UpdateOne(
		ctx,
		bson.M{"_id": backfillCounterID},
		bson.M{"$set": bson.M{"value": 1}},
		options.Update().SetUpsert(true),
	)

	if inserted > 0 {
		m.logger.Info("backfilled temperature uart frames", zap.Int("count", inserted))
	}
	return nil
}

func (m *MongoDB) InsertTemperatureUartFrame(ctx context.Context, boardID string, ts time.Time, tempC float64) error {
	seqVal, err := m.GetNextSequence(ctx, "temperature_frame_seq")
	if err != nil {
		return fmt.Errorf("frame seq: %w", err)
	}
	rawHex, parsed, err := protocol.BuildTemperatureFrameFromValue(uint16(seqVal&0xFFFF), float32(tempC))
	if err != nil {
		return err
	}
	doc := models.UartData{
		ID:           uuid.New().String(),
		BoardID:      boardID,
		Timestamp:    ts,
		RawHex:       rawHex,
		Direction:    "RX",
		ParsedFields: parsed,
	}
	_, err = m.UartData().InsertOne(ctx, doc)
	return err
}
