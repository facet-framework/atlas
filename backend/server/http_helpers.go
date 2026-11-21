package server

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func allowLocalRead(w http.ResponseWriter, r *http.Request, what string) bool {
	if !sameServerOrigin(r) {
		http.Error(w, "only this server's reader may "+what, http.StatusForbidden)
		return false
	}
	return true
}

// decodeArgs reads a host tool's arguments, treating an absent body as "{}"
// rather than an error — a tool like repo.state that takes no arguments is
// still called with Args omitted from the envelope.
func decodeArgs(args json.RawMessage, into any) error {
	if len(args) == 0 {
		args = []byte("{}")
	}
	if err := json.Unmarshal(args, into); err != nil {
		return fmt.Errorf("this call is not readable JSON")
	}
	return nil
}

// writeJSON answers with an object.
func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(payload)
}
