package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/registry"
)

func main() {
	if err := serve(os.Stdin, os.Stdout); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, "confluence sidecar:", err)
		os.Exit(1)
	}
}

// serve reads one call at a time and answers it, until the host closes stdin.
func serve(r io.Reader, w io.Writer) error {
	in := bufio.NewReader(r)
	for {
		body, err := readFrame(in)
		if err != nil {
			return err
		}
		var call facet.SidecarCall
		if err := json.Unmarshal(body, &call); err != nil {
			if writeErr := writeReply(w, facet.SidecarReply{Error: "call is not JSON: " + err.Error()}); writeErr != nil {
				return writeErr
			}
			continue
		}
		reply := dispatch(call)
		if err := writeReply(w, reply); err != nil {
			return err
		}
	}
}

// dispatch answers one call. Every failure becomes SidecarReply.Error rather
// than a process exit — a caller with a bad request gets an answer, and the
// sidecar stays up for the next one.
func dispatch(call facet.SidecarCall) facet.SidecarReply {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	switch call.Tool {
	case "confluence.state":
		return toolConfluenceState()
	case "confluence.reach":
		return toolConfluenceReach(ctx)
	case "confluence.import":
		return toolConfluenceImport(ctx, call.Args)
	case "confluence.mirror":
		return toolConfluenceMirror(ctx, call.Args)
	default:
		return facet.SidecarReply{Error: fmt.Sprintf("confluence sidecar: no such tool %q", call.Tool)}
	}
}

type confluenceStateResult struct {
	Instance       *string `json:"instance,omitempty"`
	InstanceSource *string `json:"instanceSource,omitempty"`
	TokenSource    *string `json:"tokenSource,omitempty"`
}

// toolConfluenceState reports what this process's own environment holds,
// naming only the variables and never their values.
func toolConfluenceState() facet.SidecarReply {
	var out confluenceStateResult
	if site := strings.TrimSpace(os.Getenv(ConfluenceURLEnv)); site != "" {
		source := ConfluenceURLEnv
		out.Instance, out.InstanceSource = &site, &source
	}
	if strings.TrimSpace(os.Getenv(ConfluenceTokenEnv)) != "" {
		name := ConfluenceTokenEnv
		out.TokenSource = &name
	}
	return replyWith(out)
}

// confluenceReachResult is one measurement, as the host passes it on.
//
// Every sentence travels twice: as English text in What/Reason, which an older
// reader shows verbatim, and as a stable code with its parameters, which a
// newer reader turns into the reader's own language. The codes are wire
// format: renaming one is a migration, not a cleanup.
type confluenceReachResult struct {
	Kind         string         `json:"kind"`
	What         string         `json:"what"`
	WhatCode     string         `json:"whatCode,omitempty"`
	WhatParams   map[string]any `json:"whatParams,omitempty"`
	Status       *int           `json:"status,omitempty"`
	Reason       *string        `json:"reason,omitempty"`
	ReasonCode   string         `json:"reasonCode,omitempty"`
	ReasonParams map[string]any `json:"reasonParams,omitempty"`
}

// The message codes this sidecar sends. The host sends the same ones for the
// cases it answers itself, and the reader keeps one dictionary entry per code.
const (
	reachSpaceSearchCode   = "confluence.reach.space-search"
	reachNoCredentialsCode = "confluence.reach.no-credentials"
	// reachSpaceSearchText is the English source of reachSpaceSearchCode.
	reachSpaceSearchText = "Space search, limit 1"
	// reachSearchLimit is the one request's page size, and the parameter the
	// reader puts into its sentence.
	reachSearchLimit = 1
)

// reachAsked fills in what was asked — the same for every outcome.
func reachAsked(kind string) confluenceReachResult {
	return confluenceReachResult{
		Kind:       kind,
		What:       reachSpaceSearchText,
		WhatCode:   reachSpaceSearchCode,
		WhatParams: map[string]any{"limit": reachSearchLimit},
	}
}

func toolConfluenceReach(ctx context.Context) facet.SidecarReply {
	src, err := NewConfluenceSource("")
	if err != nil {
		out := reachAsked("no-answer")
		reason := err.Error()
		out.Reason = &reason
		if errors.Is(err, ErrConfluenceNoCredentials) {
			// Only the variable NAMES go out as a parameter, never a value.
			out.ReasonCode = reachNoCredentialsCode
			out.ReasonParams = map[string]any{"missing": strings.Join(missingConfluenceCredentials(), ", ")}
		}
		return replyWith(out)
	}
	status, err := src.Reach(ctx)
	if err != nil && status == 0 {
		// A transport failure carries the transport's own words and no code:
		// they are a technical message, and the reader shows them as sent.
		out := reachAsked("no-answer")
		reason := err.Error()
		out.Reason = &reason
		return replyWith(out)
	}
	out := reachAsked("answer")
	code := status
	out.Status = &code
	return replyWith(out)
}

// confluenceImportArgs is what confluence.import takes: the reference to
// import and the wiki directory to write into.
//
// The wiki directory rather than a git branch or a registry: the CLI already
// owns the branch, the worktree and the commit (the specification), and handing
// this sidecar a path to write .md files under is the smcompletet surface that
// lets it stay a source in the WikiSource sense without also becoming a git
// client.
type confluenceImportArgs struct {
	Ref     string `json:"ref"`
	WikiDir string `json:"wikiDir"`
}

// confluenceMemoryWriter is the wiki.WikiWriter this sidecar can build
// without the registry the real write path checks against.
//
// It does not replace ResolveWikiPath's refusals — the CLI still writes
// through wiki.WriteWikiPage against the caller's own registry once this
// sidecar's answer comes back over the wire; see runConfluenceImport in
// cmd/facet/wiki_confluence.go for that hand-off. What this sidecar returns
// is the pages, held in memory, not files on the host's own disk — which
// keeps a page title that tries to escape the wiki directory a refusal
// reported in JSON rather than a file this process wrote somewhere
// unwelcome.
type confluenceMemoryWriter struct {
	pages map[string]string
}

func (w *confluenceMemoryWriter) Write(rel, body string) (string, error) {
	if w.pages == nil {
		w.pages = map[string]string{}
	}
	w.pages[rel] = body
	return rel, nil
}

func toolConfluenceImport(ctx context.Context, raw json.RawMessage) facet.SidecarReply {
	var args confluenceImportArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return facet.SidecarReply{Error: "confluence.import: bad args: " + err.Error()}
	}
	src, err := NewConfluenceSource("")
	if err != nil {
		return facet.SidecarReply{Error: err.Error()}
	}
	writer := &confluenceMemoryWriter{}
	report, err := src.Import(ctx, args.Ref, writer)
	if err != nil {
		return facet.SidecarReply{Error: err.Error()}
	}
	return replyWith(struct {
		Report wiki.WikiImportReport `json:"report"`
		Pages  map[string]string     `json:"pages"`
		Calls  int                   `json:"calls"`
	}{Report: report, Pages: writer.pages, Calls: src.Calls()})
}

// confluenceMirrorArgs is what confluence.mirror takes.
type confluenceMirrorArgs struct {
	Space string                `json:"space"`
	Pages []wiki.WikiMirrorPage `json:"pages"`
	State *wiki.WikiMirrorState `json:"state"`
}

func toolConfluenceMirror(ctx context.Context, raw json.RawMessage) facet.SidecarReply {
	var args confluenceMirrorArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return facet.SidecarReply{Error: "confluence.mirror: bad args: " + err.Error()}
	}
	src, err := NewConfluenceSource(args.Space)
	if err != nil {
		return facet.SidecarReply{Error: err.Error()}
	}
	state := args.State
	if state == nil {
		state = &wiki.WikiMirrorState{Target: src.Name(), Entries: map[string]wiki.WikiMirrorEntry{}}
	}
	report, err := src.Mirror(ctx, args.Pages, state)
	if err != nil {

		return replyErrorWithState(err, report, state, src.Calls())
	}
	return replyWith(struct {
		Report wiki.WikiMirrorReport `json:"report"`
		State  *wiki.WikiMirrorState `json:"state"`
		Calls  int                   `json:"calls"`
	}{Report: report, State: state, Calls: src.Calls()})
}

func replyErrorWithState(err error, report wiki.WikiMirrorReport, state *wiki.WikiMirrorState, calls int) facet.SidecarReply {
	raw, marshalErr := json.Marshal(struct {
		Report wiki.WikiMirrorReport `json:"report"`
		State  *wiki.WikiMirrorState `json:"state"`
		Calls  int                   `json:"calls"`
	}{Report: report, State: state, Calls: calls})
	if marshalErr != nil {
		// The original error still matters more than a marshalling failure
		// about the state that would have ridden alongside it.
		return facet.SidecarReply{Error: err.Error()}
	}
	return facet.SidecarReply{Error: err.Error(), Result: raw}
}

// replyWith marshals a tool's result into a SidecarReply, turning a marshal
// failure into SidecarReply.Error rather than a process crash.
func replyWith(result any) facet.SidecarReply {
	raw, err := json.Marshal(result)
	if err != nil {
		return facet.SidecarReply{Error: "confluence sidecar: marshalling the result: " + err.Error()}
	}
	return facet.SidecarReply{Result: raw}
}

// writeReply frames one reply the way readFrame below expects to read it.
func writeReply(w io.Writer, reply facet.SidecarReply) error {
	body, err := json.Marshal(reply)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "Content-Length: %d\r\n\r\n%s", len(body), body)
	return err
}

func readFrame(r *bufio.Reader) ([]byte, error) {
	length := -1
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if name, value, ok := strings.Cut(line, ":"); ok &&
			strings.EqualFold(strings.TrimSpace(name), "content-length") {
			length, err = strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("bad Content-Length: %w", err)
			}
		}
	}
	if length < 0 {
		return nil, errors.New("message without Content-Length")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}
