package wiki

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	facetwiki "github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/registry"
)

// Routes for connection status and reachability.
const (
	// ConfluenceStatePath answers what the host found before the surface
	// offers anything: the credentials' SOURCE, the wiki's areas, and the
	// connections that already exist.
	ConfluenceStatePath = "/api/wiki/confluence/state"
	// ConfluenceReachPath makes exactly one request against Confluence and
	// reports what came back.
	ConfluenceReachPath = "/api/wiki/confluence/reach"
)

const confluenceMirrorTargetPrefix = "confluence:"

// confluenceArea is one row of the left tree.
//
// Title is a pointer because absent and empty are different answers: an
// undeclared folder has no title, and putting its folder name there would claim
// somebody named it. The surface shows the folder name in mono instead, and
// that looks different on purpose.
type confluenceArea struct {
	ID    string  `json:"id"`
	Title *string `json:"title"`
	// State is "ok", "empty" (declared, nothing written yet) or
	// "undeclared" (a folder no declaration names).
	State string `json:"state"`
	Pages int    `json:"pages"`
}

// confluenceConnection is a connection that EXISTS, with the file it was read
// from.
//
// Evidence is not decoration. A connection rendered as a green edge and nothing
// else is a claim with no source, and the whole point of this surface is that
// every claim names where it came from.
type confluenceConnection struct {
	Area   string `json:"area"`
	Target string `json:"target"`
	// Kind is "origin", "copy" or "open" — and "open" is a real third
	// state (the specification), never a missing value dressed up as one of the other two.
	Kind     string `json:"kind"`
	Evidence string `json:"evidence"`
}

// confluenceState is what the host found. Every field may be absent, and absent
// always means the same thing: nobody measured or set this.
type confluenceState struct {
	Instance       *string `json:"instance"`
	InstanceSource *string `json:"instanceSource"`
	// TokenSource is the NAME of the environment variable. The value is never
	// serialised, and neither is the e-mail — it is half a credential.
	TokenSource *string                `json:"tokenSource"`
	Areas       []confluenceArea       `json:"areas"`
	Connections []confluenceConnection `json:"connections"`
	// Reaches is empty until somebody presses "Check now". The host
	// does not reach out on its own: a surface that measured on mount would
	// spend an API call every time a window opened, and the state line would
	// then show an age nobody asked for.
	Reaches []confluenceReach `json:"reaches"`
}

// confluenceReach is one measurement.
//
// Kind separates the two cases in the type rather than through a nil status, so
// nothing downstream has to guess. A 401 is an "answer": the request went out,
// an answer came back, it said no — which is a different fact from a network
// that stayed silent, and a surface that merged them could not tell somebody
// whether their token is wrong or their VPN is off.
//
// What and Reason are English source text, and each may carry a stable code with
// parameters beside it (whatCode/whatParams, reasonCode/reasonParams). The reader
// translates a code it knows and shows the text when it does not, so an older
// reader keeps working against this host and a newer reader against an older
// one. The host and bundled sidecar use the same English wire fields.
type confluenceReach struct {
	Kind         string         `json:"kind"`
	What         string         `json:"what"`
	WhatCode     string         `json:"whatCode,omitempty"`
	WhatParams   map[string]any `json:"whatParams,omitempty"`
	Status       *int           `json:"status"`
	Reason       *string        `json:"reason"`
	ReasonCode   string         `json:"reasonCode,omitempty"`
	ReasonParams map[string]any `json:"reasonParams,omitempty"`
	When         string         `json:"when"`
}

// Message codes the host sends for a reach it answers itself. The sidecar
// sends the same space-search code; the reader keeps one dictionary entry each.
const (
	confluenceReachSpaceSearchCode       = "confluence.reach.space-search"
	confluenceReachNoPluginDirectoryCode = "confluence.reach.no-plugin-directory"
)

// confluenceUnanswered is a reach no answer came back to, with what was asked
// already filled in.
func confluenceUnanswered(reason, reasonCode, now string) confluenceReach {
	return confluenceReach{
		Kind:       "no-answer",
		What:       "Space search, limit 1",
		WhatCode:   confluenceReachSpaceSearchCode,
		WhatParams: map[string]any{"limit": 1},
		Reason:     &reason,
		ReasonCode: reasonCode,
		When:       now,
	}
}

// confluenceSpaceInAlias reads the space key out of an address an import parked
// in 'aliases'.
var confluenceSpaceInAlias = regexp.MustCompile(`/wiki/spaces/([^/?#]+)`)

// confluenceState answers what the host found.
func (s *Service) confluenceState(w http.ResponseWriter, r *http.Request) {
	state := confluenceState{
		Areas:       []confluenceArea{},
		Connections: []confluenceConnection{},
		// Never nil: an absent list and an empty one serialise differently in
		// JSON, and the surface reads "no measurement yet" off the length.
		Reaches: []confluenceReach{},
	}

	if broker := s.broker; broker != nil {
		if reply, err := broker.Call(r.Context(), "wiki", "confluence.state", nil); err == nil && reply.Error == "" {

			var fromSidecar struct {
				Instance       *string `json:"instance"`
				InstanceSource *string `json:"instanceSource"`
				TokenSource    *string `json:"tokenSource"`
			}
			if json.Unmarshal(reply.Result, &fromSidecar) == nil {
				state.Instance = fromSidecar.Instance
				state.InstanceSource = fromSidecar.InstanceSource
				state.TokenSource = fromSidecar.TokenSource
			}
		}
		// A refusal here (no plugin directory, no grant, no sidecar binary) is
		// not surfaced as an error: the state line simply shows no instance and
		// no token source, the same as an environment that held neither.
	}

	wiki, err := facetwiki.LoadWiki(facetwiki.WikiDir(s.Registry))
	if err != nil || wiki == nil || !wiki.Present {
		// A project with no wiki is a state and not a failure: the left tree is
		// empty, the surface says so, and nothing here pretends otherwise.
		writeJSON(w, state)
		return
	}

	counts := map[string]int{}
	for _, page := range wiki.Pages {
		counts[page.Area()]++
	}
	for _, id := range wiki.Areas() {
		row := confluenceArea{ID: id, Pages: counts[id], State: "ok"}
		if declared, ok := wiki.Config.Areas.Get(id); ok {
			if title := strings.TrimSpace(declared.Title); title != "" {
				row.Title = &title
			}
			if counts[id] == 0 {
				row.State = "empty"
			}
		} else {
			// No title invented. the specification: a missing declaration claims nothing.
			row.State = "undeclared"
		}
		state.Areas = append(state.Areas, row)
	}

	state.Connections = confluenceConnections(s.Registry, wiki)
	writeJSON(w, state)
}

// confluenceConnections reads what already exists out of the repository.
//
// Two sources, in this order of authority:
//
//  1. A page's own 'mirror:' header — it declares where the page belongs, so
//     the wiki is the origin and Confluence the copy.
//  2. An import's 'aliases' — it carries the page's alternative addresses, which
//     is exactly not a statement about who wins. That is "Choice open", the
//     third state of the specification, and flattening it into either of the others would be
//     answering a question nobody answered.
//
// .mirror.json contributes the target when it names one, because a mirror that
// has actually run is the strongest evidence there is that a connection exists.
func confluenceConnections(reg facet.Registry, wiki *facetwiki.Wiki) []confluenceConnection {
	type found struct {
		target   string
		kind     string
		evidence string
	}
	byArea := map[string]found{}
	order := []string{}
	note := func(area string, next found) {
		if _, seen := byArea[area]; !seen {
			order = append(order, area)
		}
		byArea[area] = next
	}

	for _, page := range wiki.Pages {
		area := page.Area()
		if area == "" {
			continue
		}
		if page.Front.Mirror != nil && strings.TrimSpace(page.Front.Mirror.Space) != "" {
			note(area, found{
				target:   strings.TrimSpace(page.Front.Mirror.Space),
				kind:     "origin",
				evidence: page.Path,
			})
			continue
		}
		if existing, seen := byArea[area]; seen && existing.kind == "origin" {
			// A declared mirror target outranks an alias: the header says where
			// the page belongs, while the alias is only an alternative address.
			continue
		}
		for _, alias := range page.Front.Aliases {
			if m := confluenceSpaceInAlias.FindStringSubmatch(alias); m != nil {
				note(area, found{target: m[1], kind: "open", evidence: page.Path})
				break
			}
		}
	}

	// .mirror.json is read last and only to confirm: a state file naming a
	// target proves a mirror ran, which makes the wiki the origin.
	if target, entries := confluenceMirrorTarget(reg); target != "" {
		for _, rel := range entries {
			area := strings.SplitN(filepath.ToSlash(rel), "/", 2)[0]
			if area == "" {
				continue
			}
			note(area, found{
				target:   target,
				kind:     "origin",
				evidence: filepath.Join(facetwiki.WikiDirName, facetwiki.WikiMirrorStateName),
			})
		}
	}

	out := make([]confluenceConnection, 0, len(order))
	for _, area := range order {
		row := byArea[area]
		out = append(out, confluenceConnection{
			Area:     area,
			Target:   row.target,
			Kind:     row.kind,
			Evidence: filepath.ToSlash(row.evidence),
		})
	}
	return out
}

// confluenceMirrorTarget reads the space and the paths .mirror.json holds.
//
// The file is read directly rather than through LoadWikiMirrorState, and the
// reason is a real difference in the question being asked. That function is
// built for a mirror RUN: handed a target, it blanks the entries of any other
// target, because reusing a foreign target's digests would make every page look
// unchanged. Right for pushing — and wrong here, where the question is not
// "what may I trust as already pushed" but "what does this repository say
// exists". Called with an empty target it hands back an empty map, and the
// surface would then draw no connection at all for a wiki that plainly has one.
//
// The target is stored as "confluence:ENG"; only the space is of interest here.
// A file for some other source is not this surface's business and is ignored
// rather than misread.
func confluenceMirrorTarget(reg facet.Registry) (string, []string) {
	data, err := os.ReadFile(filepath.Join(facetwiki.WikiDir(reg), facetwiki.WikiMirrorStateName))
	if err != nil {
		return "", nil
	}
	var state facetwiki.WikiMirrorState
	if err := json.Unmarshal(data, &state); err != nil {
		// A malformed state file is not a connection. It is also not this
		// route's business to repair, so it is passed over here and left to
		// 'facet wiki check' to report.
		return "", nil
	}
	if !strings.HasPrefix(state.Target, confluenceMirrorTargetPrefix) {
		return "", nil
	}
	space := strings.TrimPrefix(state.Target, confluenceMirrorTargetPrefix)
	if space == "" {
		return "", nil
	}
	paths := make([]string, 0, len(state.Entries))
	for rel := range state.Entries {
		paths = append(paths, rel)
	}
	// Sorted, so two reads of one file produce one order — the surface numbers
	// its rows, and a list that reshuffles between renders renumbers them.
	sort.Strings(paths)
	return space, paths
}

// confluenceReach makes exactly one request and reports what came back.
//
// One, and the count is the promise. Not one per tree node, not one on mount:
// the surface's whole claim about reachability rests on a measurement somebody
// asked for, and a route that quietly made several would make "last reached"
// mean something else than it says.
//
// Without credentials it makes NO request and says so. Inventing a status for a
// request that never went out is the exact failure this surface exists to
// avoid.
func (s *Service) confluenceReach(w http.ResponseWriter, r *http.Request) {
	now := time.Now().Format(time.RFC3339)

	broker := s.broker
	if broker == nil {
		writeJSON(w, confluenceUnanswered("no plugin directory is configured", confluenceReachNoPluginDirectoryCode, now))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	reply, err := broker.Call(ctx, "wiki", "confluence.reach", nil)
	if err != nil {
		// A refusal (no grant, no sidecar, checksum mismatch) reads the same
		// as the sidecar itself finding no credentials: no request went out,
		// and the reason names why. The broker's own words are technical and
		// travel without a code.
		writeJSON(w, confluenceUnanswered(err.Error(), "", now))
		return
	}
	if reply.Error != "" {
		writeJSON(w, confluenceUnanswered(reply.Error, "", now))
		return
	}
	// Decoded into the full type, codes included, so a code the sidecar sent
	// reaches the reader rather than being dropped on the way through.
	var fromSidecar confluenceReach
	if err := json.Unmarshal(reply.Result, &fromSidecar); err != nil {
		writeJSON(w, confluenceUnanswered("the sidecar's answer could not be read: "+err.Error(), "", now))
		return
	}
	fromSidecar.When = now
	writeJSON(w, fromSidecar)
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}
