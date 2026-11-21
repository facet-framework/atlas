package transport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
)

const xml = `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/"><decision id="d"><decisionTable><input><inputExpression typeRef="boolean"><text>yes</text></inputExpression><inputValues><text>-</text></inputValues></input><output name="result"/><rule id="r"><inputEntry><text>true</text></inputEntry><outputEntry><text>true</text></outputEntry></rule></decisionTable></decision></definitions>`

func TestToolsAndLint(t *testing.T) {
	args, _ := json.Marshal(map[string]any{"xml": xml, "decision": "d", "inputs": map[string]any{"yes": true}})
	for _, tool := range []string{"dmn.inspect", "dmn.analyze", "dmn.evaluate"} {
		if _, e := Dispatch(tool, args); e != nil {
			t.Fatal(tool, e)
		}
	}
	raw, _ := json.Marshal(map[string]any{"files": map[string]string{"rules/a.dmn": xml}, "records": []any{map[string]any{"id": "test/a/b", "contract": map[string]any{"business_rules": []any{map[string]any{"id": "r", "model": "rules/a.dmn", "element": "d", "kind": "table", "completeness": "claimed", "scenarios": []string{"s"}}}, "scenarios": []any{map[string]any{"id": "s", "pre_state": map[string]any{"yes": true}}}}}}})
	result, e := Dispatch("facet.lint", raw)
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(result)
	if !strings.Contains(string(b), `"severity":"Error"`) || !strings.Contains(string(b), "dmn-gap") || strings.Contains(string(b), "dmn-uncovered") {
		t.Fatal(string(b))
	}
	// The Error is the gap finding itself, read from the decoded lint answer
	// rather than from two substrings that could belong to different findings.
	if got := severities(t, b, "dmn-gap"); len(got) != 1 || got[0] != "Error" {
		t.Fatalf("dmn-gap severities %v, want exactly one Error: %s", got, b)
	}
	if got := severities(t, b, "dmn-uncovered"); len(got) != 0 {
		t.Fatalf("the covered rule r is reported as uncovered: %s", b)
	}
	raw = []byte(`{"files":{},"records":[{"id":"a/b/c","contract":{"business_rules":[{"model":"rules/missing.dmn","element":"d"}]}}]}`)
	result, e = Dispatch("facet.lint", raw)
	b, _ = json.Marshal(result)
	if e != nil || !strings.Contains(string(b), "dmn-reference") {
		t.Fatal(string(b), e)
	}
	if got := severities(t, b, "dmn-reference"); len(got) != 1 || got[0] != "Error" {
		t.Fatalf("dmn-reference severities %v, want exactly one Error: %s", got, b)
	}
}

// severities decodes a facet.lint answer and returns the severity of every
// finding in the given category.
func severities(t *testing.T, answer []byte, category string) []string {
	t.Helper()
	var decoded struct {
		Findings []struct {
			Category string `json:"category"`
			Severity string `json:"severity"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(answer, &decoded); err != nil {
		t.Fatalf("lint answer is not JSON: %v: %s", err, answer)
	}
	out := []string{}
	for _, f := range decoded.Findings {
		if f.Category == category {
			out = append(out, f.Severity)
		}
	}
	return out
}
func TestFramingRecoveryAndLimits(t *testing.T) {
	good := `{"tool":"dmn.inspect","args":{"xml":` + fmt.Sprintf("%q", xml) + `}}`
	bad := `{"tool":"unknown"}`
	frame := func(s string) string { return fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(s), s) }
	var out bytes.Buffer
	e := Serve(strings.NewReader(frame(bad)+frame(good)), &out)
	if e != io.EOF || !strings.Contains(out.String(), "unknown tool") || !strings.Contains(out.String(), "sha256") {
		t.Fatal(out.String(), e)
	}
	for _, s := range []string{"Content-Length: 999999999\r\n\r\n", "Content-Length: 1\r\nContent-Length: 1\r\n\r\nx", strings.Repeat("x", 10000)} {
		if e := Serve(strings.NewReader(s), io.Discard); e == nil {
			t.Fatal("invalid frame accepted")
		}
	}
}
