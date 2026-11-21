// Package transport adapts the pure engine to Atlas sidecar tools.
// @facet: customization/documents/dmn-analysis
// @facet-role: related
package transport

import (
	"encoding/json"
	"fmt"
	"github.com/facet-framework/atlas/plugins/dmn/sidecar/engine"
	"strings"
)

type Args struct {
	XML      string         `json:"xml"`
	Decision string         `json:"decision"`
	Inputs   map[string]any `json:"inputs"`
	Cases    []engine.Case  `json:"cases"`
}

func decode(raw json.RawMessage, out any) error {
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.UseNumber()
	return d.Decode(out)
}
func Dispatch(tool string, raw json.RawMessage) (any, error) {
	if tool == "facet.lint" {
		return lint(raw)
	}
	if tool != "dmn.inspect" && tool != "dmn.analyze" && tool != "dmn.evaluate" {
		return nil, fmt.Errorf("unknown tool %q", tool)
	}
	var a Args
	if e := decode(raw, &a); e != nil {
		return nil, e
	}
	m, e := engine.Parse(a.XML)
	if e != nil {
		return nil, e
	}
	switch tool {
	case "dmn.inspect":
		return m, nil
	case "dmn.analyze":
		return engine.Analyze(m, a.Decision, a.Cases)
	default:
		return engine.Evaluate(m, a.Decision, a.Inputs)
	}
}

type lintFinding struct {
	FID      string `json:"fid"`
	Category string `json:"category"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}
type lintRecord struct {
	ID       string `json:"id"`
	Contract struct {
		Rules []struct {
			ID, Model, Element, Kind, Completeness string
			Scenarios                              []string
		} `json:"business_rules"`
		Scenarios []struct {
			ID       string
			PreState map[string]any `json:"pre_state"`
			Examples []struct {
				Columns []string
				Rows    [][]any
			}
		}
	}
}

func lint(raw json.RawMessage) (any, error) {
	var req struct {
		Records []lintRecord
		Files   map[string]string
	}
	if e := decode(raw, &req); e != nil {
		return nil, e
	}
	findings := []lintFinding{}
	add := func(fid, cat, sev, msg string) { findings = append(findings, lintFinding{fid, cat, sev, msg}) }
	for _, rec := range req.Records {
		for _, rule := range rec.Contract.Rules {
			prefix := rule.Model + "#" + rule.Element + ": "
			text, ok := req.Files[rule.Model]
			if !ok {
				add(rec.ID, "dmn-reference", "Error", prefix+"model missing or outside granted reads")
				continue
			}
			m, e := engine.Parse(text)
			if e != nil {
				add(rec.ID, "dmn-model", "Error", prefix+e.Error())
				continue
			}
			if rule.Kind != "table" {
				add(rec.ID, "dmn-analysis", "Warning", prefix+"formula not analyzed")
				continue
			}
			var cases []engine.Case
			for _, sid := range rule.Scenarios {
				found := false
				for _, s := range rec.Contract.Scenarios {
					if s.ID != sid {
						continue
					}
					found = true
					if len(s.Examples) > 0 {
						var inherited []string
						for blockIndex, block := range s.Examples {
							cols := block.Columns
							if len(cols) == 0 {
								cols = inherited
							} else if inherited == nil {
								inherited = cols
							}
							for n, row := range block.Rows {
								inputs := map[string]any{}
								if len(cols) != len(row) {
									add(rec.ID, "dmn-scenario", "Warning", sid+": example arity mismatch")
									continue
								}
								for i, k := range cols {
									inputs[k] = row[i]
								}
								cases = append(cases, engine.Case{ID: fmt.Sprintf("%s/%d/%d", sid, blockIndex+1, n+1), Inputs: inputs})
							}
						}
					} else if s.PreState != nil {
						cases = append(cases, engine.Case{ID: sid, Inputs: s.PreState})
					} else {
						add(rec.ID, "dmn-scenario", "Warning", sid+": no structured inputs")
					}
				}
				if !found {
					add(rec.ID, "dmn-reference", "Error", prefix+"unknown scenario "+sid)
				}
			}
			report, e := engine.Analyze(m, rule.Element, cases)
			if e != nil {
				add(rec.ID, "dmn-reference", "Error", prefix+e.Error())
				continue
			}
			if report.Status != "analyzed" {
				add(rec.ID, "dmn-analysis", "Warning", prefix+strings.Join(report.Reasons, "; "))
				continue
			}
			for _, f := range report.Findings {
				severity := "Warning"
				if f.Kind == "conflict" || f.Kind == "gap" && rule.Completeness == "claimed" {
					severity = "Error"
				}
				b, _ := json.Marshal(f)
				add(rec.ID, "dmn-"+f.Kind, severity, prefix+string(b))
			}
			for _, c := range report.Cases {
				if c.Error != "" {
					add(rec.ID, "dmn-scenario", "Warning", prefix+c.ID+": "+c.Error)
				}
			}
			if report.Truncated {
				add(rec.ID, "dmn-analysis", "Warning", prefix+"finding details truncated")
			}
		}
	}
	return struct {
		Findings []lintFinding `json:"findings"`
	}{findings}, nil
}
