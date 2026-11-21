package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/facet-framework/core/registry"
)

// PluginSessionPath is the one-shot bootstrap that runs before installed
// plugin modules are imported. It turns plugin ids into opaque capabilities;
// /api/plugin/call trusts only those capabilities, never an id in JSON.
const PluginSessionPath = "/api/plugin/session"

const (
	pluginSessionCookie    = "facet_atlas_plugin_session"
	pluginCapabilityHeader = "X-Facet-Plugin-Capability"
	pluginSessionMaxBody   = 16 << 10
	pluginSessionLimit     = 128
)

type pluginCapabilityStore struct {
	mu       sync.Mutex
	sessions map[string]*pluginBrowserSession
	tokens   map[string]string
}

type pluginBrowserSession struct {
	created time.Time
	claimed bool
	tokens  []string
}

type pluginSessionRequest struct {
	Plugins []string `json:"plugins"`
}

type pluginSessionResponse struct {
	Capabilities map[string]string `json:"capabilities"`
}

func (s *Server) capabilityStore() *pluginCapabilityStore {
	s.capabilityOnce.Do(func() {
		s.capabilities = &pluginCapabilityStore{
			sessions: map[string]*pluginBrowserSession{},
			tokens:   map[string]string{},
		}
	})
	return s.capabilities
}

// preparePluginSession gives an Atlas document an HttpOnly session before any
// plugin JavaScript runs. The bootstrap endpoint never creates a session: a
// plugin cannot omit credentials or fetch a fresh session after it was loaded.
func (s *Server) preparePluginSession(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(pluginSessionCookie); err == nil {
		store := s.capabilityStore()
		store.mu.Lock()
		session, exists := store.sessions[cookie.Value]
		if exists && session.claimed {
			store.deleteSession(cookie.Value)
			exists = false
		}
		store.mu.Unlock()
		if exists {
			return
		}
	}

	id, err := randomCapability()
	if err != nil {
		return
	}
	store := s.capabilityStore()
	store.mu.Lock()
	if len(store.sessions) >= pluginSessionLimit {
		var oldestID string
		var oldest time.Time
		for candidate, session := range store.sessions {
			if oldestID == "" || session.created.Before(oldest) {
				oldestID, oldest = candidate, session.created
			}
		}
		store.deleteSession(oldestID)
	}
	store.sessions[id] = &pluginBrowserSession{created: time.Now()}
	store.mu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     pluginSessionCookie,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) pluginSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "this route is a POST", http.StatusMethodNotAllowed)
		return
	}
	if !sameServerOrigin(r) {
		http.Error(w, "the plugin session must come from this Atlas origin", http.StatusForbidden)
		return
	}
	cookie, err := r.Cookie(pluginSessionCookie)
	if err != nil {
		http.Error(w, "open Atlas before requesting plugin capabilities", http.StatusForbidden)
		return
	}

	var req pluginSessionRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, pluginSessionMaxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || len(req.Plugins) > 64 {
		http.Error(w, "the plugin session request is invalid", http.StatusBadRequest)
		return
	}

	store := s.capabilityStore()
	store.mu.Lock()
	defer store.mu.Unlock()
	session, ok := store.sessions[cookie.Value]
	if !ok || session.claimed {
		http.Error(w, "plugin capabilities were already claimed", http.StatusForbidden)
		return
	}

	broker := facet.NewPluginBroker(s.PluginsDir)
	ids := make([]string, 0, len(req.Plugins))
	seen := map[string]bool{}
	for _, id := range req.Plugins {
		if seen[id] {
			continue
		}
		if _, err := broker.Manifest(id); err != nil {
			http.Error(w, "the plugin session names an unavailable plugin", http.StatusBadRequest)
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}

	answer := pluginSessionResponse{Capabilities: map[string]string{}}
	for _, id := range ids {
		token, err := randomCapability()
		if err != nil {
			http.Error(w, "could not create plugin capabilities", http.StatusInternalServerError)
			return
		}
		store.tokens[token] = id
		session.tokens = append(session.tokens, token)
		answer.Capabilities[id] = token
	}
	session.claimed = true
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = json.NewEncoder(w).Encode(answer)
}

// deleteSession is called with the store lock held. Capabilities live only as
// long as the document session that received them.
func (s *pluginCapabilityStore) deleteSession(id string) {
	if session := s.sessions[id]; session != nil {
		for _, token := range session.tokens {
			delete(s.tokens, token)
		}
	}
	delete(s.sessions, id)
}

func (s *Server) pluginIdentity(r *http.Request) (string, bool) {
	token := strings.TrimSpace(r.Header.Get(pluginCapabilityHeader))
	if token == "" {
		return "", false
	}
	store := s.capabilityStore()
	store.mu.Lock()
	defer store.mu.Unlock()
	id, ok := store.tokens[token]
	return id, ok
}

func randomCapability() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func sameServerOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") == "same-origin"
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Path != "" {
		return false
	}
	return strings.EqualFold(parsed.Host, r.Host)
}

func sameServerOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		protected := strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, PluginFilesPrefix)
		if protected && !sameServerOrigin(r) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.Error(w, "only this server's reader may use this route", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
