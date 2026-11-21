package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func authorizePluginRequest(t *testing.T, s *Server, plugin string, req *http.Request) {
	t.Helper()
	const host = "127.0.0.1:7777"
	page := loopbackRequest(http.MethodGet, "/", nil)
	page.Host = host
	pageRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(pageRec, page)
	cookies := pageRec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("Atlas did not establish a plugin session")
	}

	claim := loopbackRequest(http.MethodPost, PluginSessionPath, strings.NewReader(`{"plugins":["`+plugin+`"]}`))
	claim.Host = host
	claim.Header.Set("Origin", "http://"+host)
	claim.AddCookie(cookies[0])
	claimRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(claimRec, claim)
	if claimRec.Code != http.StatusOK {
		t.Fatalf("claiming %s capability: %d: %s", plugin, claimRec.Code, claimRec.Body.String())
	}
	var answer struct {
		Capabilities map[string]string `json:"capabilities"`
	}
	if err := json.NewDecoder(claimRec.Body).Decode(&answer); err != nil {
		t.Fatal(err)
	}
	req.Host = host
	req.Header.Set("Origin", "http://"+host)
	req.Header.Set(pluginCapabilityHeader, answer.Capabilities[plugin])
}
