package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// The environment is the only place a credential comes from.
//
// Named as constants rather than spelled inline at three call sites, because
// the error a person sees when one is missing has to name the same variable the
// documentation names. Nothing in this package writes any of these anywhere: not
// to a report, not to a log line, not to the state file. A credential that can
// reach a file is a credential that can reach a commit.
const (
	ConfluenceURLEnv   = "CONFLUENCE_URL"
	ConfluenceEmailEnv = "CONFLUENCE_EMAIL"
	ConfluenceTokenEnv = "CONFLUENCE_API_TOKEN"
)

// ErrConfluenceNoCredentials is the environment not holding what is needed.
//
// One error for all three, carrying which ones are absent, so a caller is told
// everything it has to fix rather than discovering the second missing variable
// after supplying the first.
var ErrConfluenceNoCredentials = errors.New("confluence credentials are not in the environment")

// missingConfluenceCredentials names the variables the environment lacks, in
// the order the documentation lists them. Names only: the reach result hands
// this list to the reader as a message parameter, and a value must never ride
// along.
func missingConfluenceCredentials() []string {
	var missing []string
	for _, name := range []string{ConfluenceURLEnv, ConfluenceEmailEnv, ConfluenceTokenEnv} {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

// confluenceClient is the narrow HTTP surface this adapter needs.
//
// Deliberately not a general Confluence SDK. Six calls: read a space, read a
// page, walk children, create, update, delete. A client that could do more would
// be a client somebody extends until the adapter has opinions about Confluence
// that the wiki never agreed to.
type confluenceClient struct {
	base  string
	email string
	token string
	http  *http.Client
	// calls counts requests made, so a test can report what a run costs rather
	// than estimating it.
	calls int
}

// newConfluenceClient reads the credential out of the environment.
//
// Read at construction rather than held in a config file, and never copied
// anywhere else. The struct field is the only place the token lives, and it goes
// out exactly once per request, into an Authorization header.
func newConfluenceClient() (*confluenceClient, error) {
	site := strings.TrimSpace(os.Getenv(ConfluenceURLEnv))
	email := strings.TrimSpace(os.Getenv(ConfluenceEmailEnv))
	token := strings.TrimSpace(os.Getenv(ConfluenceTokenEnv))

	if missing := missingConfluenceCredentials(); len(missing) > 0 {
		// The names are said, the values never are — including the ones that
		// were present, because "the token is set but the URL is missing" is
		// the whole of what a caller needs and printing either is how a
		// credential reaches a terminal recording.
		return nil, fmt.Errorf("%w: %s", ErrConfluenceNoCredentials, strings.Join(missing, ", "))
	}
	return &confluenceClient{
		base:  strings.TrimSuffix(site, "/"),
		email: email,
		token: token,
		http:  &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// do makes one request against the Confluence Cloud REST API.
//
// The Authorization header is built here and nowhere else, so there is exactly
// one line in this package that touches the token — which is the line to look at
// when asking whether it can leak. It is never put in a URL, where it would land
// in a proxy log.
func (c *confluenceClient) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString(
		[]byte(c.email+":"+c.token)))
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	c.calls++
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// The status and Confluence's own message, and the path — but never the
		// request headers, because that is where the credential is.
		return &confluenceHTTPError{Status: resp.StatusCode, Path: path, Body: string(payload)}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(payload, out)
}

// confluenceHTTPError is a refusal from the far side, with the status a person
// needs to tell "wrong credential" from "page is absent".
type confluenceHTTPError struct {
	Status int
	Path   string
	Body   string
}

func (e *confluenceHTTPError) Error() string {
	detail := strings.TrimSpace(e.Body)
	if len(detail) > 400 {
		detail = detail[:400] + "…"
	}
	return fmt.Sprintf("confluence answered %d for %s: %s", e.Status, e.Path, detail)
}

// NotFound reports whether this is the far side saying a page is absent, which the
// mirror has to tell apart from every other failure: a deleted page is a thing
// somebody did, and re-creating it would undo their decision.
func (e *confluenceHTTPError) NotFound() bool { return e.Status == http.StatusNotFound }

// confluencePage is the part of a page this adapter reads.
//
// The fields are what the v2 API returns for body-format=storage. Version is
// carried because it — not a hash of the body — is what the conflict rule rests
// on; see RemoteDigestOf.
type confluencePage struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	SpaceID  string `json:"spaceId"`
	ParentID string `json:"parentId"`
	Status   string `json:"status"`
	Version  struct {
		Number int `json:"number"`
	} `json:"version"`
	Body struct {
		Storage struct {
			Value          string `json:"value"`
			Representation string `json:"representation"`
		} `json:"storage"`
	} `json:"body"`
	Links struct {
		WebUI string `json:"webui"`
	} `json:"_links"`
}

// confluenceSpace is the part of a space this adapter reads.
type confluenceSpace struct {
	ID       string `json:"id"`
	Key      string `json:"key"`
	Name     string `json:"name"`
	HomepgID string `json:"homepageId"`
}

// confluenceList is the envelope v2 wraps collections in.
type confluenceList[T any] struct {
	Results []T `json:"results"`
	Links   struct {
		Next string `json:"next"`
	} `json:"_links"`
}

// RemoteDigestOf is what the mirror compares to decide whether the far side
// moved.
//
// Confluence's own version number, not a hash of the body. Measured against a
// live instance rather than assumed, and the measurement is worth recording
// because half of what was assumed turned out to be wrong:
//
//   - Confluence DOES rewrite storage format on save. A body sent without
//     ac:macro-id attributes came back with one injected per macro (528 bytes
//     in, 630 out). A digest over the returned body would therefore never match
//     a digest over what was sent.
//   - Those ids are NOT stable across saves. Pushing the same macro-free body
//     twice produced two different sets of ids, so a body digest would not
//     settle after the first push either.
//   - An identical push IS a no-op, but only byte-identical: echoing back the
//     body Confluence itself returned left the version untouched, and a page
//     with no macros at all no-ops on a repeat push. A page whose body this
//     renderer produced does NOT no-op, because the renderer emits no macro ids
//     and so the bytes differ every time.
//
// The consequence is that the version number is right for detecting a foreign
// edit — it moves exactly when somebody saves — but it is NOT a safe test for
// "is the far side still what we pushed". This adapter only asks the first
// question, and asks the second against the local file's own digest, which is
// why the ordering in mirrorOne matters: the remote check is a conflict test,
// not an equality test.
//
// It is prefixed rather than stored bare so a state file can never be read as
// holding a content hash.
func RemoteDigestOf(version int) string { return "v" + strconv.Itoa(version) }

// space reads a space by key.
func (c *confluenceClient) space(ctx context.Context, key string) (confluenceSpace, error) {
	var list confluenceList[confluenceSpace]
	err := c.do(ctx, http.MethodGet, "/wiki/api/v2/spaces?keys="+url.QueryEscape(key)+"&limit=1", nil, &list)
	if err != nil {
		return confluenceSpace{}, err
	}
	if len(list.Results) == 0 {
		return confluenceSpace{}, fmt.Errorf("no space with key %q", key)
	}
	return list.Results[0], nil
}

// page reads one page with its storage-format body.
//
// body-format=storage rather than atlas_doc_format, and that is deliberate:
// atlas_doc_format has a reported defect where it returns the current version
// number beside version one's content, which would make the adapter mirror stale
// text while believing it current. Storage is also XHTML, which is what the
// converter on both sides is built for.
func (c *confluenceClient) page(ctx context.Context, id string) (confluencePage, error) {
	var page confluencePage
	err := c.do(ctx, http.MethodGet, "/wiki/api/v2/pages/"+url.PathEscape(id)+"?body-format=storage", nil, &page)
	return page, err
}

// pagesInSpace lists every page of a space, following the cursor.
//
// Every page rather than the first hundred: an import that silently stopped at a
// page limit would produce a wiki missing a third of a handbook and a report
// claiming success.
func (c *confluenceClient) pagesInSpace(ctx context.Context, spaceID string) ([]confluencePage, error) {
	path := "/wiki/api/v2/spaces/" + url.PathEscape(spaceID) + "/pages?body-format=storage&limit=100"
	var out []confluencePage
	for path != "" {
		var list confluenceList[confluencePage]
		if err := c.do(ctx, http.MethodGet, path, nil, &list); err != nil {
			return nil, err
		}
		out = append(out, list.Results...)
		path = strings.TrimPrefix(list.Links.Next, "/wiki")
		if path != "" {
			path = "/wiki" + path
		}
	}
	return out, nil
}

// children lists a page's direct children, following the cursor.
func (c *confluenceClient) children(ctx context.Context, id string) ([]confluencePage, error) {
	path := "/wiki/api/v2/pages/" + url.PathEscape(id) + "/children?limit=100"
	var out []confluencePage
	for path != "" {
		var list confluenceList[confluencePage]
		if err := c.do(ctx, http.MethodGet, path, nil, &list); err != nil {
			return nil, err
		}
		out = append(out, list.Results...)
		path = strings.TrimPrefix(list.Links.Next, "/wiki")
		if path != "" {
			path = "/wiki" + path
		}
	}
	return out, nil
}

// createPage writes a new page, optionally under a parent.
func (c *confluenceClient) createPage(ctx context.Context, spaceID, parentID, title, storage string) (confluencePage, error) {
	body := map[string]any{
		"spaceId": spaceID,
		"status":  "current",
		"title":   title,
		"body": map[string]any{
			"representation": "storage",
			"value":          storage,
		},
	}
	if parentID != "" {
		body["parentId"] = parentID
	}
	var page confluencePage
	err := c.do(ctx, http.MethodPost, "/wiki/api/v2/pages", body, &page)
	return page, err
}

// updatePage replaces a page's body.
//
// Confluence requires the next version number rather than the current one, and
// refuses a stale one — which is a second guard beneath the conflict rule: if
// somebody saved between the read and the write, this call fails rather than
// overwriting them.
func (c *confluenceClient) updatePage(ctx context.Context, id, title, storage string, nextVersion int) (confluencePage, error) {
	body := map[string]any{
		"id":     id,
		"status": "current",
		"title":  title,
		"body": map[string]any{
			"representation": "storage",
			"value":          storage,
		},
		"version": map[string]any{"number": nextVersion},
	}
	var page confluencePage
	err := c.do(ctx, http.MethodPut, "/wiki/api/v2/pages/"+url.PathEscape(id), body, &page)
	return page, err
}

// deletePage removes a page. Used by the end-to-end run to clear up after
// itself, and by nothing else — the mirror never deletes on the far side.
func (c *confluenceClient) deletePage(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/wiki/api/v2/pages/"+url.PathEscape(id), nil, nil)
}

// createSpace makes a space. Only the end-to-end run uses it, so a test run
// confines itself to a space it made rather than touching one somebody owns.
func (c *confluenceClient) createSpace(ctx context.Context, key, name string) (confluenceSpace, error) {
	var space confluenceSpace
	err := c.do(ctx, http.MethodPost, "/wiki/api/v2/spaces",
		map[string]any{"key": key, "name": name}, &space)
	return space, err
}

// deleteSpace removes a space, for the same reason createSpace exists.
//
// The v1 endpoint, and keyed on the space KEY rather than its id, because v2 has
// no space delete at all: DELETE on /api/v2/spaces/<id> is routed to the generic
// content deleter and answers "Provided value {spaces} for 'generic-content-type'
// is not the correct type". Measured against the live instance rather than read
// off a table — the v2 call returns a 400 that looks like a bad argument, which
// is how an end-to-end run comes to leave its space behind while reporting a
// failure that reads like a caller error.
//
// It starts a long-running task and answers 202. The task is not waited on: what
// the caller needs is that deletion was accepted, and a test that blocked on a
// space reaper would be a test that fails when Confluence is busy.
func (c *confluenceClient) deleteSpace(ctx context.Context, key string) error {
	return c.do(ctx, http.MethodDelete, "/wiki/rest/api/space/"+url.PathEscape(key), nil, nil)
}
