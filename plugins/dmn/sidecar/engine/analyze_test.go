package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func modelXML(policy, domain string, conditions, outputs []string) string {
	rows := ""
	for i, condition := range conditions {
		rows += fmt.Sprintf(`<rule id="r%d"><inputEntry><text>%s</text></inputEntry><outputEntry><text>%s</text></outputEntry></rule>`, i+1, condition, outputs[i])
	}
	return `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/" id="m" name="Test" namespace="urn:test"><decision id="discount" name="Discount"><decisionTable id="table" hitPolicy="` + policy + `"><input><inputExpression typeRef="number"><text>amount</text></inputExpression><inputValues><text>` + domain + `</text></inputValues></input><output name="discount" typeRef="number"/>` + rows + `</decisionTable></decision></definitions>`
}
func parse(t *testing.T, xml string) Model {
	t.Helper()
	m, e := Parse(xml)
	if e != nil {
		t.Fatal(e)
	}
	return m
}
func run(t *testing.T, m Model, cases []Case) Report {
	t.Helper()
	r, e := Analyze(m, "discount", cases)
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func TestBoundaryGapAndScenarioCandidates(t *testing.T) {
	source := modelXML("UNIQUE", "[0..200]", []string{"&lt; 100", "&gt; 100"}, []string{"5", "10"})
	m := parse(t, source)
	r := run(t, m, []Case{{ID: "low", Inputs: map[string]any{"amount": 50}}})
	if r.Status != "analyzed" || r.SHA256 == "" || len(r.Uncovered) != 1 || r.Uncovered[0] != "r2" {
		t.Fatalf("%+v", r)
	}
	// The report names the digest of the very text that was analyzed, computed
	// here independently of the engine, not merely some non-empty value.
	digest := sha256.Sum256([]byte(source))
	if want := hex.EncodeToString(digest[:]); r.SHA256 != want {
		t.Fatalf("report digest %q, want the source's SHA-256 %q", r.SHA256, want)
	}
	gaps := 0
	uncovered := 0
	for _, f := range r.Findings {
		if f.Kind == "gap" {
			gaps++
			if f.Inputs["amount"] != json.Number("100") {
				t.Fatal(f)
			}
		}
		if f.Kind == "uncovered" {
			uncovered++
			if !strings.Contains(f.Message, "candidate") {
				t.Fatal(f)
			}
			v, e := Evaluate(m, "discount", f.Inputs)
			if e != nil || len(v.Rules) != 1 || v.Rules[0] != "r2" {
				t.Fatal(v, e)
			}
		}
	}
	if gaps != 1 || uncovered != 1 {
		t.Fatal(r)
	}
}
func TestHitPolicies(t *testing.T) {
	for _, tc := range []struct {
		policy              string
		outputs             []string
		conflicts, shadowed int
		evalError           bool
		rules               int
	}{
		{"UNIQUE", []string{"1", "1"}, 1, 0, true, 0},
		{"ANY", []string{"1", "1.0"}, 0, 0, false, 2},
		{"ANY", []string{"1", "2"}, 1, 0, true, 0},
		{"FIRST", []string{"1", "2"}, 0, 1, false, 1},
		{"COLLECT", []string{"1", "2"}, 0, 0, false, 2},
	} {
		t.Run(tc.policy+strings.Join(tc.outputs, ","), func(t *testing.T) {
			m := parse(t, modelXML(tc.policy, "[0..1]", []string{"-", "-"}, tc.outputs))
			r := run(t, m, nil)
			conf, shadow := 0, 0
			for _, f := range r.Findings {
				if f.Kind == "conflict" {
					conf++
				}
				if f.Kind == "shadowed" {
					shadow++
				}
			}
			if (conf > 0) != (tc.conflicts > 0) || shadow != tc.shadowed {
				t.Fatal(r)
			}
			out, e := Evaluate(m, "discount", map[string]any{"amount": 0})
			expectedOutputs := tc.rules
			if tc.policy == "ANY" && !tc.evalError {
				expectedOutputs = 1
			}
			if (e != nil) != tc.evalError || len(out.Rules) != tc.rules || len(out.Outputs) != expectedOutputs {
				t.Fatal(out, e)
			}
			if tc.policy == "FIRST" {
				// FIRST selects the first matching rule, and the later rule it
				// fully covers is the one reported as shadowed.
				if out.Rules[0] != "r1" {
					t.Fatalf("FIRST selected %v, want r1", out.Rules)
				}
				for _, f := range r.Findings {
					if f.Kind == "shadowed" && (len(f.Rules) != 1 || f.Rules[0] != "r2") {
						t.Fatalf("shadowed finding names %v, want [r2]", f.Rules)
					}
				}
			}
			if tc.policy == "COLLECT" {
				if strings.Join(out.Rules, ",") != "r1,r2" || fmt.Sprint(out.Outputs) != "[[1] [2]]" {
					t.Fatalf("COLLECT returned rules %v outputs %v, want both rules and their outputs", out.Rules, out.Outputs)
				}
			}
		})
	}
}
func TestUnsupportedNeverPasses(t *testing.T) {
	base := modelXML("UNIQUE", "[0..1]", []string{"-"}, []string{"1"})
	for name, xml := range map[string]string{
		"missing-domain": strings.Replace(base, "[0..1]", "", 1),
		"formula":        strings.Replace(base, "<text>-</text>", "<text>someFunction(amount)</text>", 1),
		"priority":       strings.Replace(base, "UNIQUE", "PRIORITY", 1),
		"dependency":     strings.Replace(base, "<decisionTable", `<informationRequirement><requiredDecision href="#other"/></informationRequirement><decisionTable`, 1),
		"default":        strings.Replace(base, `<output name="discount" typeRef="number"/>`, `<output name="discount" typeRef="number"><defaultOutputEntry><text>0</text></defaultOutputEntry></output>`, 1),
		"language":       strings.Replace(base, "<decisionTable", `<decisionTable expressionLanguage="javascript"`, 1),
		"extension":      strings.Replace(base, "<decisionTable", `<extensionElements/><decisionTable`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			r := run(t, parse(t, xml), nil)
			if r.Status != "not-analyzed" || len(r.Reasons) == 0 || r.Cells != 0 {
				t.Fatal(r)
			}
		})
	}
}
func TestExactDecimalBoundary(t *testing.T) {
	m := parse(t, modelXML("UNIQUE", "[0..0.00000000000000000002]", []string{"&lt; 0.00000000000000000001", "&gt; 0.00000000000000000001"}, []string{"1", "2"}))
	r := run(t, m, nil)
	for _, f := range r.Findings {
		if f.Kind == "gap" {
			if f.Inputs["amount"] != json.Number("0.00000000000000000001") {
				t.Fatal(f)
			}
			return
		}
	}
	t.Fatal("gap missing")
}
func TestInvalidInputsAndModels(t *testing.T) {
	m := parse(t, modelXML("UNIQUE", "[0..1]", []string{"-"}, []string{"1"}))
	for _, inputs := range []map[string]any{{}, {"amount": nil}, {"amount": "0"}, {"amount": 2}, {"amount": 0, "extra": 1}} {
		if _, e := Evaluate(m, "discount", inputs); e == nil {
			t.Fatal(inputs)
		}
	}
	for _, xml := range []string{"<x/>", "<!DOCTYPE x><x/>", strings.Repeat("x", MaxXML+1), modelXML("UNIQUE", "-", nil, nil) + "<x/>"} {
		if _, e := Parse(xml); e == nil {
			t.Fatal("accepted invalid XML")
		}
	}
	r := run(t, m, []Case{{ID: "bad", Inputs: map[string]any{"amount": "0"}}})
	if r.Cases[0].Error == "" || len(r.Uncovered) != 1 {
		t.Fatal(r)
	}
}
func TestBooleanStringCombinations(t *testing.T) {
	xml := `<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/"><decision id="discount"><decisionTable><input><inputExpression typeRef="boolean"><text>member</text></inputExpression><inputValues><text>-</text></inputValues></input><input><inputExpression typeRef="string"><text>country</text></inputExpression><inputValues><text>"DE", "FR"</text></inputValues></input><output name="ok"/><rule id="r1"><inputEntry><text>true</text></inputEntry><inputEntry><text>-</text></inputEntry><outputEntry><text>true</text></outputEntry></rule><rule id="r2"><inputEntry><text>false</text></inputEntry><inputEntry><text>"DE"</text></inputEntry><outputEntry><text>false</text></outputEntry></rule></decisionTable></decision></definitions>`
	r := run(t, parse(t, xml), nil)
	if r.Cells != 4 {
		t.Fatal(r)
	}
	for _, f := range r.Findings {
		if f.Kind == "gap" {
			if f.Inputs["member"] != false || f.Inputs["country"] != "FR" {
				t.Fatal(f)
			}
			return
		}
	}
	t.Fatal("missing combination")
}
func TestBudget(t *testing.T) {
	xml := modelXML("UNIQUE", "[0..2]", []string{"1"}, []string{"1"})
	start := strings.Index(xml, "<input>")
	end := strings.Index(xml, "</input>") + len("</input>")
	input := xml[start:end]
	many := ""
	for i := 0; i < 12; i++ {
		many += strings.Replace(input, "amount", fmt.Sprintf("a%d", i), 1)
	}
	xml = xml[:start] + many + xml[end:]
	xml = strings.Replace(xml, "<inputEntry><text>1</text></inputEntry>", strings.Repeat("<inputEntry><text>1</text></inputEntry>", 12), 1)
	r := run(t, parse(t, xml), nil)
	if r.Status != "not-analyzed" || r.Cells != 0 {
		t.Fatal(r)
	}
	// The reason is the budget itself, not any other cause of not-analyzed.
	if len(r.Reasons) != 1 || r.Reasons[0] != fmt.Sprintf("partition exceeds %d cells", MaxCells) {
		t.Fatalf("reasons %q, want the partition budget of %d cells", r.Reasons, MaxCells)
	}
}
