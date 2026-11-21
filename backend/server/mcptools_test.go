package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func askMCPTools(t *testing.T, s *Server, origin string) (*httptest.ResponseRecorder, mcpToolsResponse) {
	t.Helper()
	req := loopbackRequest(http.MethodGet, MCPToolsPath, nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	var body mcpToolsResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unreadable response %q: %v", rec.Body.String(), err)
		}
	}
	return rec, body
}

func TestMCPToolsAreServedFromTheListerAndNotFromAList(t *testing.T) {
	s := &Server{MCPTools: func(context.Context) ([]string, error) {
		return []string{"zz_made_up_for_this_test", "aa_first"}, nil
	}}
	_, body := askMCPTools(t, s, "")

	if !body.Available || !reflect.DeepEqual(body.Tools, []string{"zz_made_up_for_this_test", "aa_first"}) {
		t.Fatalf("the endpoint did not pass the lister's names through: %+v", body)
	}
}

func TestMCPToolsSayWhyWhenTheyCannotBeListed(t *testing.T) {
	_, none := askMCPTools(t, &Server{}, "")
	if none.Available || none.Reason == "" || len(none.Tools) != 0 {
		t.Fatalf("no lister must be said in words, not as an empty server: %+v", none)
	}
	failing := &Server{MCPTools: func(context.Context) ([]string, error) { return nil, errors.New("boom") }}
	_, failed := askMCPTools(t, failing, "")
	if failed.Available || failed.Reason != "boom" {
		t.Fatalf("a failing lister must carry its reason: %+v", failed)
	}
}

func TestMCPToolsRefuseAForeignOrigin(t *testing.T) {
	rec, _ := askMCPTools(t, &Server{}, "https://example.com")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}
