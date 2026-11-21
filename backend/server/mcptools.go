package server

import (
	"context"
	"encoding/json"
	"net/http"
)

// MCPToolsPath is where the reader asks which tools `facet mcp` offers.
const MCPToolsPath = "/api/mcp/tools"

// mcpToolsResponse is what /api/mcp/tools answers with. `available` is false,
// with a reason, where the tools could not be listed: an empty list would say
// the server offers none.
type mcpToolsResponse struct {
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`
	Tools     []string `json:"tools"`
}

// mcpTools answers with the names the real MCP server advertises.
func (s *Server) mcpTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")

	body := mcpToolsResponse{Tools: []string{}}
	switch {
	case s.MCPTools == nil:
		body.Reason = "this reader was started without an MCP server to ask"
	default:
		names, err := s.MCPTools(r.Context())
		if err != nil {
			body.Reason = err.Error()
		} else {
			body.Available = true
			body.Tools = names
		}
	}
	_ = json.NewEncoder(w).Encode(body)
}

// MCPToolLister lists the tool names the MCP server advertises.
type MCPToolLister func(ctx context.Context) ([]string, error)
