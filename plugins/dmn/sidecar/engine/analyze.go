package engine

import (
	"encoding/json"
	"fmt"
)

const MaxCells = 50000
const MaxFindings = 500
const Version = "0.1.0-rc.1"

type Case struct {
	ID     string         `json:"id"`
	Inputs map[string]any `json:"inputs"`
}
type Finding struct {
	Kind    string         `json:"kind"`
	Inputs  map[string]any `json:"inputs,omitempty"`
	Rules   []string       `json:"rules,omitempty"`
	Message string         `json:"message"`
}
type CaseResult struct {
	ID    string   `json:"id"`
	Rules []string `json:"rules"`
	Error string   `json:"error,omitempty"`
}
type Report struct {
	SHA256       string       `json:"sha256"`
	Engine       string       `json:"engine"`
	Decision     string       `json:"decision"`
	Status       string       `json:"status"`
	Reasons      []string     `json:"reasons"`
	Cells        int          `json:"cells"`
	Findings     []Finding    `json:"findings"`
	FindingCount int          `json:"finding_count"`
	Truncated    bool         `json:"truncated"`
	Cases        []CaseResult `json:"cases"`
	Uncovered    []string     `json:"uncovered_rules"`
}
type compiled struct {
	work    int
	table   *Table
	domains []predicate
	cells   [][]value
	rules   [][]predicate
	outputs [][]any
}

func compile(d Decision) (compiled, error) {
	c := compiled{table: d.Table}
	if len(d.Unsupported) > 0 {
		return c, fmt.Errorf("%s", d.Unsupported)
	}
	if c.table == nil {
		return c, fmt.Errorf("decision has no table")
	}
	t := c.table
	if t.Policy != "UNIQUE" && t.Policy != "ANY" && t.Policy != "FIRST" && t.Policy != "COLLECT" {
		return c, fmt.Errorf("unsupported hit policy %s", t.Policy)
	}
	if t.Aggregation != "" {
		return c, fmt.Errorf("COLLECT aggregation is not supported")
	}
	if len(t.Inputs) == 0 || len(t.Inputs) > 12 || len(t.Rules) == 0 || len(t.Rules) > 1000 || len(t.Outputs) == 0 {
		return c, fmt.Errorf("table limits: 1–12 inputs, 1–1000 rules, at least one output")
	}
	names := map[string]bool{}
	for _, o := range t.Outputs {
		if o.Default != nil {
			return c, fmt.Errorf("default outputs are not supported")
		}
		if names[o.Name] {
			return c, fmt.Errorf("duplicate output name")
		}
		names[o.Name] = true
	}
	ids := map[string]bool{}
	for _, r := range t.Rules {
		if r.ID == "" || ids[r.ID] {
			return c, fmt.Errorf("missing or duplicate rule id")
		}
		ids[r.ID] = true
		if len(r.Inputs) != len(t.Inputs) || len(r.Outputs) != len(t.Outputs) {
			return c, fmt.Errorf("rule %s has incorrect arity", r.ID)
		}
		var row []predicate
		for i, in := range r.Inputs {
			p, e := unary(in.Text, t.Inputs[i].Expression.Type)
			if e != nil {
				return c, fmt.Errorf("rule %s: %w", r.ID, e)
			}
			row = append(row, p)
			c.work += max(1, len(p.bounds))
		}
		c.rules = append(c.rules, row)
		var outputs []any
		for i, o := range r.Outputs {
			v, e := literal(o.Text)
			if e != nil {
				return c, e
			}
			if t.Outputs[i].Type != "" && !compatible(v, t.Outputs[i].Type) {
				return c, fmt.Errorf("output type mismatch")
			}
			if v.num != nil {
				v = number(v.num)
			}
			outputs = append(outputs, v.raw)
		}
		c.outputs = append(c.outputs, outputs)
	}
	names = map[string]bool{}
	for i, in := range t.Inputs {
		name := in.Expression.Text
		if !variable.MatchString(name) || names[name] {
			return c, fmt.Errorf("inputs must have distinct simple variable names")
		}
		names[name] = true
		if in.Values.Text == "" {
			return c, fmt.Errorf("input %s has no explicit domain", name)
		}
		p, e := unary(in.Values.Text, in.Expression.Type)
		if e != nil {
			return c, e
		}
		c.domains = append(c.domains, p)
		bounds := append([]value{}, p.bounds...)
		for _, r := range c.rules {
			bounds = append(bounds, r[i].bounds...)
		}
		vs, e := representatives(in.Expression.Type, p, bounds)
		if e != nil {
			return c, e
		}
		c.cells = append(c.cells, vs)
	}
	return c, nil
}
func (c compiled) hits(vs []value) []int {
	hits := []int{}
	for i, r := range c.rules {
		ok := true
		for j, p := range r {
			if !p.match(vs[j]) {
				ok = false
				break
			}
		}
		if ok {
			hits = append(hits, i)
		}
	}
	return hits
}
func (c compiled) selected(hits []int) []int {
	if c.table.Policy == "FIRST" && len(hits) > 1 {
		return hits[:1]
	}
	return hits
}
func (c compiled) ids(hits []int) []string {
	out := []string{}
	for _, i := range hits {
		out = append(out, c.table.Rules[i].ID)
	}
	return out
}
func (c compiled) inputs(vs []value) map[string]any {
	out := map[string]any{}
	for i, v := range vs {
		out[c.table.Inputs[i].Expression.Text] = v.raw
	}
	return out
}
func (c compiled) values(inputs map[string]any) ([]value, error) {
	if len(inputs) != len(c.table.Inputs) {
		return nil, fmt.Errorf("provide exactly the declared inputs")
	}
	var vs []value
	for i, in := range c.table.Inputs {
		raw, ok := inputs[in.Expression.Text]
		if !ok {
			return nil, fmt.Errorf("missing input %s", in.Expression.Text)
		}
		b, e := json.Marshal(raw)
		if e != nil {
			return nil, e
		}
		v, e := literal(string(b))
		if e != nil {
			return nil, e
		}
		if !c.domains[i].match(v) {
			return nil, fmt.Errorf("input %s is outside its domain", in.Expression.Text)
		}
		vs = append(vs, v)
	}
	return vs, nil
}
func (c compiled) conflict(h []int) bool {
	if len(h) < 2 {
		return false
	}
	if c.table.Policy == "UNIQUE" {
		return true
	}
	if c.table.Policy != "ANY" {
		return false
	}
	a, _ := json.Marshal(c.outputs[h[0]])
	for _, i := range h[1:] {
		b, _ := json.Marshal(c.outputs[i])
		if string(a) != string(b) {
			return true
		}
	}
	return false
}
func Analyze(m Model, id string, cases []Case) (Report, error) {
	r := Report{SHA256: m.Hash, Engine: Version, Decision: id, Status: "not-analyzed", Reasons: []string{}, Findings: []Finding{}, Cases: []CaseResult{}, Uncovered: []string{}}
	d, e := m.Decision(id)
	if e != nil {
		return r, e
	}
	c, e := compile(d)
	if e != nil {
		r.Reasons = append(r.Reasons, e.Error())
		return r, nil
	}
	total := 1
	for _, vs := range c.cells {
		if len(vs) > MaxCells/total {
			r.Reasons = append(r.Reasons, "partition exceeds 50000 cells")
			return r, nil
		}
		total *= len(vs)
	}
	// Work is bounded as well as the number of resulting cells.
	if c.work > 5000000/total {
		r.Reasons = append(r.Reasons, "analysis exceeds 5000000 predicate evaluations")
		return r, nil
	}
	r.Status = "analyzed"
	reachable := make([]bool, len(c.rules))
	matched := make([]bool, len(c.rules))
	covered := make([]bool, len(c.rules))
	witnesses := make([]map[string]any, len(c.rules))
	add := func(f Finding) {
		r.FindingCount++
		if len(r.Findings) < MaxFindings {
			r.Findings = append(r.Findings, f)
		} else {
			r.Truncated = true
		}
	}
	var walk func([]value, int)
	walk = func(vs []value, n int) {
		if n < len(c.cells) {
			for _, v := range c.cells[n] {
				walk(append(vs, v), n+1)
			}
			return
		}
		r.Cells++
		h := c.hits(vs)
		if len(h) == 0 {
			add(Finding{Kind: "gap", Inputs: c.inputs(vs), Message: "No rule matches this input cell; expected output requires a business decision."})
		}
		if c.conflict(h) {
			add(Finding{Kind: "conflict", Inputs: c.inputs(vs), Rules: c.ids(h), Message: "Matches violate the hit policy."})
		}
		for _, i := range h {
			matched[i] = true
		}
		for _, i := range c.selected(h) {
			reachable[i] = true
			if witnesses[i] == nil {
				witnesses[i] = c.inputs(vs)
			}
		}
	}
	walk(nil, 0)
	for i, rul := range c.table.Rules {
		if !reachable[i] {
			kind := "unreachable"
			if matched[i] {
				kind = "shadowed"
			}
			add(Finding{Kind: kind, Rules: []string{rul.ID}, Message: "This rule cannot contribute an output in the declared domain."})
		}
	}
	if len(cases) > 10000 {
		return r, fmt.Errorf("at most 10000 cases")
	}
	for _, cs := range cases {
		cr := CaseResult{ID: cs.ID, Rules: []string{}}
		vs, e := c.values(cs.Inputs)
		if e != nil {
			cr.Error = e.Error()
		} else {
			h := c.hits(vs)
			cr.Rules = c.ids(c.selected(h))
			if c.conflict(h) {
				cr.Error = "hit policy conflict"
			} else {
				for _, i := range c.selected(h) {
					covered[i] = true
				}
			}
		}
		r.Cases = append(r.Cases, cr)
	}
	for i, rule := range c.table.Rules {
		if reachable[i] && !covered[i] {
			r.Uncovered = append(r.Uncovered, rule.ID)
			add(Finding{Kind: "uncovered", Rules: []string{rule.ID}, Inputs: witnesses[i], Message: "No supplied scenario covers this reachable rule; candidate only, not a test proof."})
		}
	}
	return r, nil
}

type Evaluation struct {
	SHA256   string   `json:"sha256"`
	Decision string   `json:"decision"`
	Rules    []string `json:"rules"`
	Outputs  [][]any  `json:"outputs"`
}

func Evaluate(m Model, id string, inputs map[string]any) (Evaluation, error) {
	out := Evaluation{SHA256: m.Hash, Decision: id, Rules: []string{}, Outputs: [][]any{}}
	d, e := m.Decision(id)
	if e != nil {
		return out, e
	}
	c, e := compile(d)
	if e != nil {
		return out, e
	}
	vs, e := c.values(inputs)
	if e != nil {
		return out, e
	}
	h := c.hits(vs)
	if c.conflict(h) {
		return out, fmt.Errorf("hit policy conflict: %v", c.ids(h))
	}
	h = c.selected(h)
	out.Rules = c.ids(h)
	if c.table.Policy == "ANY" && len(h) > 1 {
		h = h[:1]
	}
	for _, i := range h {
		out.Outputs = append(out.Outputs, c.outputs[i])
	}
	return out, nil
}
