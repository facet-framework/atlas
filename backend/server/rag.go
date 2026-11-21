package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"

	"github.com/facet-framework/core/rag"
)

// RAGPath is where the reader searches the index directly.
const RAGPath = "/api/rag"

// The reader's own route into retrieval, without an agent in between.

// RAGResult is one retrieved chunk as the reader draws it.
type RAGResult struct {
	// Feature is the id, so the reader can link a hit into the record.
	Feature  string  `json:"feature,omitempty"`
	Registry string  `json:"registry,omitempty"`
	Kind     string  `json:"kind"`
	Facet    string  `json:"facet"`
	Path     string  `json:"path"`
	Title    string  `json:"title,omitempty"`
	Score    float32 `json:"score"`
	Text     string  `json:"text"`
}

// RAGResponse is what /api/rag answers with.
type RAGResponse struct {
	Available  bool        `json:"available"`
	Reason     string      `json:"reason,omitempty"`
	ReasonCode string      `json:"reasonCode,omitempty"`
	Hint       string      `json:"hint,omitempty"`
	HintCode   string      `json:"hintCode,omitempty"`
	Model      string      `json:"model,omitempty"`
	Chunks     int         `json:"chunks,omitempty"`
	Lexical    bool        `json:"lexical,omitempty"`
	Hits       []RAGResult `json:"hits"`
}

// ragRebuildHint is the English source of the hint code "rag.rebuild-index".
const ragRebuildHint = "Rebuild with `facet rag index`."

func (s *Server) searchIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")

	encode := func(body RAGResponse) {
		if body.Hits == nil {
			body.Hits = []RAGResult{}
		}
		_ = json.NewEncoder(w).Encode(body)
	}

	question := r.URL.Query().Get("q")
	if question == "" {
		encode(RAGResponse{Reason: "no question", ReasonCode: "rag.no-question"})
		return
	}
	limit := 6
	if v, err := strconv.Atoi(r.URL.Query().Get("n")); err == nil && v > 0 && v <= 20 {
		limit = v
	}

	cfg, err := s.selectedConfig()
	if err != nil {
		encode(RAGResponse{Reason: err.Error()})
		return
	}
	path := cfg.IndexPath(s.Registry)

	store, err := rag.LoadStore(path)
	switch {
	case os.IsNotExist(err):
		encode(RAGResponse{
			Reason:     "This project has no search index yet.",
			ReasonCode: "rag.no-index",
			Hint:       "In a terminal: `facet rag index`. Atlas then also answers questions from the wording of the records.",
			HintCode:   "rag.build-index",
		})
		return
	case err != nil:
		encode(RAGResponse{Reason: err.Error(), Hint: ragRebuildHint, HintCode: "rag.rebuild-index"})
		return
	}

	embedder, err := rag.Resolve(cfg.EmbeddingSettings())
	if err != nil {
		encode(RAGResponse{Reason: err.Error()})
		return
	}

	hits, err := rag.Query(r.Context(), store, embedder, question, limit)
	if err != nil {
		encode(RAGResponse{Reason: err.Error(), Hint: ragRebuildHint, HintCode: "rag.rebuild-index"})
		return
	}

	body := RAGResponse{
		Available: true,
		Model:     store.Provider + "/" + store.Model,
		Chunks:    store.Len(),
		// Flagged rather than left for the reader to infer from a model name:
		// a lexical index matches words and not meaning, and an interface that
		// does not say so invites the results to be trusted as if it did.
		Lexical: store.Provider == "local",
		Hits:    make([]RAGResult, 0, len(hits)),
	}
	for _, h := range hits {
		body.Hits = append(body.Hits, RAGResult{
			Feature:  h.Feature,
			Registry: h.Registry,
			Kind:     h.Kind,
			Facet:    h.Facet,
			Path:     h.Path,
			Title:    h.Title,
			Score:    h.Score,
			Text:     h.Text,
		})
	}
	encode(body)
}
