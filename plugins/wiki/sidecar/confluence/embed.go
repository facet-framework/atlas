package main

import (
	"fmt"
	"sort"
	"strings"

	"github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
)

// WikiEmbed is one ```atlas block, read far enough to say what it selects.
type WikiEmbed struct {
	// Component is what the block names, empty when it names none.
	Component string
	// Record is the record it selects, empty when it selects none.
	Record string
	// Body is the block as written, for a caller that needs the rest.
	Body string
}

// ParseWikiEmbed reads the component and selector out of an ```atlas block.
//
// Two keys and no more. The block is YAML and a full parse would let this
// function acquire opinions about keys it has no business knowing — what a
// mirror needs is what to call the thing and what it points at.
func ParseWikiEmbed(block string) WikiEmbed {
	embed := WikiEmbed{Body: block, Record: embedBlockRecord(block)}
	for _, line := range strings.Split(block, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || wiki.CanonicalWikiEmbedKey(strings.TrimSpace(key)) != "component" {
			continue
		}
		embed.Component = strings.Trim(strings.TrimSpace(value), `"'`)
		if strings.TrimSpace(key) == "component" {
			break
		}
	}
	return embed
}

// confluenceEmbedPanel renders an embedding as a native Confluence form.
//
// An info panel, not an image. Storage format has panels, tables and code
// blocks, and those are searchable, copyable, and legible in dark mode; an SVG
// attachment is none of the three, and it would have to be replaced on every run
// — which would give the page a new version every time and mean the "unchanged"
// case was never unchanged, colliding head-on with the conflict rule.
//
// What it does NOT carry is a rendered snapshot of the view, and that is the
// decision this function exists to make honestly. A ProofMatrix is a measurement
// over the corpus, and a mirror is handed pages — not a registry. There is
// nothing here to measure with, so nothing measured is shown: a table of
// plausible-looking numbers assembled without the corpus is precisely the
// invented value this project spent three releases removing.
//
// It carries no date either. the specification's date belongs to a snapshot that was taken,
// and a date on a snapshot nobody took says a measurement happened.
//
// The second reason is worth stating precisely, because the obvious version of
// it is wrong. A per-run date would NOT make every run push: wiki.MirrorWiki judges
// "unchanged" on the digest of the page file on disk, taken before any of this
// runs, so the rendered body does not enter that comparison at all. What it
// would do is worse and quieter — the date would be written on the first push
// and then frozen there, because no later run pushes an unchanged page. Within a
// month every embedding in Confluence would carry a confident timestamp that
// describes when the mirror first ran rather than when anything was measured,
// and nothing would ever correct it. A date that cannot go stale visibly is the
// invented value in its most durable form.
func confluenceEmbedPanel(embed WikiEmbed, address string) string {
	var b strings.Builder
	b.WriteString(`<ac:structured-macro ac:name="info"><ac:rich-text-body>`)

	name := embed.Component
	if name == "" {
		name = "an Atlas view"
	}
	fmt.Fprintf(&b, "<p><strong>%s</strong> — a live view in Atlas. "+
		"It is not drawn here: its values come from the running corpus, "+
		"and this run did not read it.</p>", htmlEscapeText(name))

	if embed.Record != "" {
		fmt.Fprintf(&b, "<p>About: <code>%s</code></p>", htmlEscapeText(embed.Record))
	}
	if address != "" {
		fmt.Fprintf(&b, "<p>View in Atlas: <code>%s</code></p>", htmlEscapeText(address))
	}

	b.WriteString("</ac:rich-text-body></ac:structured-macro>")
	return b.String()
}

// ConfluenceEmbedLosses names the embeddings a page could not take across.
//
// Named rather than counted, and by component, which is the same rule the macro
// losses follow in the other direction: "3 embeddings" is a number nobody can
// act on, "the ProofMatrix over registry/layout/source-scanning" is one somebody
// can go and look at.
//
// Every embedding is a loss today, and saying so plainly is better than a report
// that lists some and silently keeps others. Rendering one as a measured
// snapshot needs the registry handed to Mirror, which is a change to the
// wiki.WikiSource interface rather than to this adapter.
func ConfluenceEmbedLosses(page string, embeds []WikiEmbed) []wiki.WikiLoss {
	seen := map[string]bool{}
	var keys []string
	detail := map[string]WikiEmbed{}
	for _, embed := range embeds {
		key := embed.Component + "\x00" + embed.Record
		if seen[key] {
			continue
		}
		seen[key] = true
		keys = append(keys, key)
		detail[key] = embed
	}
	// Sorted, so two runs over one wiki produce the same report and a diff of
	// two reports means something.
	sort.Strings(keys)

	out := make([]wiki.WikiLoss, 0, len(keys))
	for _, key := range keys {
		embed := detail[key]
		name := embed.Component
		if name == "" {
			name = "an unnamed Atlas view"
		}
		why := fmt.Sprintf("the %s embedding is a live view over the corpus and is not "+
			"reproduced in Confluence — the page carries a panel naming it and pointing back "+
			"to Atlas, rather than a snapshot nobody measured", name)
		if embed.Record != "" {
			why = fmt.Sprintf("the %s embedding over %q is a live view over the corpus and is "+
				"not reproduced in Confluence — the page carries a panel naming it and pointing "+
				"back to Atlas, rather than a snapshot nobody measured", name, embed.Record)
		}
		out = append(out, wiki.WikiLoss{Page: page, What: "embedding", Why: why})
	}
	return out
}

// MarkdownToConfluenceWithEmbeds renders a page out, turning ```atlas blocks
// into panels and reporting them.
//
// Separate from MarkdownToConfluence rather than replacing it, because the plain
// conversion is what the round-trip tests and any other caller want: a function
// that silently rewrote fenced blocks would make "what does this Markdown become"
// a question with two answers.
func MarkdownToConfluenceWithEmbeds(markdown, address string) (string, []WikiEmbed, error) {
	// Belt and braces against a caller that hands over a whole page file. The
	// interface says Body is prose, but a header arriving here is silent
	// rather than loud — CommonMark turns '---' plus keys into a rule and a
	// setext heading, so the far system shows 'title: …' as a headline and
	// nothing anywhere reports a problem. One line here costs nothing and closes
	// the class.
	markdown = stripFrontMatter(markdown)
	blocks := wiki.AtlasBlocks(markdown)
	embeds := make([]WikiEmbed, 0, len(blocks))
	for _, block := range blocks {
		embeds = append(embeds, ParseWikiEmbed(block))
	}
	if len(embeds) == 0 {
		storage, err := MarkdownToConfluence(markdown)
		return storage, nil, err
	}

	// The blocks are replaced before parsing rather than intercepted during it.
	// goldmark hands a fenced block back as its lines, and rebuilding the panel
	// from those would mean re-deciding where the fence started — the block
	// boundaries are already known here, and known once is better than derived
	// twice.
	replaced := replaceAtlasBlocks(markdown, func(i int) string {
		// A placeholder that survives the Markdown parse as its own paragraph,
		// swapped for the panel afterwards. Substituting the storage format
		// here would put raw XHTML through the escaper that exists to stop
		// exactly that.
		return fmt.Sprintf("ATLASEMBED%dATLASEMBED", i)
	})

	storage, err := MarkdownToConfluence(replaced)
	if err != nil {
		return "", embeds, err
	}
	for i, embed := range embeds {
		storage = strings.ReplaceAll(storage,
			fmt.Sprintf("<p>ATLASEMBED%dATLASEMBED</p>", i),
			confluenceEmbedPanel(embed, address))
	}
	return storage, embeds, nil
}

// stripFrontMatter drops a YAML header if one is there, and is a no-op if not.
//
// It reuses wiki.SplitFrontMatter rather than matching '---' itself, so "is this a
// header" has one answer in this codebase instead of two that can drift.
func stripFrontMatter(body string) string {
	_, prose, found := wiki.SplitFrontMatter([]byte(body))
	if !found {
		return body
	}
	return string(prose)
}

// replaceAtlasBlocks swaps each ```atlas block, fence and all, for what the
// caller returns.
func replaceAtlasBlocks(body string, with func(i int) string) string {
	lines := strings.Split(body, "\n")
	var out []string
	index := 0
	for i := 0; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) != "```atlas" {
			out = append(out, lines[i])
			continue
		}
		// Skip to the closing fence; the block's content is already parsed.
		for i++; i < len(lines); i++ {
			if strings.HasPrefix(strings.TrimSpace(lines[i]), "```") {
				break
			}
		}
		out = append(out, with(index))
		index++
	}
	return strings.Join(out, "\n")
}

func embedBlockRecord(block string) string {
	for _, line := range strings.Split(block, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(key) != "record" {
			continue
		}
		return strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return ""
}
