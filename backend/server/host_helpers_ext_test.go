package server_test

import (
	"io"
	"net/http"
	"net/http/httptest"
)

// loopbackTestHost is the Host every test request carries unless its target
// names one. httptest.NewRequest defaults to "example.com", which the reader refuses
// in front of every route (host.go) — a test that meant to reach a route would
// otherwise only ever see that refusal, and a test of a route's own refusal
// would pass for the wrong reason.
const loopbackTestHost = "127.0.0.1"

func loopbackRequest(method, target string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, target, body)
	if req.Host == "example.com" {
		req.Host = loopbackTestHost
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	return req
}
