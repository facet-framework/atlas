package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/facet-framework/core/registry"
)

// TestReportPath is where the reader asks what a test report says.
const TestReportPath = "/api/test-report"

// maxTestReportBytes caps what the reader will read of a report. A real
// report is a few hundred kilobytes; the cap keeps a wrong path from pulling
// an arbitrary file into memory.
const maxTestReportBytes = 8 << 20

// Report states. Only testReportFresh carries counts.
const (
	testReportNone        = "none"       // no --test-report given, or the file is not there
	testReportUnreadable  = "unreadable" // not a regular file, too large, or not a report; see the reason code
	testReportAmbiguous   = "ambiguous"  // the file says two things about one registry, runner or key
	testReportNoEntry     = "no-entry"   // the report holds nothing for this registry
	testReportNoHead      = "no-head"    // the report does not say which commit and tree it measured
	testReportNoGit       = "no-git"
	testReportStale       = "stale"        // measured on another commit
	testReportDirty       = "dirty"        // measured on a tree with changes
	testReportTreeChanged = "tree-changed" // the report is clean and current, but the tree shown has changed since
	testReportUnmeasured  = "unmeasured"   // fresh, but no file produced evidence
	testReportFresh       = "fresh"
)

// Reason codes for an unreadable report. Fixed words: the raw error (which
// carries the absolute path or the first bytes of whatever file was named)
// goes to the server log and never to the browser.
const (
	reasonNotRegular = "not-regular"
	reasonTooLarge   = "too-large"
	reasonPermission = "permission"
	reasonNotJSON    = "not-json"
	reasonWrongShape = "wrong-shape"
	reasonIO         = "io"
)

// testReportResponse is what /api/test-report answers with. The counts exist
// only when State is "fresh": a stale or missing report carries no number at
// all, so the reader cannot draw one by accident.
type testReportResponse struct {
	State      string `json:"state"`
	Reason     string `json:"reason,omitempty"`
	ReportHead string `json:"reportHead,omitempty"`
	Head       string `json:"head,omitempty"`
	Passed     *int   `json:"passed,omitempty"`
	Failed     *int   `json:"failed,omitempty"`
	Unmeasured *int   `json:"unmeasured,omitempty"`
}

// reportError carries a fixed reason code beside the raw error.
type reportError struct {
	reason string
	err    error
}

func (e *reportError) Error() string { return e.reason + ": " + e.err.Error() }
func (e *reportError) Unwrap() error { return e.err }

func reportFail(reason string, err error) error { return &reportError{reason, err} }

// hasDuplicateKeys reports whether any JSON object in data names a key twice
// (ignoring case, which is how encoding/json matches fields). encoding/json
// keeps the last value silently; a report that says "dirty: true" and then
// "dirty: false" is not a measurement.
func hasDuplicateKeys(data []byte) bool {
	dec := json.NewDecoder(bytes.NewReader(data))
	dup, _ := scanDuplicates(dec)
	return dup
}

func scanDuplicates(dec *json.Decoder) (bool, error) {
	tok, err := dec.Token()
	if err != nil {
		return false, err
	}
	delim, ok := tok.(json.Delim)
	if !ok {
		return false, nil
	}
	seen := map[string]bool{}
	for dec.More() {
		if delim == '{' {
			k, err := dec.Token()
			if err != nil {
				return false, err
			}
			key := strings.ToLower(k.(string))
			if seen[key] {
				return true, nil
			}
			seen[key] = true
		}
		if dup, err := scanDuplicates(dec); dup || err != nil {
			return dup, err
		}
	}
	_, err = dec.Token()
	return false, err
}

// readTestReport reads and decodes the report file named on the command line.
// It never runs anything. Failures carry a reportError with a fixed reason.
func readTestReport(path string) ([]facet.TestExecution, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) || os.IsPermission(err) {
			return nil, err
		}
		return nil, reportFail(reasonIO, err)
	}
	// Checked before opening: opening a FIFO would block the request.
	if !info.Mode().IsRegular() {
		return nil, reportFail(reasonNotRegular, fmt.Errorf("%s is not a regular file", path))
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsPermission(err) {
			return nil, reportFail(reasonPermission, err)
		}
		return nil, reportFail(reasonIO, err)
	}
	defer f.Close()
	if opened, err := f.Stat(); err != nil || !opened.Mode().IsRegular() {
		return nil, reportFail(reasonNotRegular, fmt.Errorf("%s is not a regular file", path))
	}
	data, err := io.ReadAll(io.LimitReader(f, maxTestReportBytes+1))
	if err != nil {
		return nil, reportFail(reasonIO, err)
	}
	if len(data) > maxTestReportBytes {
		return nil, reportFail(reasonTooLarge, fmt.Errorf("larger than %d bytes", maxTestReportBytes))
	}
	if hasDuplicateKeys(data) {
		return nil, errAmbiguousReport
	}
	var entries []facet.TestExecution
	if err := json.Unmarshal(data, &entries); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return nil, reportFail(reasonWrongShape, err)
		}
		return nil, reportFail(reasonNotJSON, err)
	}
	return entries, nil
}

var errAmbiguousReport = errors.New("report names a key twice")

// ambiguousEntries reports whether the report says two things about one
// registry, or whether an entry names a runner twice.
func ambiguousEntries(entries []facet.TestExecution, registry string) bool {
	matches := 0
	for _, e := range entries {
		if e.Discovery.Registry != registry {
			continue
		}
		matches++
		seen := map[string]bool{}
		for _, r := range e.Runners {
			if seen["run:"+r.Name] {
				return true
			}
			seen["run:"+r.Name] = true
		}
		for _, r := range e.Discovery.Runners {
			if seen["disc:"+r.Name] {
				return true
			}
			seen["disc:"+r.Name] = true
		}
	}
	return matches > 1
}

// testReportState judges a report against the repository this reader serves.
func (s *Server) testReportState() testReportResponse {
	if s.TestReport == "" {
		return testReportResponse{State: testReportNone}
	}
	entries, err := readTestReport(s.TestReport)
	if err != nil {
		if os.IsNotExist(err) {
			return testReportResponse{State: testReportNone}
		}
		if errors.Is(err, errAmbiguousReport) {
			return testReportResponse{State: testReportAmbiguous}
		}
		log.Printf("test report %s: %v", s.TestReport, err)
		var re *reportError
		switch {
		case errors.As(err, &re):
			return testReportResponse{State: testReportUnreadable, Reason: re.reason}
		case os.IsPermission(err):
			return testReportResponse{State: testReportUnreadable, Reason: reasonPermission}
		}
		return testReportResponse{State: testReportUnreadable, Reason: reasonIO}
	}
	if ambiguousEntries(entries, s.Registry.Name) {
		return testReportResponse{State: testReportAmbiguous}
	}
	var entry *facet.TestExecution
	for i := range entries {
		if entries[i].Discovery.Registry == s.Registry.Name {
			entry = &entries[i]
			break
		}
	}
	if entry == nil {
		return testReportResponse{State: testReportNoEntry}
	}
	// A missing `dirty` is unknown, not clean.
	if entry.Head == "" || entry.Dirty == nil {
		return testReportResponse{State: testReportNoHead}
	}
	head, dirty, err := facet.GitTreeState(s.Registry.Root)
	if err != nil {
		log.Printf("test report: cannot read HEAD of %s: %v", s.Registry.Root, err)
		return testReportResponse{State: testReportNoGit, ReportHead: entry.Head}
	}
	switch {
	case entry.Head != head:
		return testReportResponse{State: testReportStale, ReportHead: entry.Head, Head: head}
	case *entry.Dirty:
		return testReportResponse{State: testReportDirty, ReportHead: entry.Head, Head: head}
	case dirty:
		return testReportResponse{State: testReportTreeChanged, ReportHead: entry.Head, Head: head}
	}
	counts := entry.FileCounts()
	if !counts.Measured() {
		return testReportResponse{State: testReportUnmeasured, ReportHead: entry.Head, Head: head}
	}
	return testReportResponse{
		State: testReportFresh, ReportHead: entry.Head, Head: head,
		Passed: &counts.Passed, Failed: &counts.Failed, Unmeasured: &counts.Unmeasured,
	}
}

// testReport answers with the judged report. Atlas reads a report; it does not
// produce one.
func (s *Server) testReport(w http.ResponseWriter, r *http.Request) {
	if !allowLocalRead(w, r, "read the test report") {
		return
	}
	writeJSON(w, s.testReportState())
}
