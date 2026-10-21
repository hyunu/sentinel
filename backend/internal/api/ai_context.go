package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
)

// buildAIContext resolves the protocol and produces a compact, token-efficient
// description of the selected board for the system prompt.
func (h *Handler) buildAIContext(ctx context.Context, board models.Board, protocolID string) (string, *models.ProtocolSpec, error) {
	var proto *models.ProtocolSpec
	effectiveProtocolID := strings.TrimSpace(protocolID)
	if effectiveProtocolID == "" {
		effectiveProtocolID = board.ProtocolID
	}
	if effectiveProtocolID != "" {
		var spec models.ProtocolSpec
		if err := h.db.Protocols().FindOne(ctx, bson.M{"_id": effectiveProtocolID}).Decode(&spec); err != nil {
			if strings.TrimSpace(protocolID) != "" {
				return "", nil, fmt.Errorf("protocol not found: %s", protocolID)
			}
		} else {
			proto = &spec
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Board: %s\n", board.Name)
	fmt.Fprintf(&b, "- board_id: %s\n", board.ID)
	if board.UID != "" {
		fmt.Fprintf(&b, "- uid: %s\n", board.UID)
	}
	if board.Location != "" {
		fmt.Fprintf(&b, "- location: %s\n", board.Location)
	}
	fmt.Fprintf(&b, "- active: %t\n", board.IsActive)
	if !board.LastHeartbeat.IsZero() {
		fmt.Fprintf(&b, "- last_heartbeat: %s\n", board.LastHeartbeat.Format("2006-01-02T15:04:05Z07:00"))
	}
	if board.FirmwareVersion != "" {
		fmt.Fprintf(&b, "- firmware: %s\n", board.FirmwareVersion)
	}

	if proto == nil {
		b.WriteString("\nNo protocol is assigned to this board. Call list_protocols/get_protocol to inspect available schemas, and list_fields after choosing one.\n")
		return b.String(), nil, nil
	}

	fmt.Fprintf(&b, "\nProtocol: %s (id=%s, version=%s)\n", proto.Name, proto.ID, proto.Version)
	if proto.Description != "" {
		fmt.Fprintf(&b, "- description: %s\n", proto.Description)
	}
	if proto.ParseRules != nil && proto.ParseRules.Meta != nil {
		if frame, ok := proto.ParseRules.Meta["frame"].(string); ok && frame != "" {
			fmt.Fprintf(&b, "- frame: %s\n", frame)
		}
		if notes, ok := proto.ParseRules.Meta["notes"]; ok {
			fmt.Fprintf(&b, "- notes: %v\n", notes)
		}
	}
	fields := collectParseRuleFieldPaths(proto.ParseRules)
	if len(fields) > 0 {
		fmt.Fprintf(&b, "- declared_fields: %s\n", strings.Join(fields, ", "))
	}
	b.WriteString("- Use list_fields to confirm which fields are actually present in the selected time range.\n")
	b.WriteString("- Use exact field names in tool calls; dotted names are valid.\n")
	return b.String(), proto, nil
}
