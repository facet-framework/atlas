// Package engine analyzes a deliberately bounded DMN decision-table subset.
// @facet: customization/documents/dmn-analysis
// @facet-role: primary
package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

const MaxXML = 2 << 20

type Model struct {
	Hash      string     `json:"sha256"`
	Decisions []Decision `json:"decisions"`
}
type Decision struct {
	ID           string     `xml:"id,attr" json:"id"`
	Name         string     `xml:"name,attr" json:"name"`
	Table        *Table     `xml:"decisionTable" json:"table,omitempty"`
	Requirements []struct{} `xml:"informationRequirement" json:"-"`
	Knowledge    []struct{} `xml:"knowledgeRequirement" json:"-"`
	Unsupported  []string   `json:"unsupported"`
}
type Table struct {
	ID          string   `xml:"id,attr" json:"id"`
	Policy      string   `xml:"hitPolicy,attr" json:"hit_policy"`
	Aggregation string   `xml:"aggregation,attr" json:"-"`
	Inputs      []Input  `xml:"input" json:"inputs"`
	Outputs     []Output `xml:"output" json:"outputs"`
	Rules       []Rule   `xml:"rule" json:"rules"`
}
type Input struct {
	Label      string `xml:"label,attr" json:"label"`
	Expression struct {
		Text string `xml:"text" json:"text"`
		Type string `xml:"typeRef,attr" json:"type"`
	} `xml:"inputExpression" json:"expression"`
	Values Text `xml:"inputValues" json:"values"`
}
type Output struct {
	Name    string `xml:"name,attr" json:"name"`
	Type    string `xml:"typeRef,attr" json:"type"`
	Default *Text  `xml:"defaultOutputEntry" json:"default,omitempty"`
}
type Text struct {
	Text string `xml:"text" json:"text"`
}
type Rule struct {
	ID      string `xml:"id,attr" json:"id"`
	Inputs  []Text `xml:"inputEntry" json:"inputs"`
	Outputs []Text `xml:"outputEntry" json:"outputs"`
}

func Parse(data string) (Model, error) {
	var m Model
	if len(data) > MaxXML {
		return m, fmt.Errorf("model exceeds %d bytes", MaxXML)
	}
	// Reject directives and foreign semantic elements rather than silently dropping them.
	dec := xml.NewDecoder(strings.NewReader(data))
	unsupported := []string{}
	mark := func(reason string) {
		for _, old := range unsupported {
			if old == reason {
				return
			}
		}
		if len(unsupported) < 20 {
			unsupported = append(unsupported, reason)
		}
	}
	depth := 0
	roots := 0
	rootNS := ""
	tableCounts := []int{}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return m, err
		}
		switch t := tok.(type) {
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(t)) != "" {
				return m, fmt.Errorf("text outside definitions")
			}
		case xml.Directive:
			return m, fmt.Errorf("XML directives are unsupported")
		case xml.StartElement:
			if supportedNS(t.Name.Space) {
				if rootNS != "" && rootNS != t.Name.Space {
					return m, fmt.Errorf("mixed DMN namespaces")
				}
				allowed := " definitions decision variable inputData informationRequirement requiredInput requiredDecision knowledgeRequirement requiredKnowledge authorityRequirement requiredAuthority knowledgeSource decisionTable input inputExpression inputValues output outputValues rule inputEntry outputEntry text description annotation annotationEntry "
				if !strings.Contains(allowed, " "+t.Name.Local+" ") {
					mark("unsupported DMN element: " + t.Name.Local)
				}
				for _, a := range t.Attr {
					if a.Name.Local == "expressionLanguage" || a.Name.Local == "typeLanguage" {
						mark("explicit expression/type language is not supported")
					}
				}
			} else if strings.HasSuffix(t.Name.Space, "/MODEL/") {
				return m, fmt.Errorf("mixed DMN namespaces")
			} else if !diagramElement(t.Name) {
				mark("unsupported XML namespace: " + t.Name.Space)
			}
			if depth == 0 {
				roots++
				rootNS = t.Name.Space
				if t.Name.Local != "definitions" || !supportedNS(t.Name.Space) {
					return m, fmt.Errorf("expected DMN 1.3, 1.4 or 1.5 definitions")
				}
			}
			if t.Name.Local == "decision" {
				tableCounts = append(tableCounts, 0)
				if len(tableCounts) > 128 {
					return m, fmt.Errorf("at most 128 decisions")
				}
			}
			if t.Name.Local == "decisionTable" && len(tableCounts) > 0 {
				tableCounts[len(tableCounts)-1]++
				if tableCounts[len(tableCounts)-1] > 1 {
					return m, fmt.Errorf("multiple tables in one decision")
				}
			}
			depth++
			if depth > 64 {
				return m, fmt.Errorf("XML nesting exceeds 64 levels")
			}
		case xml.EndElement:
			depth--
		}
	}
	if roots != 1 {
		return m, fmt.Errorf("expected one definitions element")
	}
	var raw struct {
		Decisions []Decision `xml:"decision"`
		Imports   []struct{} `xml:"import"`
		Types     []struct{} `xml:"itemDefinition"`
	}
	if err := xml.Unmarshal([]byte(data), &raw); err != nil {
		return m, err
	}
	sum := sha256.Sum256([]byte(data))
	m.Hash = hex.EncodeToString(sum[:])
	m.Decisions = raw.Decisions
	if m.Decisions == nil {
		m.Decisions = []Decision{}
	}
	seen := map[string]bool{}
	for i := range m.Decisions {
		d := &m.Decisions[i]
		d.Unsupported = append(d.Unsupported, unsupported...)
		if d.ID == "" || seen[d.ID] {
			return m, fmt.Errorf("missing or duplicate decision id %q", d.ID)
		}
		seen[d.ID] = true
		if d.Table == nil {
			d.Unsupported = append(d.Unsupported, "only decision tables are analyzed")
			continue
		}
		if len(raw.Imports) > 0 || len(raw.Types) > 0 || len(d.Requirements) > 0 || len(d.Knowledge) > 0 {
			d.Unsupported = append(d.Unsupported, "imports, item definitions and decision dependencies are not analyzed")
		}
		if d.Table.Inputs == nil {
			d.Table.Inputs = []Input{}
		}
		if d.Table.Outputs == nil {
			d.Table.Outputs = []Output{}
		}
		if d.Table.Rules == nil {
			d.Table.Rules = []Rule{}
		}
		for j := range d.Table.Rules {
			r := &d.Table.Rules[j]
			if r.Inputs == nil {
				r.Inputs = []Text{}
			}
			if r.Outputs == nil {
				r.Outputs = []Text{}
			}
		}
		if d.Table.Policy == "" {
			d.Table.Policy = "UNIQUE"
		}
	}
	return m, nil
}
func supportedNS(s string) bool {
	return s == "https://www.omg.org/spec/DMN/20191111/MODEL/" || s == "https://www.omg.org/spec/DMN/20211108/MODEL/" || s == "https://www.omg.org/spec/DMN/20230324/MODEL/"
}
func (m Model) Decision(id string) (Decision, error) {
	for _, d := range m.Decisions {
		if d.ID == id {
			return d, nil
		}
	}
	return Decision{}, fmt.Errorf("decision %q does not exist", id)
}

// Diagram interchange is presentation only; similarly named foreign rule elements
// must not be decoded as decision logic by encoding/xml's local-name matching.
func diagramElement(n xml.Name) bool {
	ns := n.Space == "https://www.omg.org/spec/DMN/20191111/DMNDI/" || n.Space == "https://www.omg.org/spec/DMN/20230324/DMNDI/" || n.Space == "https://www.omg.org/spec/DMN/20180521/DC/" || n.Space == "https://www.omg.org/spec/DMN/20180521/DI/"
	return ns && strings.Contains(" DMNDI DMNDiagram DMNShape DMNEdge DMNLabel DMNStyle DMNLabelStyle Bounds Point Size waypoint fillColor strokeColor fontColor ", " "+n.Local+" ")
}
