package server

import (
	"bytes"
	"context"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/facet-framework/core/registry"
)

const (
	repoHistoryWindow   = 50
	repoHistoryFiles    = 200
	repoHistoryMaxBytes = 1 << 20
	repoGitTimeout      = 5 * time.Second
)

type repoHistoryEntry struct {
	Date      string   `json:"date"`
	SHA       string   `json:"sha"`
	Subject   string   `json:"subject"`
	Files     []string `json:"files"`
	Truncated bool     `json:"truncated,omitempty"`
}

type repoStateResponse struct {
	Repository       bool               `json:"repository"`
	Name             string             `json:"name,omitempty"`
	Branch           string             `json:"branch,omitempty"`
	Commit           string             `json:"commit,omitempty"`
	Dirty            bool               `json:"dirty"`
	Remote           string             `json:"remote,omitempty"`
	RemoteHost       string             `json:"remoteHost,omitempty"`
	Forge            string             `json:"forge,omitempty"`
	ForgeSource      string             `json:"forgeSource,omitempty"`
	History          []repoHistoryEntry `json:"history,omitempty"`
	HistoryWindow    int                `json:"historyWindow,omitempty"`
	HistoryExhausted bool               `json:"historyExhausted,omitempty"`
	HistoryTruncated bool               `json:"historyTruncated,omitempty"`
	Shallow          bool               `json:"shallow,omitempty"`
}

type cappedBuffer struct {
	bytes.Buffer
	limit     int
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		b.truncated = true
		_, _ = b.Buffer.Write(p[:remaining])
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

// repoState reports the project's checkout metadata without opening a write session.
func (s *Server) repoState(w http.ResponseWriter, r *http.Request) {
	if !allowLocalRead(w, r, "read the repository's state") {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), repoGitTimeout)
	defer cancel()
	state := repoStateResponse{}
	run := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"--no-optional-locks", "-c", "core.quotePath=false", "-C", s.Registry.Root}, args...)...)
		out, err := cmd.Output()
		return strings.TrimSpace(string(out)), err
	}
	root, err := run("rev-parse", "--show-toplevel")
	if err != nil {
		writeJSON(w, state)
		return
	}
	state.Repository = true
	state.Name = s.Registry.Name
	state.Branch, _ = run("symbolic-ref", "--short", "HEAD")
	if state.Branch == "" {
		state.Branch, _ = run("rev-parse", "--short", "HEAD")
	}
	state.Commit, _ = run("rev-parse", "HEAD")
	state.Shallow = readGitBool(run("rev-parse", "--is-shallow-repository"))
	state.HistoryWindow = repoHistoryWindow
	state.History, state.HistoryTruncated = readRepoHistory(ctx, s.Registry.Root)
	state.HistoryExhausted = len(state.History) >= repoHistoryWindow
	status, _ := run("status", "--porcelain")
	state.Dirty = status != ""
	forge := facet.ForgeForPush(root, s.Registry.Root)
	state.Remote, state.RemoteHost = forge.Remote, forge.RemoteHost
	state.Forge, state.ForgeSource = forge.Forge, forge.ForgeSource
	if state.Name == "" {
		state.Name = repositoryName(run, root)
	}
	writeJSON(w, state)
}

func readGitBool(value string, err error) bool { return err == nil && value == "true" }

func repositoryName(run func(...string) (string, error), root string) string {
	if remoteURL, err := run("remote", "get-url", "origin"); err == nil {
		trimmed := strings.TrimSuffix(remoteURL, ".git")
		if cut := strings.LastIndexAny(trimmed, "/:"); cut >= 0 && cut+1 < len(trimmed) {
			return trimmed[cut+1:]
		}
	}
	return filepath.Base(root)
}

func readRepoHistory(ctx context.Context, root string) ([]repoHistoryEntry, bool) {
	var out cappedBuffer
	out.limit = repoHistoryMaxBytes
	cmd := exec.CommandContext(ctx, "git", "--no-optional-locks", "-c", "core.quotePath=false", "-C", root,
		"log", "--relative", "-50", "--date=short", "--format=%x1e%H%x1f%ad%x1f%s%x00", "--name-only", "-z", "--", ".")
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil && out.Len() == 0 {
		return nil, out.truncated
	}
	entries := make([]repoHistoryEntry, 0, repoHistoryWindow)
	truncated := out.truncated
	for _, block := range bytes.Split(out.Bytes(), []byte{0x1e}) {
		parts := bytes.Split(block, []byte{0})
		if len(parts) == 0 || len(bytes.TrimSpace(parts[0])) == 0 {
			continue
		}
		meta := strings.SplitN(strings.TrimSpace(string(parts[0])), "\x1f", 3)
		if len(meta) != 3 {
			continue
		}
		entry := repoHistoryEntry{SHA: meta[0], Date: meta[1], Subject: meta[2]}
		for _, raw := range parts[1:] {
			file := strings.TrimSpace(string(raw))
			if file == "" {
				continue
			}
			if len(entry.Files) >= repoHistoryFiles {
				entry.Truncated = true
				truncated = true
				break
			}
			entry.Files = append(entry.Files, filepath.ToSlash(file))
		}
		entries = append(entries, entry)
	}
	return entries, truncated
}
