package server

import (
	"encoding/json"
	"strings"
	"testing"
)

// A glossary whose terms are grouped. Two categories, declared in an order that
// is not alphabetical, because the order of the groups is one of the things
// under test — sorting them would reverse these two.
const groupedGlossary = `schema_version: "0.1"
categories:
  - id: parties
    title: Parties
    purpose: The people and organisations a shipment passes between.
  - id: documents
    title: Documents
terms:
  - term: Consignee
    category: parties
    definition: |
      The party named in the transport document who receives the goods.
  - term: Bill of Lading
    category: documents
    definition: |
      The document the carrier issues for goods received.
  - term: Shipper
    category: parties
    definition: |
      The party handing the goods to the carrier.
`

// A glossary from before categories existed: terms, no grouping of any kind.
const flatGlossary = `schema_version: "0.1"
terms:
  - term: Consignee
    definition: |
      The party named in the transport document who receives the goods.
`

// glossaryProject writes a repository with one record and the given glossary.
func glossaryProject(t *testing.T, glossary string) *Corpus {
	t.Helper()
	files := map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
	}
	if glossary != "" {
		files["docs/facets/glossary.yaml"] = glossary
	}
	corpus, err := Build(project(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	return corpus
}

func groupIDs(groups []GlossaryGroup) []string {
	out := make([]string, 0, len(groups))
	for _, g := range groups {
		out = append(out, g.ID)
	}
	return out
}

// The whole point of shipping this from the host: the order, the headings and
// the four states are computed once, by the Go rule the linter already uses,
// rather than a second time by the reader. A reader that reimplements Grouped()
// is a second answer to "which groups are there", free to disagree with the
// first — which is the defect the specification refuses for the taxonomy and the reason
// Calibration ships from here rather than being recomputed.
func TestBuildShipsTheGroupingTheHostComputed(t *testing.T) {
	corpus := glossaryProject(t, groupedGlossary)

	if got := groupIDs(corpus.GlossaryGroups); !equalStrings(got, []string{"parties", "documents"}) {
		t.Fatalf("expected the declared order, got %v", got)
	}
	parties := corpus.GlossaryGroups[0]
	if parties.Title != "Parties" {
		t.Errorf("expected the declared title, got %q", parties.Title)
	}
	if !strings.Contains(parties.Purpose, "shipment passes between") {
		t.Errorf("expected the declared purpose, got %q", parties.Purpose)
	}
	if !parties.Declared {
		t.Error("a declared category must say so")
	}
	// Names, not copies. The reader already has every definition from the
	// glossary text beside this; shipping them again would be a second
	// statement of the same set, free to disagree with the first.
	if got := parties.Terms; !equalStrings(got, []string{"Consignee", "Shipper"}) {
		t.Errorf("expected the terms in file order, got %v", got)
	}
	if corpus.GlossaryGroups[1].Purpose != "" {
		t.Errorf("a category declaring no purpose has none, got %q", corpus.GlossaryGroups[1].Purpose)
	}
}

// The fourth state, and the one that is not a group: nobody grouped anything.
// Nil rather than an empty list, and the difference reaches the reader through
// omitempty — a surface handed one unnamed group would draw a heading over a
// list that has none, and every glossary written before categories existed is
// exactly that list.
func TestBuildShipsNoGroupingWhenNobodyGroups(t *testing.T) {
	corpus := glossaryProject(t, flatGlossary)

	if corpus.GlossaryGroups != nil {
		t.Fatalf("expected no grouping at all, got %+v", corpus.GlossaryGroups)
	}
	// And the reader must be able to tell: the key is absent, not an empty
	// array. `[]` would say "grouped, and the grouping is empty".
	data, err := json.Marshal(corpus)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "glossaryGroups") {
		t.Error("an ungrouped glossary must not ship a glossaryGroups key at all")
	}
	// The glossary itself still ships — the terms are there, only the grouping
	// is not.
	if !strings.Contains(corpus.Glossary, "Consignee") {
		t.Error("the glossary text must still be shipped")
	}
}

// A project with no glossary at all has not failed to group anything. Same
// absence, one level up.
func TestBuildShipsNoGroupingWithoutAGlossary(t *testing.T) {
	corpus := glossaryProject(t, "")

	if corpus.GlossaryGroups != nil {
		t.Fatalf("expected no grouping without a glossary, got %+v", corpus.GlossaryGroups)
	}
	if corpus.Glossary != "" {
		t.Errorf("expected no glossary either, got %q", corpus.Glossary)
	}
}

// State one of four: a declared category no term names. The linter warns about
// it, and a host that dropped it would disagree with both the file and the
// warning — the reader could not draw its "Declared; no term names it."
// state (server.screens-contents.glossary-declared-no-term-names-it)
// over something it was never sent.
func TestBuildShipsAnEmptyDeclaredCategoryAsAGroup(t *testing.T) {
	corpus := glossaryProject(t, `schema_version: "0.1"
categories:
  - id: parties
    title: Parties
  - id: events
    title: Events
terms:
  - term: Consignee
    category: parties
    definition: |
      The party named in the transport document who receives the goods.
`)

	if got := groupIDs(corpus.GlossaryGroups); !equalStrings(got, []string{"parties", "events"}) {
		t.Fatalf("expected the empty category to keep its group, got %v", got)
	}
	events := corpus.GlossaryGroups[1]
	if len(events.Terms) != 0 {
		t.Errorf("expected the empty category to hold nothing, got %v", events.Terms)
	}
	if !events.Declared {
		t.Error("an empty category is still declared — that is what makes it empty rather than absent")
	}
}

// State two of four: a term naming a category the file does not declare. Kept
// as its own group rather than folded in with the uncategorised, because a
// category somebody deleted and a term nobody categorised are opposite
// statements — folding the first into the second launders an error into an
// absence.
func TestBuildMarksAnUndeclaredCategoryAsUndeclared(t *testing.T) {
	corpus := glossaryProject(t, `schema_version: "0.1"
categories:
  - id: parties
    title: Parties
terms:
  - term: Consignee
    category: parties
    definition: |
      The party named in the transport document who receives the goods.
  - term: Bill of Lading
    category: documents
    definition: |
      The document the carrier issues for goods received.
`)

	if got := groupIDs(corpus.GlossaryGroups); !equalStrings(got, []string{"parties", "documents"}) {
		t.Fatalf("expected the undeclared id to keep its own group, got %v", got)
	}
	undeclared := corpus.GlossaryGroups[1]
	if undeclared.Declared {
		t.Error("a category the file does not declare must not claim to be declared")
	}
	if undeclared.Title != "" {
		t.Errorf("there is no declared wording to show, got %q", undeclared.Title)
	}
	if got := undeclared.Terms; !equalStrings(got, []string{"Bill of Lading"}) {
		t.Errorf("expected the term to stay visible under its stated id, got %v", got)
	}
}

// State three of four: the terms nobody categorised. Last, and with no name of
// any kind — a name invented here is the name every surface would then show,
// and "Other" is the absent value wearing a heading.
func TestBuildKeepsTheUncategorisedTermsLastAndNameless(t *testing.T) {
	corpus := glossaryProject(t, `schema_version: "0.1"
categories:
  - id: parties
    title: Parties
terms:
  - term: Demurrage
    definition: |
      What the carrier charges when a container is held past its free time.
  - term: Consignee
    category: parties
    definition: |
      The party named in the transport document who receives the goods.
`)

	if len(corpus.GlossaryGroups) != 2 {
		t.Fatalf("expected the declared group and the uncategorised one, got %v", groupIDs(corpus.GlossaryGroups))
	}
	// Last, even though the uncategorised term is written first in the file.
	last := corpus.GlossaryGroups[len(corpus.GlossaryGroups)-1]
	if last.ID != "" || last.Title != "" || last.Purpose != "" || last.Declared {
		t.Fatalf("the uncategorised group must carry no category at all, got %+v", last)
	}
	if got := last.Terms; !equalStrings(got, []string{"Demurrage"}) {
		t.Errorf("expected the uncategorised term there, got %v", got)
	}
}

// The terms alone can group a glossary: the categories block is absent and the
// terms still name one. Pretending otherwise would drop every category the
// terms still state on the way to a flat list that looks deliberate.
func TestBuildLetsTermsAloneGroupAGlossary(t *testing.T) {
	corpus := glossaryProject(t, `schema_version: "0.1"
terms:
  - term: Consignee
    category: parties
    definition: |
      The party named in the transport document who receives the goods.
`)

	if got := groupIDs(corpus.GlossaryGroups); !equalStrings(got, []string{"parties"}) {
		t.Fatalf("expected the stated category to keep its group, got %v", got)
	}
	if corpus.GlossaryGroups[0].Declared {
		t.Error("nothing declares it, and the group must not claim otherwise")
	}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
