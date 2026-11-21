package server

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/facet-framework/core/registry"
)

// repoReadEntry is one file as the list tool answers it — enough for a rail
// row without the reader parsing the whole file for that.
type repoReadEntry struct {
	// Path is the file's name relative to the declared directory, exactly
	// what hostRepoRead takes back.
	Path   string `json:"path"`
	Number string `json:"number"`
	Slug   string `json:"slug"`
}

// declaredReadDir answers the absolute directory a plugin's own manifest
// names and the extensions it allows there, refusing a directory the
// manifest never declared the same way an undeclared tool is refused — the
// manifest asks, and reading a directory nobody named would be a right the
// plugin granted itself. The extensions are resolved per call from the
// installed manifest, never from a constant: a file with an extension the
// entry does not list is refused exactly like an undeclared directory.
func (s *Server) declaredReadDir(pluginID, rel string) (string, []string, error) {
	broker := s.PluginBroker()
	if broker == nil {
		return "", nil, fmt.Errorf("no plugin directory is configured")
	}
	m, err := broker.Manifest(pluginID)
	if err != nil {
		return "", nil, err
	}
	// The official ADR reader uses the repository's configured scope. Copy
	// rather than mutate the broker's shared bundled manifest.
	if pluginID == "adr" || pluginID == "bpmn" {
		cfg, err := s.selectedConfig()
		if err != nil {
			return "", nil, err
		}
		if pluginID == "adr" {
			m.Reads = []facet.ReadDecl{{Dir: cfg.ADRDirectory()}}
		} else {
			m.Reads = append([]facet.ReadDecl(nil), m.Reads...)
			for i := range m.Reads {
				if m.Reads[i].Dir == "docs/bpmn" {
					m.Reads[i].Dir = cfg.BPMNDirectory()
				}
			}
		}
	}
	exts, err := facet.ReadExtsFor(m.Reads, rel)
	if err != nil {
		return "", nil, fmt.Errorf("plugin %q: %w", pluginID, err)
	}
	if len(exts) == 0 {
		return "", nil, fmt.Errorf("plugin %q does not declare %q under \"reads\"", pluginID, rel)
	}
	// Checked on every call, not only by the schema at install: a bundled
	// manifest never passes the schema, and an installed one is a file on
	// disk that can change after it did.
	dir, err := facet.ResolveReadDir(s.Registry.Root, rel)
	if err != nil {
		return "", nil, err
	}
	return dir, exts, nil
}

// hostRepoList answers the list of files, of the extensions the manifest declares, under one of a plugin's
// declared read directories — the raw filenames, unparsed. The plugin's own
// model builder reads each one's headers; this tool only says which files
// exist, the way repo.state answers what the host measured rather than what
// a page has computed from it.
func (s *Server) hostRepoList(pluginID string, args json.RawMessage) (any, error) {
	var req struct {
		Dir string `json:"dir"`
	}
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	if (pluginID == "adr" || pluginID == "bpmn") && req.Dir == "" {
		cfg, err := s.selectedConfig()
		if err != nil {
			return nil, err
		}
		if pluginID == "adr" {
			req.Dir = cfg.ADRDirectory()
		} else {
			req.Dir = cfg.BPMNDirectory()
		}
	}
	dir, exts, err := s.declaredReadDir(pluginID, req.Dir)
	if err != nil {
		return nil, err
	}
	names, err := facet.ListRepoFilesExts(dir, exts)
	if err != nil {
		return nil, err
	}
	entries := make([]repoReadEntry, 0, len(names))
	for _, name := range names {
		number, slug := splitRepoReadName(name)
		entries = append(entries, repoReadEntry{Path: name, Number: number, Slug: slug})
	}
	return map[string]any{"dir": req.Dir, "files": entries}, nil
}

// @facet: customization/execution/repo-read-tool
// @facet-role: primary
// hostRepoRead answers one file's raw body, by the path hostRepoList
// named, under the same declared directory.
func (s *Server) hostRepoRead(pluginID string, args json.RawMessage) (any, error) {
	var req struct {
		Dir  string `json:"dir"`
		Path string `json:"path"`
	}
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	if req.Dir == "" && (pluginID == "adr" || pluginID == "bpmn") {
		cfg, err := s.selectedConfig()
		if err != nil {
			return nil, err
		}
		if pluginID == "adr" {
			req.Dir = cfg.ADRDirectory()
		} else {
			req.Dir = cfg.BPMNDirectory()
		}
	}
	dir, exts, err := s.declaredReadDir(pluginID, req.Dir)
	if err != nil {
		return nil, err
	}
	body, err := facet.ReadRepoFileExts(dir, req.Path, exts)
	if err != nil {
		return nil, err
	}
	return map[string]any{"path": req.Path, "body": body}, nil
}

// splitRepoReadName pulls the leading number off a filename, the way
// "0001-offline-first-storage.md" names itself. A name that does not start
// with digits answers an empty number and the whole stem as the slug — seen,
// not hidden: a file that does not follow the convention still gets listed
// and read, only without a number to sort or show.
func splitRepoReadName(name string) (number, slug string) {
	stem := strings.TrimSuffix(name, filepath.Ext(name))
	i := 0
	for i < len(stem) && stem[i] >= '0' && stem[i] <= '9' {
		i++
	}
	if i == 0 {
		return "", stem
	}
	number = stem[:i]
	slug = stem[i:]
	if len(slug) > 0 && slug[0] == '-' {
		slug = slug[1:]
	}
	return number, slug
}
