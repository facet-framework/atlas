package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/facet-framework/core/registry"
)

// StreamPath is where the reader looks for the corpus.
const StreamPath = "/api/corpus"

// CompanionPath is where the reader asks a question about the repository.
const CompanionPath = "/api/companion"

// CompanionStatePath is what the reader asks before it offers to: which models
// it may pick, and whether anyone is signed in to answer at all.
const CompanionStatePath = "/api/companion/state"

const RepoStatePath = "/api/repo/state"

// Server serves the Atlas reader over one registry.
type Server struct {
	Registry facet.Registry
	// Assets is the built reader. Nil serves the built-in bundle.
	Assets fs.FS
	// Companion answers questions about the repository. Nil builds one over the
	// registry root, which is what the command does; a test supplies its own.
	Companion *Companion

	PluginsDir   string
	PluginTools  map[string]map[string]func(json.RawMessage) (any, error)
	PluginRoutes map[string]http.HandlerFunc
	PluginClose  func() error

	// TestReport is the path of a `facet test --json` report to read, or empty.
	// This path supplies results from a test report.
	TestReport string

	// MCPTools lists the tools the MCP server advertises. Nil answers that no
	// list is available; the command wires it to a ListTools call.
	MCPTools MCPToolLister

	// brokerOnce guards the broker, which holds running child processes. One
	// per server: two servers in one test
	// binary must not share a sidecar.
	brokerOnce sync.Once
	broker     *facet.PluginBroker

	// capabilityOnce guards the browser sessions that bind an unforgeable
	// capability to each plugin id. The browser receives them before installed
	// plugin code is imported; later calls present the capability rather than
	// asking the request body which plugin is speaking.
	capabilityOnce sync.Once
	capabilities   *pluginCapabilityStore

	// screensOnce guards what readers posted their pages to show
	// (companion_screen.go). Per server, so two servers in one test binary
	// never answer with each other's pages.
	screensOnce sync.Once
	screens     *screenStore

	// sources caches which files the scanner counts as anchored, for
	// /api/source (source.go).
	sources sourceIndex
}

func (s *Server) StopPlugins() {
	if s.PluginClose != nil {
		if err := s.PluginClose(); err != nil {
			log.Printf("close plugin sessions: %v", err)
		}
	}
	if b := s.PluginBroker(); b != nil {
		b.StopAll()
	}
}

// PluginBroker returns the broker, or nil when no directory was configured.
func (s *Server) PluginBroker() *facet.PluginBroker {
	if s.PluginsDir == "" {
		return nil
	}
	s.brokerOnce.Do(func() { s.broker = facet.NewPluginBroker(s.PluginsDir) })
	return s.broker
}

// Handler builds the routes: the corpus stream, and the reader around it.
func (s *Server) Handler() http.Handler {
	assets := s.Assets
	if assets == nil {
		assets = Assets()
	}

	mux := http.NewServeMux()
	mux.HandleFunc(StreamPath, s.streamCorpus)
	mux.HandleFunc(CompanionPath, s.streamCompanion)
	mux.HandleFunc(CompanionStatePath, s.companionState)
	mux.HandleFunc(CompanionScreenPath, s.postCompanionScreen)
	mux.HandleFunc(RepoStatePath, s.repoState)
	for pattern, handler := range s.PluginRoutes {
		mux.HandleFunc(pattern, handler)
	}
	mux.HandleFunc(RAGPath, s.searchIndex)
	mux.HandleFunc(MCPToolsPath, s.mcpTools)
	mux.HandleFunc(TestReportPath, s.testReport)
	mux.HandleFunc(SourcePath, s.source)
	mux.HandleFunc(PluginCallPath, s.pluginCall)
	mux.HandleFunc("/api/settings/directory", s.directorySettings)
	mux.HandleFunc(PluginSessionPath, s.pluginSession)
	mux.HandleFunc(InstalledPluginsPath, s.installedPlugins)
	mux.Handle(PluginFilesPrefix, pluginFilesHandler{dir: func() string { return s.PluginsDir }})
	mux.HandleFunc("/api/", http.NotFound)
	mux.Handle("/", &spaHandler{files: http.FS(assets), prepareDocument: s.preparePluginSession})
	return localHostOnly(sameServerOnly(mux))
}

// companion is the agent this server asks, built over the registry root unless
// one was supplied.
func (s *Server) companion() *Companion {
	var selection *facet.Registry
	if s.Registry.SourceView != nil {
		frozen := s.Registry
		selection = &frozen
	}

	if s.Companion != nil {
		companion := *s.Companion
		companion.sourceRegistry = selection
		return &companion
	}
	return &Companion{Root: s.Registry.Root, sourceRegistry: selection}
}

// @facet: workspace/hosting/registry-reader
// @facet-role: primary
// Listen opens a loopback listener, falling back to a port the system picks
// when the requested one is taken. A tool that refuses to start because some
// other process holds a default port is a tool that gets started by hand.
func Listen(port int) (net.Listener, error) {
	if port > 0 {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return ln, nil
		}
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

// @facet: workspace/hosting/registry-reader
// @facet-role: primary
// @facet: workspace/hosting/scan-progress
// @facet-role: primary
// streamCorpus reads the repository and reports the reading as it happens.
func (s *Server) streamCorpus(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "this server cannot stream", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	done := r.Context().Done()
	send := func(event string, payload any) bool {
		select {
		case <-done:
			return false
		default:
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return false
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body)
		flusher.Flush()
		return true
	}

	corpus, err := Build(s.Registry, func(status Status) { send("status", status) })
	if err != nil {
		send("failed", map[string]string{"message": err.Error()})
		return
	}
	send("ready", corpus)
}

// companionState says whether the companion can answer, and with what.
func (s *Server) companionState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")

	// The sign-in is read from the agent on every call rather than cached: it
	// changes in a terminal next door, and a reader still showing "signed out"
	// after someone signed in would be worse than not showing it at all.
	_ = json.NewEncoder(w).Encode(struct {
		Auth   CompanionAuth    `json:"auth"`
		Models []CompanionModel `json:"models"`
		Model  string           `json:"model"`
		// BlockedTools is the deny list the agent is started with, delivered
		// so the reader's "nothing written" is read from the sandbox itself
		// and not written next to it as a sentence that could drift.
		BlockedTools []string `json:"blockedTools"`

		AllowedTools []string `json:"allowedTools"`
		// FixedTools names the tools of both lists whose state this build
		// decides; any other tool changes with the index or a plugin grant.
		FixedTools []string `json:"fixedTools"`
		// Isolation is the flag the spawn passes to leave the project's
		// session configuration out, and what that leaves out.
		Isolation CompanionIsolation `json:"isolation"`
	}{
		Auth:         s.companion().Auth(r.Context()),
		Models:       CompanionModels,
		Model:        s.companion().Model,
		BlockedTools: strings.Split(blockedTools, ","),
		AllowedTools: strings.Split(s.companion().tools(), ","),
		FixedTools:   fixedTools(),
		Isolation:    companionIsolation(),
	})
}

// @facet: assistance/conversations/answer-streaming
// @facet-role: primary
// streamCompanion answers one question about the repository, reporting each
// step as it happens.
func (s *Server) streamCompanion(w http.ResponseWriter, r *http.Request) {
	if !sameServerOrigin(r) {
		http.Error(w, "only local origins may ask about this repository", http.StatusForbidden)
		return
	}
	question := r.URL.Query().Get("q")
	if strings.TrimSpace(question) == "" {
		http.Error(w, "ask something", http.StatusBadRequest)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "this server cannot stream", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	done := r.Context().Done()
	// The step's own kind is the event name, so the reader can listen for
	// 'read' and 'text' separately without unpacking every payload first.
	send := func(step CompanionStep) bool {
		select {
		case <-done:
			return false
		default:
		}
		body, err := json.Marshal(step)
		if err != nil {
			return false
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", step.Kind, body)
		flusher.Flush()
		return true
	}

	// A copy, because the model is chosen per question in the picker and must
	// not become the server's setting for everyone after it.
	companion := *s.companion()
	if model := r.URL.Query().Get("model"); model != "" {
		if !modelNameRe.MatchString(model) {
			send(CompanionStep{Kind: "failed", Text: "unknown model name"})
			return
		}
		companion.Model = model
	}
	// What the reader has open, and the mode they chose. Refused rather than
	// dropped when it does not parse: a question asked about "this" while the
	// agent is told nothing would be answered about something else.
	lines, err := describeCompanionContext(r.URL.Query()["context"])
	if err != nil {
		send(CompanionStep{Kind: "failed", Text: err.Error()})
		return
	}
	mode := r.URL.Query().Get("mode")
	if _, known := companionModes[mode]; mode != "" && !known {
		send(CompanionStep{Kind: "failed", Text: fmt.Sprintf("unknown mode %q", mode)})
		return
	}
	companion.readerPrompt = readerContextPrompt(lines, mode)
	// What the page shows, posted before the question (companion_screen.go).
	// An id that is unknown or expired still asks, and the prompt says that
	// nothing arrived: a question must not fail because a tab sat open.
	if id, asked := r.URL.Query()["screen"]; asked {
		var shown *screen
		if entry, ok := s.screenStore().get(id[0]); ok {
			shown = &entry
		}
		if text := screenPrompt(shown, true); companion.readerPrompt != "" {
			companion.readerPrompt += "\n" + text
		} else {
			companion.readerPrompt = text
		}
	}

	// The error is already on the stream as a 'failed' step, which is where the
	// reader looks; returning it again here would only close the connection
	// before that step was flushed.
	_ = companion.Ask(r.Context(), question, r.URL.Query().Get("session"), send)
}

// modelNameRe is what may be passed on as a model.
var modelNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// sessionIDRe accepts the UUID form emitted by Claude Code for resumable
// sessions. Session identifiers are passed as a command-line option value.
var sessionIDRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// spaHandler serves the built reader, and answers unknown paths with its entry
// page so a reload of any route lands somewhere.
type spaHandler struct {
	files           http.FileSystem
	prepareDocument func(http.ResponseWriter, *http.Request)
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}

	file, err := h.files.Open(name)
	if err != nil {
		// A missing subresource is not a new document. Serving index.html
		// here would revoke the active plugin capability session (favicon).

		if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" && dest != "document" && dest != "iframe" {
			http.NotFound(w, r)
			return
		}
		file, err = h.files.Open("index.html")
		if err != nil {
			http.Error(w, "the Atlas bundle is missing from this build", http.StatusNotFound)
			return
		}
		name = "index.html"
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if name == "index.html" && h.prepareDocument != nil {
		h.prepareDocument(w, r)
	}
	// The bundle is rebuilt with the binary and never revalidated, so a cached
	// copy from a previous version would be served against a newer stream.
	w.Header().Set("Cache-Control", "no-store")
	setContentSecurityPolicy(w)
	http.ServeContent(w, r, name, info.ModTime(), file)
}

// contentSecurityPolicy permits same-origin scripts and connections, blocks
// inline scripts and eval, and restricts resource sources. Inline style
// attributes support React; stylesheets must come from the same origin.
// Plugins run in the host realm, so this policy does not isolate plugins.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self'; " +
	"style-src-elem 'self'; " +
	"style-src-attr 'unsafe-inline'; " +
	"img-src 'self' data:; " +
	"font-src 'self'; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'self'; " +
	"form-action 'none'"

// setContentSecurityPolicy writes the header. A function rather than a literal
// at each call site: the reader has two handlers that serve documents, and a
// policy that differs between them is a policy nobody can reason about.
func setContentSecurityPolicy(w http.ResponseWriter) {
	w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
}

// selectedConfig keeps registry-side plugin settings on the invocation's frozen source view.
func (s *Server) selectedConfig() (*facet.Config, error) {
	if err := s.Registry.ValidateSourceView(); err != nil {
		return nil, err
	}
	if s.Registry.SourceView != nil {
		return facet.LoadConfigWithResolvedSourceView(s.Registry.Root, s.Registry.SourceView)
	}
	return facet.LoadConfig(s.Registry.Root)
}
