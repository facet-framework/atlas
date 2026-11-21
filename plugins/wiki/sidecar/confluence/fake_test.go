// The recorded far side: a RoundTripper answering the real Confluence Cloud v2
// payload shapes, so the adapter's own client, URL building and JSON decoding
// are exercised rather than bypassed.
// @facet-ignore-file
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// httpClient hands the adapter a transport that answers out of the fake's state.
func (f *fakeConfluence) httpClient() *http.Client {
	return &http.Client{Transport: roundTripFunc(f.answer)}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }

// byTitle finds a page the far side holds, failing the test when it is absent —
// so an assertion about a page that was never created reads as the missing page
// rather than as a nil dereference.
func (f *fakeConfluence) byTitle(t *testing.T, title string) *confluencePage {
	t.Helper()
	for _, page := range f.pages {
		if page.Title == title {
			return page
		}
	}
	var have []string
	for _, page := range f.pages {
		have = append(have, page.Title)
	}
	sort.Strings(have)
	t.Fatalf("no page titled %q on the far side, have %v", title, have)
	return nil
}

// answer routes one request. The paths are the real v2 ones, so a change to the
// client's URL building shows up here as a 404 rather than passing silently.
func (f *fakeConfluence) answer(r *http.Request) (*http.Response, error) {
	path := r.URL.Path

	switch {
	case r.Method == http.MethodGet && path == "/wiki/api/v2/spaces":
		key := r.URL.Query().Get("keys")
		if key != f.spaceKey {
			return f.json(200, confluenceList[confluenceSpace]{})
		}
		return f.json(200, confluenceList[confluenceSpace]{
			Results: []confluenceSpace{{ID: f.spaceID, Key: f.spaceKey, Name: "Engineering"}},
		})

	case r.Method == http.MethodGet && strings.HasSuffix(path, "/pages") &&
		strings.HasPrefix(path, "/wiki/api/v2/spaces/"):
		var results []confluencePage
		for _, page := range f.pages {
			results = append(results, *page)
		}
		sort.Slice(results, func(i, j int) bool { return results[i].ID < results[j].ID })
		return f.json(200, confluenceList[confluencePage]{Results: results})

	case r.Method == http.MethodGet && strings.HasSuffix(path, "/children"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/wiki/api/v2/pages/"), "/children")
		var results []confluencePage
		for _, page := range f.pages {
			if page.ParentID == id {
				results = append(results, *page)
			}
		}
		sort.Slice(results, func(i, j int) bool { return results[i].ID < results[j].ID })
		return f.json(200, confluenceList[confluencePage]{Results: results})

	case r.Method == http.MethodGet && strings.HasPrefix(path, "/wiki/api/v2/pages/"):
		id := strings.TrimPrefix(path, "/wiki/api/v2/pages/")
		page, ok := f.pages[id]
		if !ok {
			return f.json(404, map[string]any{"errors": []any{map[string]any{"status": 404}}})
		}
		return f.json(200, *page)

	case r.Method == http.MethodPost && path == "/wiki/api/v2/pages":
		if f.failCreateAfter != 0 && f.created >= max(f.failCreateAfter, 0) {
			// The shape a real outage takes: the far side stops answering part
			// way through a run that has already written real pages.
			return f.json(500, map[string]any{"errors": []any{
				map[string]any{"status": 500, "title": "Internal server error"}}})
		}
		var body struct {
			SpaceID  string `json:"spaceId"`
			ParentID string `json:"parentId"`
			Title    string `json:"title"`
			Body     struct {
				Value string `json:"value"`
			} `json:"body"`
		}
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		// Confluence refuses a duplicate title in a space. The fake refuses too,
		// so a mirror that stopped checking would fail here rather than pass.
		for _, page := range f.pages {
			if page.Title == body.Title {
				return f.json(400, map[string]any{"errors": []any{
					map[string]any{"status": 400, "title": "A page with this title already exists"}}})
			}
		}
		f.nextID++
		f.created++
		id := strconv.Itoa(f.nextID)
		return f.json(200, *f.add(id, body.Title, body.ParentID, body.Body.Value))

	case r.Method == http.MethodPut && strings.HasPrefix(path, "/wiki/api/v2/pages/"):
		id := strings.TrimPrefix(path, "/wiki/api/v2/pages/")
		page, ok := f.pages[id]
		if !ok {
			return f.json(404, map[string]any{"errors": []any{map[string]any{"status": 404}}})
		}
		var body struct {
			Title   string `json:"title"`
			Version struct {
				Number int `json:"number"`
			} `json:"version"`
			Body struct {
				Value string `json:"value"`
			} `json:"body"`
		}
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		if body.Version.Number != page.Version.Number+1 {
			// The real API's own guard: a stale version is refused. Answering
			// 409 here keeps the adapter honest about sending the next one.
			return f.json(409, map[string]any{"errors": []any{
				map[string]any{"status": 409, "title": "Version mismatch"}}})
		}
		page.Title = body.Title
		page.Version.Number = body.Version.Number
		// Confluence normalises storage format on save; the fake does the same,
		// which is what makes the no-op-push test mean anything.
		page.Body.Storage.Value = body.Body.Value + "<!-- normalised by confluence -->"
		return f.json(200, *page)

	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/wiki/api/v2/pages/"):
		id := strings.TrimPrefix(path, "/wiki/api/v2/pages/")
		if _, ok := f.pages[id]; !ok {
			return f.json(404, map[string]any{"errors": []any{map[string]any{"status": 404}}})
		}
		delete(f.pages, id)
		f.deleted = append(f.deleted, id)
		return f.json(204, nil)
	}

	return f.json(404, map[string]any{"errors": []any{
		map[string]any{"status": 404, "title": fmt.Sprintf("no route for %s %s", r.Method, path)}}})
}

func decode(r *http.Request, into any) error {
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, into)
}

func (f *fakeConfluence) json(status int, payload any) (*http.Response, error) {
	var body []byte
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = encoded
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}, nil
}
