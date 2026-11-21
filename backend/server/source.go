package server

import (
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/facet-framework/core/registry"
)

// SourcePath is where the reader asks for one anchored source file, to show it
// in the record's code view.
const SourcePath = "/api/source"

// maxSourceBytes caps one answer. An anchored source file is a few hundred
// lines; the cap keeps a generated or vendored file from being pulled into the
// browser whole.
const maxSourceBytes = 1 << 20

// sourceIndexTTL is how long one scan of the repository answers which files
// are anchored. Short, so a file that gains an anchor while the reader is open
// becomes readable within seconds; long enough that opening several files in a
// row does not walk the repository each time.
const sourceIndexTTL = 10 * time.Second

// Source states. Only sourceOK carries text. Fixed words: the raw error, which
// can name the absolute path, goes to the server log and never to the browser.
const (
	sourceOK          = "ok"
	sourceInvalid     = "invalid"      // empty, absolute, "..", ":" or "\", or a .git path in any spelling
	sourceMissing     = "missing"      // no regular file at that path inside the repository
	sourceOutside     = "outside"      // a segment of the path is a symbolic link, or it resolves outside the repository
	sourceTooLarge    = "too-large"    // above maxSourceBytes
	sourceNotAnchored = "not-anchored" // not among the files the scanner counts as anchored
	sourceUnreadable  = "unreadable"   // any other read error
)

type sourceAnchor struct {
	Line int    `json:"line"`
	ID   string `json:"id"`
	Role string `json:"role,omitempty"`
}

type sourceResponse struct {
	State   string         `json:"state"`
	Path    string         `json:"path"`
	Text    string         `json:"text,omitempty"`
	Anchors []sourceAnchor `json:"anchors,omitempty"`
}

// sourceIndex holds the set of anchored files from the last scan.
type sourceIndex struct {
	mu    sync.Mutex
	at    time.Time
	files map[string]bool
}

func (s *Server) anchored(rel string) (bool, error) {
	idx := &s.sources
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.files == nil || time.Since(idx.at) > sourceIndexTTL {
		anchors, err := facet.ScanAnchors(s.Registry.Root, s.Registry.ScanOptions())
		if err != nil {
			return false, err
		}
		files := make(map[string]bool, len(anchors))
		for _, a := range anchors {
			p := a.Path
			if filepath.IsAbs(p) {
				r, err := filepath.Rel(s.Registry.Root, p)
				if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
					continue
				}
				p = r
			}
			files[filepath.ToSlash(p)] = true
		}
		idx.files, idx.at = files, time.Now()
	}
	return idx.files[rel], nil
}

// source answers one file of the repository, read-only, for the code view.
func (s *Server) source(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// The same caller test as the companion: a foreign page can send a GET
	// without an Origin, but it cannot claim Sec-Fetch-Site: same-origin.
	if !sameServerOrigin(r) {
		http.Error(w, "only the reader itself may read source files", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimSpace(r.URL.Query().Get("path"))
	writeJSON(w, s.readSource(rel))
}

// @facet: registry/records/source-view
// @facet-role: primary
func (s *Server) readSource(rel string) sourceResponse {
	out := sourceResponse{Path: rel}
	if !validSourcePath(rel) {
		out.State = sourceInvalid
		return out
	}
	root, err := os.OpenRoot(s.Registry.Root)
	if err != nil {
		log.Printf("source %q: %v", rel, err)
		out.State = sourceUnreadable
		return out
	}
	defer root.Close()

	// Every segment by Lstat: a link inside the repository that points at
	// .git or elsewhere is refused even where os.Root would follow it.
	segs := strings.Split(rel, "/")
	for i := range segs {
		info, err := root.Lstat(filepath.FromSlash(strings.Join(segs[:i+1], "/")))
		switch {
		case errors.Is(err, fs.ErrNotExist):
			out.State = sourceMissing
			return out
		case err != nil:
			log.Printf("source %q: %v", rel, err)
			out.State = sourceOutside
			return out
		case info.Mode()&fs.ModeSymlink != 0:
			out.State = sourceOutside
			return out
		case i == len(segs)-1 && !info.Mode().IsRegular():
			out.State = sourceMissing
			return out
		}
	}

	ok, err := s.anchored(rel)
	if err != nil {
		log.Printf("source %q: scan: %v", rel, err)
		out.State = sourceUnreadable
		return out
	}
	if !ok {
		out.State = sourceNotAnchored
		return out
	}

	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		log.Printf("source %q: %v", rel, err)
		out.State = sourceUnreadable
		return out
	}
	defer f.Close()
	// Checked again on the handle: the file may have been swapped between the
	// Lstat above and the open.
	if info, err := f.Stat(); err != nil || !info.Mode().IsRegular() {
		out.State = sourceMissing
		return out
	}
	// One byte past the limit, so "at the limit" and "above it" differ
	// without a size check that could race.
	data, err := io.ReadAll(io.LimitReader(f, maxSourceBytes+1))
	if err != nil {
		log.Printf("source %q: %v", rel, err)
		out.State = sourceUnreadable
		return out
	}
	if len(data) > maxSourceBytes {
		out.State = sourceTooLarge
		return out
	}
	anchors := facet.ScanContent(rel, data)
	if len(anchors) == 0 {
		out.State = sourceNotAnchored
		return out
	}
	out.State = sourceOK
	out.Text = string(data)
	out.Anchors = make([]sourceAnchor, 0, len(anchors))
	for _, a := range anchors {
		out.Anchors = append(out.Anchors, sourceAnchor{Line: a.Line, ID: a.Qualified(), Role: a.Role})
	}
	return out
}

// validSourcePath refuses what never names a repository file: an empty or
// absolute path, a ":" or "\" anywhere (drive letters, alternate data streams,
// Windows separators), any "." or ".." segment, and .git in any spelling a
// case-insensitive or trailing-dot-trimming file system would accept.
func validSourcePath(rel string) bool {
	if rel == "" || strings.HasPrefix(rel, "/") || filepath.IsAbs(rel) || strings.ContainsAny(rel, ":\\\x00") {
		return false
	}
	for _, seg := range strings.Split(rel, "/") {
		trimmed := strings.TrimRight(seg, ". ")
		if seg == "" || seg == "." || seg == ".." || trimmed == "" || strings.EqualFold(trimmed, ".git") {
			return false
		}
	}
	return true
}
