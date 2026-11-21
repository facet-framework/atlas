package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/facet-framework/core/registry"
	"gopkg.in/yaml.v3"
)

var directorySettingsMu sync.Mutex

func directoryGit(root string, args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return strings.TrimSpace(string(out)), nil
}

func directoryNode(root, kind string) (*yaml.Node, *yaml.Node, int, error) {
	path := filepath.Join(root, facet.ConfigName)
	info, err := os.Lstat(path)
	if err == nil && (!info.Mode().IsRegular()) {
		return nil, nil, 0, fmt.Errorf("configuration must be a regular file")
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		data = []byte("{}\n")
	} else if err != nil {
		return nil, nil, 0, err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, nil, 0, err
	}
	if len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, nil, 0, fmt.Errorf("configuration must be a mapping")
	}
	mapping := doc.Content[0]
	var section *yaml.Node
	for i := 0; i < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == kind {
			section = mapping.Content[i+1]
		}
	}
	if section == nil {
		section = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		mapping.Content = append(mapping.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: kind}, section)
	}
	if section.Kind != yaml.MappingNode {
		return nil, nil, 0, fmt.Errorf("%s must be a mapping", kind)
	}
	for i := 0; i < len(section.Content); i += 2 {
		if section.Content[i].Value == "directory" {
			return &doc, section.Content[i+1], section.Content[i].Line, nil
		}
	}
	value := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str"}
	section.Content = append(section.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "directory"}, value)
	return &doc, value, 0, nil
}

func (s *Server) directorySettings(w http.ResponseWriter, r *http.Request) {
	if !s.allowPluginCall(w, r) {
		return
	}
	directorySettingsMu.Lock()
	defer directorySettingsMu.Unlock()
	var req struct {
		Kind      string `json:"kind"`
		Directory string `json:"directory"`
		Mode      string `json:"mode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	if req.Kind != "adr" && req.Kind != "bpmn" {
		http.Error(w, "unknown directory", 400)
		return
	}
	root := s.Registry.Root
	cfg, err := s.selectedConfig()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	dir := cfg.ADRDirectory()
	if req.Kind == "bpmn" {
		dir = cfg.BPMNDirectory()
	}
	_, _, line, err := directoryNode(root, req.Kind)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.Mode == "" {
		writeJSON(w, map[string]any{"file": facet.ConfigName, "line": line, "directory": dir, "key": req.Kind + ".directory"})
		return
	}
	if req.Mode != "checkout" && req.Mode != "worktree" {
		http.Error(w, "choose checkout or worktree", 400)
		return
	}
	if !facet.ValidReadDir(req.Directory) {
		http.Error(w, "directory must be relative and inside the repository", 400)
		return
	}
	mainRoot, err := directoryGit(root, "rev-parse", "--git-common-dir")
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if !filepath.IsAbs(mainRoot) {
		mainRoot = filepath.Join(root, mainRoot)
	}
	trees, err := directoryGit(root, "worktree", "list", "--porcelain")
	if err != nil || !strings.HasPrefix(trees, "worktree ") {
		http.Error(w, "cannot locate main checkout", 400)
		return
	}
	root = strings.TrimPrefix(strings.SplitN(trees, "\n", 2)[0], "worktree ")
	if _, err := facet.ResolveReadDir(root, req.Directory); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	branch := ""
	if req.Mode == "worktree" {
		branch = fmt.Sprintf("atlas/%s-directory-%d", req.Kind, time.Now().UnixNano())
		base := filepath.Join(mainRoot, "atlas-worktrees")
		if err := os.MkdirAll(base, 0755); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		target, err := os.MkdirTemp(base, "directory-")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		os.Remove(target)
		if _, err = directoryGit(root, "worktree", "add", "-b", branch, target, "HEAD"); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		root = target
	}
	doc, value, _, err := directoryNode(root, req.Kind)
	if err == nil {
		value.Value = req.Directory
		var data []byte
		data, err = yaml.Marshal(doc)
		if err == nil {
			path := filepath.Join(root, facet.ConfigName)
			mode := os.FileMode(0644)
			if info, e := os.Stat(path); e == nil {
				mode = info.Mode().Perm()
			}
			var temp *os.File
			temp, err = os.CreateTemp(root, ".facetrc-atlas-*")
			if err == nil {
				tempName := temp.Name()
				if err = temp.Chmod(mode); err == nil {
					_, err = temp.Write(data)
				}
				closeErr := temp.Close()
				if err == nil {
					err = closeErr
				}
				if err == nil {
					err = os.Rename(tempName, path)
				}
				os.Remove(tempName)
			}
		}
	}
	if err != nil {
		if branch != "" {
			directoryGit(root, "worktree", "remove", root)
			directoryGit(s.Registry.Root, "branch", "-D", branch)
		}
		http.Error(w, err.Error(), 500)
		return
	}
	status, err := directoryGit(root, "status", "--porcelain", "--", facet.ConfigName)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"file": filepath.Join(root, facet.ConfigName), "dirty": status != "", "status": status, "worktree": root, "branch": branch})
}
