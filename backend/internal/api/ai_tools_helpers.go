package api

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/hyunu/sentinel/internal/ruleparser"
)

var (
	skipFieldNames = map[string]bool{
		"stx": true, "etx": true, "crc16": true, "length": true, "attr": true, "attribute": true,
	}
	skipFieldTypes = map[string]bool{
		"Switch": true, "RepeatCount": true, "Optional": true, "Validate": true, "Bits": true,
	}
	fieldNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.\-\[\]]+$`)
)

// collectParseRuleFieldPaths returns the field paths a visualization or AI tool
// can query from a Serial Parser rule document. Array/repeat containers are
// skipped themselves, while their item fields are included.
func collectParseRuleFieldPaths(doc *ruleparser.JsonRuleDocument) []string {
	if doc == nil || len(doc.Fields) == 0 {
		return nil
	}
	found := make(map[string]bool)
	walkParseRules(doc.Fields, "", found)
	paths := make([]string, 0, len(found))
	for path := range found {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

func walkParseRules(rules []ruleparser.JsonFieldRule, prefix string, found map[string]bool) {
	for _, rule := range rules {
		path := rule.Name
		if prefix != "" {
			path = prefix + "." + rule.Name
		}
		if rule.Name != "" && !skipFieldNames[rule.Name] && !skipFieldTypes[rule.Type] {
			found[path] = true
		}
		walkParseRules(rule.ItemRules, path, found)
		walkParseRules(rule.Rules, path, found)
		walkParseRules(rule.FieldsDef, path, found)
		walkParseRules(rule.Default, path, found)
		walkParseRules(rule.Then, path, found)
		walkParseRules(rule.Else, path, found)
		for _, caseRules := range rule.Cases {
			walkParseRules(caseRules, path, found)
		}
	}
}

func validateFieldName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("field name is required")
	}
	if len(name) > 256 {
		return fmt.Errorf("field name is too long")
	}
	if !fieldNamePattern.MatchString(name) {
		return fmt.Errorf("invalid field name %q", name)
	}
	return nil
}

type timeWindow struct {
	Start time.Time
	End   time.Time
}

func resolveTimeWindow(startRaw, endRaw string, lastMinutes int, now time.Time, maxSpan time.Duration) (timeWindow, error) {
	now = now.UTC()
	if lastMinutes > 0 {
		return timeWindow{Start: now.Add(-time.Duration(lastMinutes) * time.Minute), End: now}, nil
	}

	var start, end time.Time
	var err error
	if strings.TrimSpace(startRaw) != "" {
		start, err = parseAITime(startRaw)
		if err != nil {
			return timeWindow{}, fmt.Errorf("invalid start time: %w", err)
		}
	}
	if strings.TrimSpace(endRaw) != "" {
		end, err = parseAITime(endRaw)
		if err != nil {
			return timeWindow{}, fmt.Errorf("invalid end time: %w", err)
		}
	}

	if start.IsZero() && end.IsZero() {
		return timeWindow{Start: now.Add(-time.Hour), End: now}, nil
	}
	if start.IsZero() {
		start = end.Add(-time.Hour)
	}
	if end.IsZero() {
		end = now
	}
	if start.After(end) {
		return timeWindow{}, fmt.Errorf("start time must be before end time")
	}
	if maxSpan > 0 && end.Sub(start) > maxSpan {
		return timeWindow{}, fmt.Errorf("time range exceeds the maximum of %s; narrow the query", maxSpan)
	}
	return timeWindow{Start: start.UTC(), End: end.UTC()}, nil
}

func parseAITime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if t, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, value)
}

type eventSample struct {
	Timestamp time.Time
	Value     float64
}

type eventInterval struct {
	Start           time.Time `json:"start"`
	End             time.Time `json:"end"`
	DurationSeconds float64   `json:"duration_seconds"`
	Count           int       `json:"count"`
	Min             float64   `json:"min"`
	Max             float64   `json:"max"`
	Mean            float64   `json:"mean"`
}

func matchEventOp(value float64, op string, threshold float64) bool {
	switch strings.TrimSpace(op) {
	case ">":
		return value > threshold
	case ">=":
		return value >= threshold
	case "<":
		return value < threshold
	case "<=":
		return value <= threshold
	case "==":
		return value == threshold
	case "!=":
		return value != threshold
	default:
		return false
	}
}

func detectEvents(samples []eventSample, op string, threshold float64, minDuration time.Duration) []eventInterval {
	if len(samples) == 0 {
		return nil
	}
	ordered := append([]eventSample(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Timestamp.Before(ordered[j].Timestamp) })

	var events []eventInterval
	var active bool
	var start, last time.Time
	var count int
	var min, max, sum float64

	closeEvent := func() {
		if !active {
			return
		}
		duration := last.Sub(start)
		if duration >= minDuration {
			events = append(events, eventInterval{
				Start:           start,
				End:             last,
				DurationSeconds: duration.Seconds(),
				Count:           count,
				Min:             min,
				Max:             max,
				Mean:            sum / float64(count),
			})
		}
		active = false
		count = 0
		min, max, sum = 0, 0, 0
	}

	for _, sample := range ordered {
		if !matchEventOp(sample.Value, op, threshold) {
			closeEvent()
			continue
		}
		if !active {
			active = true
			start = sample.Timestamp
			count = 0
			min = sample.Value
			max = sample.Value
			sum = 0
		}
		last = sample.Timestamp
		count++
		sum += sample.Value
		if sample.Value < min {
			min = sample.Value
		}
		if sample.Value > max {
			max = sample.Value
		}
	}
	closeEvent()
	return events
}
