package wiki

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/facet-framework/core/registry"
)

// WikiCheckOptions selects how strictly a wiki is judged.
type WikiCheckOptions struct {
	// Strict promotes every warning to an error.
	//
	// Whether a dead link should block a merge is a decision about how a
	// project wants to work, and it is one the project makes once here rather
	// than one the framework makes for everybody — the same place the specification puts
	// the same decision for records.
	Strict bool
	// KnownIDs holds every record id the repository has, across registries. Nil
	// makes the check work it out from the registry it is given, which is what
	// a single call outside a multi-registry project needs.
	KnownIDs map[string]bool
}

// WikiReport collects what a wiki check found.
type WikiReport struct {
	Findings []facet.Finding `json:"findings"`
	// Present reports whether the project has a wiki at all. False is not the
	// same as a wiki with no pages, and the two must not be shown alike.
	Present bool `json:"present"`
	Checked struct {
		Pages int `json:"pages"`
		Areas int `json:"areas"`
	} `json:"checked"`
}

// Failed reports whether anything blocking was found.
func (r WikiReport) Failed() bool {
	for _, f := range r.Findings {
		if f.Severity == facet.SeverityError {
			return true
		}
	}
	return false
}

func (r *WikiReport) add(f facet.Finding) { r.Findings = append(r.Findings, f) }

// wikiSegmentRe is the grammar every path segment follows.
//
// The same grammar record ids, registry names and taxonomy nodes follow — not
// because a slug needs it, but so that an address is recognisable as a FACET
// address wherever it appears in the project.
var wikiSegmentRe = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// WikiEmbeddableComponents is the specification's allowlist: the components the corpus can
// fill the inputs of.
//
// The rule that produced the list is the useful part, because the list grows by
// it: a component is embeddable exactly when its inputs come from the corpus.
// What that excludes is excluded by a rule rather than by effort — a component
// taking a free scalar would let a page invent a number, and a control that
// rearranged the surrounding view from inside a paragraph has no defined
// behaviour.
var WikiEmbeddableComponents = []string{
	"AnchorMap",
	"CoverageRing",
	"DependencyFan",
	"EntryCards",
	"EvidenceLedger",
	"GherkinStatement",
	"GroupTiles",
	"KnowledgeSlots",
	"LifecycleBadge",
	"ProofMatrix",
	"RecordSource",
	"ScenarioLedger",
	"Seal",
	"TestPyramid",
	"Timeline",
	"Trail",
}

// wikiValueKeys are the keys that would put a number nobody measured inside a
// component that looks measured.
//
// This is the narrow, checkable half of the specification. The broad half — a percentage
// typed into prose — is not enforceable and is not pretended to be; see
// lintWikiEmbeds for what is done about it instead.
var wikiValueKeys = []string{"value", "number", "percent", "share", "ratio", "count", "scenarios", "data"}

// CanonicalWikiEmbedKey accepts a stored field without changing English names.
func CanonicalWikiEmbedKey(key string) string {
	if current, ok := LegacyWikiEmbedKeys[key]; ok {
		return current
	}
	return key
}

// CheckWiki runs a project's wiki checks.
//
// Two errors and a list of warnings, and the split is the specification. A page
// with no title and a record id naming nothing each have exactly one correct
// answer; everything else is a judgement about maintenance, and a build that
// makes it on a project's behalf is a build people route around.
func CheckWiki(reg facet.Registry, opts WikiCheckOptions) (WikiReport, error) {
	var rep WikiReport

	wiki, err := LoadWiki(WikiDir(reg))
	if err != nil {
		return rep, err
	}
	rep.Present = wiki.Present
	if !wiki.Present {
		// A project that has not written a wiki has not failed to write one.
		rep.Findings = []facet.Finding{}
		return rep, nil
	}

	if wiki.ConfigErr != nil {
		rep.add(facet.Finding{
			Severity: facet.SeverityError,
			Check:    "wiki-config",
			Path:     reg.Rel(WikiConfigPath(reg)),
			Message:  fmt.Sprintf("%s could not be read: %v", WikiConfigName, wiki.ConfigErr),
			Hint:     "fix the YAML — every page beside it was still checked",
		})
	}

	known := opts.KnownIDs
	if known == nil {
		known = knownIDs([]facet.Registry{reg})
	}
	addresses := map[string]bool{}
	for _, p := range wiki.Pages {
		addresses[p.Address()] = true
	}

	rep.Checked.Pages = len(wiki.Pages)
	rep.Checked.Areas = len(wiki.Areas())

	for _, page := range wiki.Pages {
		path := reg.Rel(WikiDir(reg)) + "/" + page.Path
		lintWikiFront(&rep, wiki, page, path, known)
		lintWikiPath(&rep, wiki, page, path)
		lintWikiLinks(&rep, page, path, known, addresses)
		lintWikiEmbeds(&rep, page, path, known)
	}
	lintWikiAreas(reg, &rep, wiki)

	if opts.Strict {
		// Promoted rather than re-judged: the same findings, said louder,
		// because a project asking for strictness is asking about severity and
		// not for a different set of observations.
		for i := range rep.Findings {
			rep.Findings[i].Severity = facet.SeverityError
		}
	}
	if rep.Findings == nil {
		rep.Findings = []facet.Finding{}
	}
	return rep, nil
}

// lintWikiFront judges what a page declares about itself.
func lintWikiFront(rep *WikiReport, wiki *Wiki, page WikiPage, path string, known map[string]bool) {
	if page.FrontErr != nil {
		rep.add(facet.Finding{
			Severity: facet.SeverityError,
			Check:    "wiki-front",
			Path:     path,
			Message:  fmt.Sprintf("the page header could not be read: %v", page.FrontErr),
			Hint:     "fix the YAML between the leading --- fences",
		})
		return
	}

	// The first error. A file name is a slug and a slug is not a heading;
	// deriving one from the body's first '# ' would give the project two
	// answers to what a page is called, free to disagree the moment somebody
	// edits one of them.
	if strings.TrimSpace(page.Front.Title) == "" {
		rep.add(facet.Finding{
			Severity: facet.SeverityError,
			Check:    "wiki-title",
			Path:     path,
			Message:  "page declares no title",
			Hint:     "add 'title:' to the header — the file name is a slug, and a heading in the body is prose rather than a declaration",
		})
	}

	// The second error, and the one with the same argument as an anchor
	// pointing at no record: an id that names nothing is cheap to correct while
	// it is fresh, and expensive once other pages have copied it.
	for _, id := range page.Front.Records {
		id = strings.TrimSpace(id)
		if id == "" || known[id] {
			continue
		}
		if _, bare := facet.SplitID(id); known[bare] {
			continue
		}
		rep.add(facet.Finding{
			Severity: facet.SeverityError,
			Check:    "wiki-records",
			Path:     path,
			Message:  fmt.Sprintf("page names record %q, which no registry of this repository holds", id),
			Hint:     "correct the id, or remove it — the same treatment an @facet: tag naming no record receives",
		})
	}

	if cat := strings.TrimSpace(page.Front.Category); cat != "" && wiki.Config != nil && !wiki.CategoryDeclared(cat) {
		hint := "declare it under 'categories:' in " + WikiConfigName + ", or correct the spelling"
		if declared := wiki.Config.CategoryIDs(); len(declared) > 0 {
			hint += " — declared: " + nameList(declared)
		}
		rep.add(facet.Finding{
			Severity: facet.SeverityWarning,
			Check:    "wiki-category",
			Path:     path,
			Message:  fmt.Sprintf("page declares category %q, which %s does not", cat, WikiConfigName),
			Hint:     hint,
		})
	}
}

// lintWikiPath judges where a page lies.
func lintWikiPath(rep *WikiReport, wiki *Wiki, page WikiPage, path string) {
	if wiki.TooDeep(page.Path) {
		rep.add(facet.Finding{
			Severity: facet.SeverityWarning,
			Check:    "wiki-depth",
			Path:     path,
			Message: fmt.Sprintf("page lies %d folder levels under the wiki, past this wiki's limit of %d",
				page.Depth(), wiki.DepthLimit()),
			Hint: "move it up, or raise 'depth:' in " + WikiConfigName + " if this wiki really is that deep — the page is read and shown either way",
		})
	}

	// A warning rather than a refusal, because the importer exists to produce
	// pages out of systems whose names are sentences, and it rewrites them and
	// says that it did. A check refusing what remains unfixed by the importer
	// would fail the output of the tool that exists to fix it.
	for _, segment := range strings.Split(strings.TrimSuffix(page.Path, WikiPageExt), "/") {
		if wikiSegmentRe.MatchString(segment) {
			continue
		}
		rep.add(facet.Finding{
			Severity: facet.SeverityWarning,
			Check:    "wiki-path",
			Path:     path,
			Message:  fmt.Sprintf("path segment %q is outside the address grammar [a-z][a-z0-9-]*", segment),
			Hint:     "rename the file or folder — a wiki address is read as a FACET address everywhere else in the project",
		})
		break
	}
}

// wikiLinkRe finds the atlas: targets a page points at. Markdown link syntax
// rather than a bare scan, because 'atlas:' inside a code fence is an example
// of the syntax and not a reference — reporting one would make the page that
// documents this feature unwritable.
var wikiLinkRe = regexp.MustCompile(`\]\(atlas:([^)\s]+)\)`)

// lintWikiLinks judges what a page points at.
//
// A dead reference is a warning and never an error, and never silence. Prose
// pointing at a deleted page is a maintenance signal rather than a broken
// repository; hiding it would be worse than either, which is the call
// markdown.ts already makes for markup it does not recognise.
func lintWikiLinks(rep *WikiReport, page WikiPage, path string, known map[string]bool, addresses map[string]bool) {
	body := stripFencedBlocks(page.Body)
	for _, m := range wikiLinkRe.FindAllStringSubmatch(body, -1) {
		target := m[1]
		kind, rest, ok := strings.Cut(target, "/")
		if !ok {
			continue
		}
		var missing bool
		switch kind {
		case "record":
			id := rest
			if i := strings.IndexAny(id, "#?"); i >= 0 {
				id = id[:i]
			}
			_, bare := facet.SplitID(id)
			missing = !known[id] && !known[bare]
		case "promise", localizedAliases.References["promise"]:
			// The record half is checkable here; whether that record declares
			// the scenario after the '#' is not, because this package holds ids
			// rather than parsed contracts at this point. The reader resolves
			// it against the live corpus and draws it dead when it does not —
			// which is the honest split rather than a half-check that would
			// report a live scenario as missing.
			id := rest
			if i := strings.Index(id, "#"); i >= 0 {
				id = id[:i]
			}
			_, bare := facet.SplitID(id)
			missing = !known[id] && !known[bare]
		case "wiki":
			missing = !addresses["wiki:"+strings.TrimSuffix(rest, "/")]
		default:
			// Other targets resolve
			// against material this check does not hold. Saying nothing is the
			// honest answer; the reader resolves them against the live corpus
			// and draws the dead ones as dead.
			continue
		}
		if missing {
			rep.add(facet.Finding{
				Severity: facet.SeverityWarning,
				Check:    "wiki-link",
				Path:     path,
				Message:  fmt.Sprintf("reference to %q resolves to nothing", "atlas:"+target),
				Hint:     "correct it or remove it — the reader draws a dead reference struck through rather than hiding it",
			})
		}
	}
}

// lintWikiEmbeds judges the live views a page embeds.
//
// This is the enforceable half of the specification and it is worth being exact about which
// half that is. An embedding takes a selector over the corpus, so a value typed
// into one is refusable and is refused. A percentage typed into a *paragraph*
// is not: it is prose, and prose is allowed to say anything. The concept names
// that as the feature's weakest point rather than pretending a check closes it,
// and nothing here pretends otherwise.
func lintWikiEmbeds(rep *WikiReport, page WikiPage, path string, known map[string]bool) {
	for _, block := range AtlasBlocks(page.Body) {
		component := ""
		componentIsEnglish := false
		for _, line := range strings.Split(block, "\n") {
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			rawKey := strings.TrimSpace(key)
			key = CanonicalWikiEmbedKey(rawKey)
			value = strings.TrimSpace(value)
			if key == "component" && (rawKey == "component" || !componentIsEnglish) {
				component = value
				componentIsEnglish = rawKey == "component"
			}
			for _, banned := range wikiValueKeys {
				if key != banned {
					continue
				}
				rep.add(facet.Finding{
					Severity: facet.SeverityWarning,
					Check:    "wiki-embed",
					Path:     path,
					Message:  fmt.Sprintf("embedding carries a literal value under %q", key),
					Hint:     "an embedding names a selector over the corpus — record:, promise:, area:, team:, file:, tag: — and never a value, because a typed number inside a measured component is indistinguishable from a measured one",
				})
			}
		}
		if component == "" {
			rep.add(facet.Finding{
				Severity: facet.SeverityWarning,
				Check:    "wiki-embed",
				Path:     path,
				Message:  "embedding names no component",
				Hint:     "add 'component:' — the block is otherwise shown as the fence it is",
			})
			continue
		}
		if !wikiEmbeddable(component) {
			rep.add(facet.Finding{
				Severity: facet.SeverityWarning,
				Check:    "wiki-embed",
				Path:     path,
				Message:  fmt.Sprintf("%q is not an embeddable component", component),
				Hint:     "embeddable: " + nameList(WikiEmbeddableComponents) + " — the rest either take a free value, which would let a page invent a number, or navigate, which has no defined meaning inside a paragraph",
			})
			continue
		}
		if id := atlasBlockRecord(block); id != "" {
			_, bare := facet.SplitID(id)
			if !known[id] && !known[bare] {
				rep.add(facet.Finding{
					Severity: facet.SeverityWarning,
					Check:    "wiki-embed",
					Path:     path,
					Message:  fmt.Sprintf("embedding selects record %q, which no registry of this repository holds", id),
					Hint:     "correct the id — the reader draws such a block dead, with its own YAML visible, rather than leaving a gap",
				})
			}
		}
	}
}

// atlasBlockRecord returns the record id an embedding selects, if it names one.
func atlasBlockRecord(block string) string {
	for _, line := range strings.Split(block, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(key) != "record" {
			continue
		}
		return strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return ""
}

// wikiEmbeddable reports whether a component may be embedded in a page.
func wikiEmbeddable(name string) bool {
	for _, c := range WikiEmbeddableComponents {
		if c == name {
			return true
		}
	}
	return false
}

// lintWikiAreas judges the areas a wiki has against the ones it declares.
//
// Both directions are reported and neither hides anything: a folder nobody
// declared keeps its pages and is named, and a declared area with no page is
// named too. That is the treatment the specification gives an empty taxonomy node and
// a glossary category nothing uses.
func lintWikiAreas(reg facet.Registry, rep *WikiReport, wiki *Wiki) {
	if wiki.Config == nil {
		// Declaring nothing claims nothing. Every folder is undeclared, and
		// saying so once per folder would be a wall of findings about a
		// decision the project has not made.
		return
	}

	withPages := map[string]bool{}
	for _, p := range wiki.Pages {
		if area := p.Area(); area != "" {
			withPages[area] = true
		}
	}

	var undeclared []string
	for area := range withPages {
		if !wiki.AreaDeclared(area) {
			undeclared = append(undeclared, area)
		}
	}
	sort.Strings(undeclared)
	for _, area := range undeclared {
		rep.add(facet.Finding{
			Severity: facet.SeverityWarning,
			Check:    "wiki-area",
			Path:     reg.Rel(WikiDir(reg)) + "/" + area,
			Message:  fmt.Sprintf("folder %q is not a declared area", area),
			Hint:     "declare it under 'areas:' in " + WikiConfigName + " — its pages are shown either way, under the folder's own name",
		})
	}

	for _, area := range wiki.Config.AreaNames() {
		if withPages[area] {
			continue
		}
		rep.add(facet.Finding{
			Severity: facet.SeverityWarning,
			Check:    "wiki-empty-area",
			Path:     reg.Rel(WikiConfigPath(reg)),
			Message:  fmt.Sprintf("area %q is declared but holds no page", area),
			Hint:     "declaring an area before writing its first page is the intended order, so this is never an error — it is here so a half-finished rename is visible",
		})
	}
}

// AtlasBlocks returns the body of each ```atlas fenced block in a page.
//
// A fenced block rather than a shortcode or MDX, and the specification gives three reasons:
// every Markdown reader in the world shows an unknown fence as a code block, so
// the file stays readable in Obsidian, in a diff and in a pull request preview;
// the file stays a .md file, which is what makes the export half of the specification possible
// at all; and YAML is already the language of the header, so it is one syntax
// rather than two.
func AtlasBlocks(body string) []string {
	var out []string
	lines := strings.Split(body, "\n")
	for i := 0; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) != "```atlas" {
			continue
		}
		var block []string
		i++
		for ; i < len(lines); i++ {
			if strings.HasPrefix(strings.TrimSpace(lines[i]), "```") {
				break
			}
			block = append(block, lines[i])
		}
		out = append(out, strings.Join(block, "\n"))
	}
	return out
}

// stripFencedBlocks blanks every fenced code block, keeping the line count.
//
// A link written inside a fence is an example of the syntax rather than a
// reference to anything, and reporting one would make the page documenting this
// feature impossible to write without a finding against it.
func stripFencedBlocks(body string) string {
	lines := strings.Split(body, "\n")
	inside := false
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			inside = !inside
			lines[i] = ""
			continue
		}
		if inside {
			lines[i] = ""
		}
	}
	return strings.Join(lines, "\n")
}
