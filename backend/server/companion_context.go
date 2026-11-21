package server

// What the reader has open while asking, and the conversation mode, as the
// agent is told them.

import (
	"fmt"
	"regexp"
	"strings"
)

// maxCompanionContext bounds how many entries one question may carry. The
// reader sends one chip; the bound only keeps a crafted request from turning
// the system prompt into a list.
const maxCompanionContext = 4

// contextIDRe is the shape of a record, domain or capability id: lowercase
// segments joined by slashes.
var contextIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,79}(/[a-z0-9][a-z0-9._-]{0,79}){0,3}$`)

// pluginIDRe is the shape of a plugin id in a page key.
var pluginIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// atlasPages describes each Atlas page an agent may be asked about from. The
// sentences say what the reader sees there, in the vocabulary of the FACET
// spec, so "what is this" and "what does that word mean here" have something
// to start from.
var atlasPages = map[string]string{
	"overview":            "the Atlas overview: the registry's state at a glance — how many features there are, how many of their promises are proven, how much drift there is, and what needs attention first",
	"product":             "the Atlas product map: every domain of the taxonomy drawn as a block of its capabilities and features, sized by how many records it holds",
	"records":             "the Atlas record list: every record of the registry with its kind, lifecycle, anchors and proven promises",
	"contents":            "the Atlas contents hub: one card per content kind of the records (promises, knowledge, operations, origin, taxonomy, calibration, tests, deviations, drift, fixed defects, anchors, files, rules)",
	"contents/promises":   "the Atlas promises page: every contract scenario of every record, and whether a test names it in `proves:`",
	"contents/knowledge":  "the Atlas knowledge page: the five knowledge slots of each record and which of them still have no owner-supplied answer",
	"contents/operations": "the Atlas operations page: the records' observation blocks — SLOs, alerts, dashboards and continuous checks",
	"contents/provenance": "the Atlas origin page: the records' lineage — owner team, creation date, dependencies and successors",
	"contents/taxonomy":   "the Atlas taxonomy page: the domains and capabilities of docs/facets/taxonomy.yaml and how many records each holds",
	"contents/calibration": "the Atlas calibration page (the specification): the registry's shape measured as metrics — scenarios per record, records per capability, capabilities per domain. " +
		"Each metric has a band, the range its values are expected to lie in; the page shows each metric's median against its band, and every value outside its band is an outlier, listed with where it is and its distance to the band. Calibration reports and never gates",
	"contents/tests":      "the Atlas tests page: the tests the records name under verification, and which promises each one claims to prove",
	"contents/deviations": "the Atlas deviations page: places where a record and the code disagree",
	"contents/drift":      "the Atlas drift page: code that changed without its record following, and records whose anchored code moved",
	"contents/fixed":      "the Atlas fixed-defects page: each record's defects ledger, the bugfix commits that landed in its anchored code",
	"contents/anchors":    "the Atlas anchors page: every `@facet:` anchor in the source and the record it points to",
	"contents/files":      "the Atlas files page: the source files that carry anchors, and how many records each one serves",
	"contents/rules":      "the Atlas rules page: the policy records and the business rules that bind several features",
	"glossary":            "the Atlas glossary: the project's terms and their definitions",
	"settings":            "the Atlas settings",
}

// describeCompanionContext turns the entries the reader sent into the lines
// the agent is told, or says which entry it refused.
func describeCompanionContext(entries []string) ([]string, error) {
	if len(entries) > maxCompanionContext {
		return nil, fmt.Errorf("too many context entries: %d", len(entries))
	}
	lines := make([]string, 0, len(entries))
	for _, entry := range entries {
		kind, value, ok := strings.Cut(entry, ":")
		if !ok {
			return nil, fmt.Errorf("unknown context %q", entry)
		}
		switch kind {
		case "record", "domain", "capability":
			if !contextIDRe.MatchString(value) {
				return nil, fmt.Errorf("unknown context %q", entry)
			}
			lines = append(lines, fmt.Sprintf("the %s `%s`", kind, value))
		case "page":
			if page, ok := atlasPages[value]; ok {
				lines = append(lines, page)
				continue
			}
			if plugin, ok := strings.CutPrefix(value, "plugin/"); ok && pluginIDRe.MatchString(plugin) {
				lines = append(lines, fmt.Sprintf("the Atlas page of the `%s` plugin", plugin))
				continue
			}
			return nil, fmt.Errorf("unknown context %q", entry)
		default:
			return nil, fmt.Errorf("unknown context %q", entry)
		}
	}
	return lines, nil
}

// companionModes are the conversation modes the reader can choose, by the
// value the browser sends, with what the agent is told about each. The plain
// question has no entry: it is the profile as written.
var companionModes = map[string]string{}

// readerContextPrompt is the part of the system prompt that says what the
// reader has open and which mode they chose. Empty when there is neither.
func readerContextPrompt(lines []string, mode string) string {
	var out strings.Builder
	if len(lines) > 0 {
		out.WriteString("## What the reader has open\n\n")
		out.WriteString("The reader is asking from Atlas with this on screen. \"This\", \"here\" and \"what I see\" refer to it:\n\n")
		for _, line := range lines {
			fmt.Fprintf(&out, "- %s\n", line)
		}
		out.WriteString("\nOpen what it names before answering a question about it.\n")
	}
	if text := companionModes[mode]; text != "" {
		if out.Len() > 0 {
			out.WriteString("\n")
		}
		out.WriteString(text)
	}
	return out.String()
}
