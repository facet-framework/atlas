package server

import (
	"encoding/json"
	"errors"
	"fmt"
)

// uiNotifyArgs is what a plugin sends to move its own slot's dot.
type uiNotifyArgs struct {
	Place string `json:"place"`
	On    bool   `json:"on"`
}

func hostUINotify(_ *Server, _ string, args json.RawMessage) (any, error) {
	var a uiNotifyArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, fmt.Errorf("server.notify: %w", err)
	}
	if a.Place == "" {
		return nil, errors.New("server.notify: place is required")
	}
	return map[string]any{"ok": true}, nil
}
