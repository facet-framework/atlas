package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/facet-framework/core/registry"
)

const PluginCallPath = "/api/plugin/call"

// pluginCallRequest is what the reader sends.
type pluginCallRequest struct {
	Plugin string          `json:"plugin"`
	Tool   string          `json:"tool"`
	Args   json.RawMessage `json:"args,omitempty"`
}

type pluginCallResponse struct {
	Result json.RawMessage `json:"result,omitempty"`
	Denied string          `json:"denied,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type hostTool func(*Server, string, json.RawMessage) (any, error)

var hostTools = map[string]hostTool{
	"repo.list":     (*Server).hostRepoList,
	"repo.read":     (*Server).hostRepoRead,
	"server.notify": hostUINotify,
}

const pluginCallMaxBody = 4 << 20

// @facet: customization/execution/plugin-broker
// @facet-role: primary
// @facet: customization/execution/plugin-sidecar
// @facet-role: primary
// @facet: customization/plugins/plugin-install-grants
// @facet-role: primary
// pluginCall brokers one call from a plugin to its own binary — or, for the
// tools in hostTools, to code the host itself carries.
func (s *Server) pluginCall(w http.ResponseWriter, r *http.Request) {
	if !s.allowPluginCall(w, r) {
		return
	}

	var req pluginCallRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, pluginCallMaxBody)).Decode(&req); err != nil {
		http.Error(w, "the call is not JSON", http.StatusBadRequest)
		return
	}
	pluginID, authenticated := s.pluginIdentity(r)
	if !authenticated || pluginID != req.Plugin {
		logCall("deny", req.Plugin, req.Tool, errors.New("plugin capability does not match the claimed identity"))
		writeJSON(w, pluginCallResponse{Denied: "the plugin identity was not verified"})
		return
	}

	broker := s.PluginBroker()
	if broker == nil {
		writeJSON(w, pluginCallResponse{Denied: "no plugin directory is configured"})
		return
	}

	fn := s.PluginTools[pluginID][req.Tool]
	if shared, ok := hostTools[req.Tool]; ok {
		fn = func(args json.RawMessage) (any, error) { return shared(s, pluginID, args) }
	}
	if fn != nil {

		if err := broker.Allowed(req.Plugin, req.Tool); err != nil {
			logCall("deny", req.Plugin, req.Tool, err)
			writeJSON(w, pluginCallResponse{Denied: err.Error()})
			return
		}
		result, err := fn(req.Args)
		if err != nil {

			logCall("failed", req.Plugin, req.Tool, err)
			writeJSON(w, pluginCallResponse{Error: err.Error()})
			return
		}
		raw, err := json.Marshal(result)
		if err != nil {
			logCall("failed", req.Plugin, req.Tool, err)
			writeJSON(w, pluginCallResponse{Error: err.Error()})
			return
		}
		logCall("call", req.Plugin, req.Tool, nil)
		writeJSON(w, pluginCallResponse{Result: raw})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	reply, err := broker.Call(ctx, req.Plugin, req.Tool, req.Args)
	switch {
	case errors.Is(err, facet.ErrToolNotDeclared),
		errors.Is(err, facet.ErrToolNotGranted),
		errors.Is(err, facet.ErrNoSidecar),
		errors.Is(err, facet.ErrPluginNotInstalled):
		// The refusals the host decides — not installed, not declared, not
		// granted, no binary. Logged as `deny` with the
		// reason, because a right that is refused silently is a right nobody
		// can see was refused.
		logCall("deny", req.Plugin, req.Tool, err)
		writeJSON(w, pluginCallResponse{Denied: err.Error()})
	case err != nil:
		// Everything else is the sidecar's own failure — a checksum that did
		// not match, a process that would not start, an answer that never
		// came. Not a refusal: the host allowed it and it went wrong.
		logCall("failed", req.Plugin, req.Tool, err)
		writeJSON(w, pluginCallResponse{Error: err.Error()})
	default:
		logCall("call", req.Plugin, req.Tool, nil)
		writeJSON(w, pluginCallResponse{Result: reply.Result, Error: reply.Error})
	}
}

// allowPluginCall holds this route to the write route's rule, not the stream's.
func (s *Server) allowPluginCall(w http.ResponseWriter, r *http.Request) bool {
	if !sameServerOrigin(r) {
		http.Error(w, "only this Atlas origin may call a plugin tool", http.StatusForbidden)
		return false
	}
	if r.Method != http.MethodPost {
		http.Error(w, "this route is a POST", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

func logCall(verdict, plugin, tool string, err error) {
	if err != nil {

		log.Printf("plugin %s %q %q: %q", verdict, plugin, tool, err.Error())
		return
	}
	log.Printf("plugin %s %q %q", verdict, plugin, tool)
}
