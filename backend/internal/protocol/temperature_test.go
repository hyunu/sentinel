package protocol

import (
	"testing"
)

func TestBuildAndParseTemperatureFrame(t *testing.T) {
	spec := TemperatureTelemetrySpec("test-id")
	hexStr, err := BuildTemperatureFrame(1, 0, 25.5, 48)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	fields, err := ParseTemperatureFrame(hexStr, &spec)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	temp, ok := fields["temperature_celsius"].(float64)
	if !ok {
		t.Fatalf("temperature_celsius missing or wrong type: %#v", fields)
	}
	if temp < 25.4 || temp > 25.6 {
		t.Fatalf("expected ~25.5, got %v", temp)
	}

	hum, ok := fields["humidity_percent"].(float64)
	if !ok || hum != 48 {
		t.Fatalf("humidity_percent: %#v", fields["humidity_percent"])
	}
}
