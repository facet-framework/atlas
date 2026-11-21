// Reach is the one measurement the setup surface rests on; these fix what it is
// allowed to claim. Fixtures only — no live instance.
// @facet-ignore-file
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

// The promise in the name: one request, not one per anything.
func TestReachMakesExactlyOneRequest(t *testing.T) {
	src, _ := newFakeConfluence(t)
	before := src.Calls()

	if _, err := src.Reach(context.Background()); err != nil {
		t.Fatalf("Reach against the fake far side: %v", err)
	}
	if spent := src.Calls() - before; spent != 1 {
		t.Fatalf("Reach spent %d API calls, the surface promises exactly 1", spent)
	}
}

// A 200 is reported as a 200 — the status, not a word for it.
func TestReachReportsTheStatusItGot(t *testing.T) {
	src, _ := newFakeConfluence(t)

	status, err := src.Reach(context.Background())
	if err != nil {
		t.Fatalf("Reach: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, expected 200", status)
	}
}

// The case the whole state line hangs on: a refusal IS a reach. The status
// comes back beside the error, so a caller can tell "answered no" from "did not
// answer" without parsing a message.
func TestARefusalIsReportedAsAStatusAndNotAsSilence(t *testing.T) {
	src := &ConfluenceSource{client: &confluenceClient{
		base: "https://example.invalid",
		http: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusUnauthorized,
				Body:       http.NoBody,
				Header:     http.Header{},
			}, nil
		})},
	}}
	src.calls = func() int { return src.client.calls }

	status, err := src.Reach(context.Background())
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, expected the 401 to come back as a status", status)
	}
	if err == nil {
		t.Fatal("a 401 should still carry its error for the caller that wants the text")
	}
	if src.Calls() != 1 {
		t.Fatalf("a refused reach spent %d calls, expected 1", src.Calls())
	}
}

// No answer at all means status 0 — and that zero is the signal, not a status
// somebody could print.
func TestAnAbsentAnswerReportsNoStatus(t *testing.T) {
	src := &ConfluenceSource{client: &confluenceClient{
		base: "https://example.invalid",
		http: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("connection refused")
		})},
	}}
	src.calls = func() int { return src.client.calls }

	status, err := src.Reach(context.Background())
	if status != 0 {
		t.Fatalf("status = %d, expected 0 — no server sent one", status)
	}
	if err == nil {
		t.Fatal("an absent answer must carry its reason")
	}
	if !strings.Contains(err.Error(), "connection refused") {
		t.Fatalf("the reason what rewritten: %v", err)
	}
}

// reachThroughDispatch asks the sidecar the way the host does — a call through
// dispatch — and returns the raw result the host would receive.
func reachThroughDispatch(t *testing.T) (map[string]any, string) {
	t.Helper()
	reply := dispatch(facet.SidecarCall{Tool: "confluence.reach"})
	if reply.Error != "" {
		t.Fatalf("confluence.reach answered with an error instead of a result: %s", reply.Error)
	}
	var out map[string]any
	if err := json.Unmarshal(reply.Result, &out); err != nil {
		t.Fatalf("the result is not JSON: %v (%s)", err, reply.Result)
	}
	return out, string(reply.Result)
}

// The reader translates by code; the text beside it stays for an older
// reader. Missing credentials name the variables as a parameter — and only the
// names: the one variable that IS set must not leak its value into the result.
func TestTheReachResultWithoutCredentialsCarriesCodesAndOnlyVariableNames(t *testing.T) {
	t.Setenv(ConfluenceURLEnv, "")
	t.Setenv(ConfluenceEmailEnv, "")
	t.Setenv(ConfluenceTokenEnv, "token-value-that-must-not-travel")

	out, raw := reachThroughDispatch(t)
	if out["kind"] != "no-answer" {
		t.Fatalf("kind = %v, expected no-answer", out["kind"])
	}
	if out["whatCode"] != "confluence.reach.space-search" {
		t.Fatalf("whatCode = %v", out["whatCode"])
	}
	if params, _ := out["whatParams"].(map[string]any); params["limit"] != float64(1) {
		t.Fatalf("whatParams = %v, expected limit 1", out["whatParams"])
	}
	if out["what"] != "Space search, limit 1" {
		t.Fatalf("what = %v, expected the English source text", out["what"])
	}
	if out["reasonCode"] != "confluence.reach.no-credentials" {
		t.Fatalf("reasonCode = %v", out["reasonCode"])
	}
	params, _ := out["reasonParams"].(map[string]any)
	if params["missing"] != "CONFLUENCE_URL, CONFLUENCE_EMAIL" {
		t.Fatalf("reasonParams.missing = %v, expected the two absent names", params["missing"])
	}
	if strings.Contains(raw, "token-value-that-must-not-travel") {
		t.Fatalf("a credential value reached the result: %s", raw)
	}
}

// An answer carries the same code for what was asked, and no reason code.
func TestAnAnsweredReachCarriesTheCodeOfWhatWasAsked(t *testing.T) {
	far := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/wiki/api/v2/spaces" {
			t.Errorf("unexpected request %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer far.Close()
	t.Setenv(ConfluenceURLEnv, far.URL)
	t.Setenv(ConfluenceEmailEnv, "reader@example.invalid")
	t.Setenv(ConfluenceTokenEnv, "token")

	out, _ := reachThroughDispatch(t)
	if out["kind"] != "answer" || out["status"] != float64(200) {
		t.Fatalf("kind = %v, status = %v, expected an answer with 200", out["kind"], out["status"])
	}
	if out["whatCode"] != "confluence.reach.space-search" {
		t.Fatalf("whatCode = %v", out["whatCode"])
	}
	if _, ok := out["reasonCode"]; ok {
		t.Fatalf("an answer carried a reason code: %v", out["reasonCode"])
	}
}
