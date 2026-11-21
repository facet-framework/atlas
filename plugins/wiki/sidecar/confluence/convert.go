package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/base"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/commonmark"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/table"
	"github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// confluenceMacrosKept are the three the concept allows across (the specification).
//
// Three and not four. Every macro beyond these is a program inside a document,
// and re-implementing a macro language is not a wiki feature — so the rest are
// named in the loss report and left as a visible line in the page rather than
// approximated into something that looks right and is not.
var confluenceMacrosKept = map[string]string{
	"code":    "code",
	"info":    "info",
	"note":    "info",
	"tip":     "info",
	"warning": "warning",
}

// macroName matches the name attribute of a structured macro in storage format.
//
// Storage format writes a macro as
// <ac:structured-macro ac:name="jira" ac:schema-version="1" ac:macro-id="…">
// with its parameters as <ac:parameter ac:name="…"> children. The name is what
// the loss report has to carry: "the 'jira' macro" is a sentence somebody acts
// on, and "3 macros" is a number nobody can.
var macroName = regexp.MustCompile(`ac:name="([^"]*)"`)

// ConfluenceMacro is one macro found in a page's storage format.
type ConfluenceMacro struct {
	// Name is the macro's own name, as Confluence writes it.
	Name string
	// Kept reports whether the wiki has an equivalent for it.
	Kept bool
}

// ConfluenceAttachments lists the attachments and mentions a page carries.
//
// Reported rather than silently converted, because the specification promises both are named
// in the report and neither survives the crossing: an attachment is a file this
// import does not download, and a mention is an account id the wiki has no way
// to resolve into a person. An image that arrives as a link to a file nobody
// fetched, and a mention that arrives as an empty gap in a sentence, are both
// content that disappeared with nothing saying so.
func ConfluenceAttachments(storage string) (images []string, mentions int) {
	nodes, err := html.ParseFragment(strings.NewReader(storage), bodyContext())
	if err != nil {
		return nil, 0
	}
	seen := map[string]bool{}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			tag := strings.ToLower(n.Data)
			for _, attr := range n.Attr {
				switch attr.Key {
				case "ri:filename", "filename":
					if name := strings.TrimSpace(attr.Val); name != "" && !seen[name] {
						seen[name] = true
						images = append(images, name)
					}
				case "ri:account-id", "account-id", "ri:userkey", "userkey":
					mentions++
				}
			}
			_ = tag
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	for _, node := range nodes {
		walk(node)
	}
	sort.Strings(images)
	return images, mentions
}

// FindConfluenceMacros lists the macros a storage-format body carries.
//
// Named rather than counted, and in the order they appear, so the loss report
// can say which one sat where. Duplicates are collapsed: a page with the same
// macro four times has one problem, not four, and four identical lines in a
// report is a report somebody stops reading.
func FindConfluenceMacros(storage string) []ConfluenceMacro {
	nodes, err := html.ParseFragment(strings.NewReader(storage), bodyContext())
	if err != nil || len(nodes) == 0 {
		// Falling back to the text rather than reporting nothing: a body this
		// parser cannot read is exactly the body whose macros matter most, and
		// saying "no macros" about it would be the flattering answer.
		return findMacrosByText(storage)
	}
	seen := map[string]bool{}
	var out []ConfluenceMacro
	for _, node := range nodes {
		walkMacros(node, seen, &out)
	}
	if len(out) == 0 {
		return findMacrosByText(storage)
	}
	return out
}

// bodyContext is the fragment-parsing context storage format is parsed in.
//
// DataAtom has to agree with Data or ParseFragment refuses the node outright —
// and a refused context node means every call falls through to the text
// fallback, which finds macro names but loses the bodies. Written once here
// rather than at each call site, because getting it wrong is silent.
func bodyContext() *html.Node {
	return &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body}
}

// walkMacros descends the parsed fragment collecting macro names.
func walkMacros(n *html.Node, seen map[string]bool, out *[]ConfluenceMacro) {
	if n.Type == html.ElementNode && isMacroElement(n.Data) {
		for _, attr := range n.Attr {
			if attr.Key != "ac:name" && attr.Key != "name" {
				continue
			}
			if name := strings.TrimSpace(attr.Val); name != "" && !seen[name] {
				seen[name] = true
				_, kept := confluenceMacrosKept[strings.ToLower(name)]
				*out = append(*out, ConfluenceMacro{Name: name, Kept: kept})
			}
		}
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		walkMacros(child, seen, out)
	}
}

// isMacroElement reports whether a tag is one of storage format's macro
// elements. The parser lower-cases tag names and keeps the namespace prefix.
func isMacroElement(tag string) bool {
	switch strings.ToLower(tag) {
	case "ac:structured-macro", "ac:macro", "structured-macro":
		return true
	}
	return false
}

// findMacrosByText is the fallback for a body the HTML parser would not take.
func findMacrosByText(storage string) []ConfluenceMacro {
	seen := map[string]bool{}
	var out []ConfluenceMacro
	for _, chunk := range strings.Split(storage, "<ac:structured-macro")[1:] {
		match := macroName.FindStringSubmatch(chunk)
		if len(match) < 2 {
			continue
		}
		name := strings.TrimSpace(match[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		_, kept := confluenceMacrosKept[strings.ToLower(name)]
		out = append(out, ConfluenceMacro{Name: name, Kept: kept})
	}
	return out
}

// ConfluenceToMarkdown turns a storage-format body into Markdown, and says what
// it could not carry.
//
// The losses come back rather than being logged, because the caller is the only
// thing that knows which page this was and the report is per page. A macro that
// has no equivalent leaves a visible line at its place in the text as well —
// that is the concept's own requirement (the specification, "not silent"), and it is the
// difference between a gap somebody finds while reading and a gap discovered
// months later by whoever needed it.
func ConfluenceToMarkdown(storage string) (string, []ConfluenceMacro, error) {
	macros := FindConfluenceMacros(storage)

	prepared := rewriteMacrosForConversion(storage)

	conv := converter.NewConverter(converter.WithPlugins(
		base.NewBasePlugin(),
		commonmark.NewCommonmarkPlugin(),
		// Tables are the thing a handbook is full of and the thing a naive
		// converter drops silently into a run of paragraphs.
		table.NewTablePlugin(),
	))
	markdown, err := conv.ConvertString(prepared)
	if err != nil {
		return "", macros, err
	}
	return strings.TrimRight(markdown, "\n") + "\n", macros, nil
}

// rewriteMacrosForConversion turns storage-format macros into HTML the
// converter understands, before it ever sees them.
//
// Done as a pre-pass rather than as converter rules because storage format's
// namespaced elements are not HTML: the parser keeps them as unknown elements
// with their children intact, so a code macro would otherwise arrive as its
// parameters' text run together with the code. The three kept macros become the
// HTML they mean; every other one becomes a blockquote naming it.
func rewriteMacrosForConversion(storage string) string {
	nodes, err := html.ParseFragment(strings.NewReader(storage), bodyContext())
	if err != nil {
		return storage
	}
	var b strings.Builder
	for _, node := range nodes {
		writeConverted(&b, node)
	}
	return b.String()
}

// writeConverted renders a storage-format node as plain HTML.
func writeConverted(b *strings.Builder, n *html.Node) {
	switch n.Type {
	case html.TextNode:
		b.WriteString(htmlEscapeText(n.Data))
		return
	case html.CommentNode:
		if inner, ok := cutCDATA(n.Data); ok {
			b.WriteString(htmlEscapeText(inner))
		}
		return
	case html.ElementNode:
		if isMacroElement(n.Data) {
			writeMacro(b, n)
			return
		}
		if strings.HasPrefix(strings.ToLower(n.Data), "ri:") {
			// A resource identifier — an attachment, a page, a user. It carries
			// no text of its own, and rendering its attributes would put a
			// filename into the middle of a sentence.
			//
			// Its children are still walked, and that is not redundant. Storage
			// format writes these as XHTML self-closing tags, but an HTML parser
			// does not honour self-closing on an element it does not know, so
			// everything that followed <ri:page/> inside the link becomes its
			// child. Returning here without descending discarded the link text
			// of every cross-page link in the space.
			for child := n.FirstChild; child != nil; child = child.NextSibling {
				writeConverted(b, child)
			}
			return
		}
		tag := strings.ToLower(n.Data)
		if tag == "ac:link" || tag == "ac:image" {
			writeAcLink(b, n)
			return
		}
		if strings.Contains(tag, ":") {
			// Any other namespaced element: keep the children, drop the wrapper.
			// The text somebody wrote survives; the markup that has no HTML
			// meaning does not become visible noise.
			for child := n.FirstChild; child != nil; child = child.NextSibling {
				writeConverted(b, child)
			}
			return
		}
		fmt.Fprintf(b, "<%s", tag)
		for _, attr := range n.Attr {
			if strings.Contains(attr.Key, ":") {
				continue
			}
			fmt.Fprintf(b, ` %s="%s"`, attr.Key, htmlEscapeAttr(attr.Val))
		}
		b.WriteString(">")
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			writeConverted(b, child)
		}
		fmt.Fprintf(b, "</%s>", tag)
		return
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		writeConverted(b, child)
	}
}

// writeAcLink renders a Confluence link to another page as an ordinary link.
//
// The target is the page title, because that is what storage format stores —
// there is no path here, and inventing one would be a guess about where that
// page landed in the wiki. The import's alias table is what resolves it later;
// a link that names the title is at least a link a person can follow by hand.
func writeAcLink(b *strings.Builder, n *html.Node) {
	title := ""
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			for _, attr := range node.Attr {
				if (attr.Key == "ri:content-title" || attr.Key == "content-title" ||
					attr.Key == "ri:filename" || attr.Key == "filename") && title == "" {
					title = attr.Val
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)

	// Searched through the whole subtree rather than among the direct children,
	// for the same reason the ri: branch descends: the parser has moved the body
	// under the self-closing <ri:page/> that precedes it.
	body := &strings.Builder{}
	var findBody func(*html.Node)
	findBody = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "ac:plain-text-link-body", "ac:link-body":
				for inner := node.FirstChild; inner != nil; inner = inner.NextSibling {
					writeConverted(body, inner)
				}
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			findBody(child)
		}
	}
	findBody(n)
	text := strings.TrimSpace(body.String())
	if text == "" {
		text = title
	}
	if title == "" && text == "" {
		// A mention: <ac:link><ri:user ri:account-id="…"/></ac:link>. Rendered as
		// a visible placeholder rather than as nothing, because dropping it left
		// "Questions for ." — a sentence with a hole in it and no sign of what was
		// there. The account id is the only name the page actually carries.
		for _, account := range accountIDsUnder(n) {
			fmt.Fprintf(b, "<em>@%s</em>", htmlEscapeText(account))
			return
		}
		return
	}
	fmt.Fprintf(b, `<a href="%s">%s</a>`, htmlEscapeAttr(title), text)
}

// accountIDsUnder collects the account ids a mention names.
func accountIDsUnder(n *html.Node) []string {
	var out []string
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			for _, attr := range node.Attr {
				if attr.Key == "ri:account-id" || attr.Key == "account-id" ||
					attr.Key == "ri:userkey" || attr.Key == "userkey" {
					if v := strings.TrimSpace(attr.Val); v != "" {
						out = append(out, v)
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return out
}

// writeMacro renders one macro: the three kept ones as what they mean, the rest
// as a visible line naming them.
func writeMacro(b *strings.Builder, n *html.Node) {
	name := ""
	for _, attr := range n.Attr {
		if attr.Key == "ac:name" || attr.Key == "name" {
			name = strings.TrimSpace(attr.Val)
		}
	}
	kind, kept := confluenceMacrosKept[strings.ToLower(name)]
	if !kept && macroHasRichBody(n) {
		// A container macro — expand, panel, section, column — holds prose
		// somebody wrote. Dropping it kept the wrapper's name and threw away a
		// whole section of the page, and the loss entry said "the expand macro
		// has no equivalent", which reads as though a widget went missing rather
		// than four paragraphs. The wrapper goes, the contents stay, and the
		// note says exactly that.
		fmt.Fprintf(b, "<blockquote><p>From Confluence: macro %q not carried over — "+
			"the content stands unchanged below</p></blockquote>", name)
		writeRichBody(b, n)
		return
	}
	if !kept {
		// The visible line the concept requires. It is a blockquote so that it
		// reads as an aside rather than as the page's own prose, and it names
		// the macro so the reader knows what is missing rather than that
		// something is.
		fmt.Fprintf(b, "<blockquote><p>From Confluence: macro %q not carried over</p></blockquote>",
			name)
		// Its children are still written, and that is not redundant. Storage
		// format writes a parameterless macro as a self-closing tag, and an HTML
		// parser does not honour self-closing on an element it does not know —
		// so everything after <ac:structured-macro ac:name="toc"/> becomes its
		// child. Returning here swallowed every macro and every paragraph that
		// followed one. Found against the live instance: a page whose 'toc' sat
		// above a code block arrived with the code block simply gone.
		writeMacroChildren(b, n)
		return
	}

	body, language := macroParts(n)
	switch kind {
	case "code":
		if language != "" {
			fmt.Fprintf(b, `<pre><code class="language-%s">%s</code></pre>`,
				htmlEscapeAttr(language), htmlEscapeText(body))
			return
		}
		fmt.Fprintf(b, "<pre><code>%s</code></pre>", htmlEscapeText(body))
	case "info", "warning":
		// An info or a warning is a blockquote with its kind named. Markdown has
		// no admonition, and inventing a syntax for one would be a second
		// dialect nothing else in this project reads.
		label := "Info"
		if kind == "warning" {
			label = "Warning"
		}
		// The body is rendered as markup rather than flattened to its text.
		// nodeText concatenates every text node, so a panel holding three
		// paragraphs and a list arrived as one run-on line — the content was all
		// there and none of it was readable.
		fmt.Fprintf(b, "<blockquote><p><strong>%s:</strong></p>", label)
		if !writeRichBody(b, n) {
			fmt.Fprintf(b, "<p>%s</p>", htmlEscapeText(strings.TrimSpace(body)))
		}
		b.WriteString("</blockquote>")
	}
}

// writeMacroChildren writes what a self-closing macro swallowed.
//
// Only the siblings it captured, never its own parameters or body: a macro's
// <ac:parameter> and <ac:plain-text-body> belong to the macro that was dropped,
// and writing them would put a Jira issue key or a raw macro body into the prose
// as if somebody had typed it.
func writeMacroChildren(b *strings.Builder, n *html.Node) {
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode {
			switch strings.ToLower(child.Data) {
			case "ac:parameter", "parameter",
				"ac:plain-text-body", "plain-text-body",
				"ac:rich-text-body", "rich-text-body":
				continue
			}
		}
		writeConverted(b, child)
	}
}

// macroHasRichBody reports whether a macro wraps markup rather than plain text.
func macroHasRichBody(n *html.Node) bool {
	found := false
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if found {
			return
		}
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "ac:rich-text-body", "rich-text-body":
				found = true
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return found
}

// writeRichBody renders a macro's rich body as markup, reporting whether it
// found one.
func writeRichBody(b *strings.Builder, n *html.Node) bool {
	wrote := false
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if wrote {
			return
		}
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "ac:rich-text-body", "rich-text-body":
				for child := node.FirstChild; child != nil; child = child.NextSibling {
					writeConverted(b, child)
				}
				wrote = true
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return wrote
}

// macroParts pulls a macro's body and its language parameter out.
func macroParts(n *html.Node) (body, language string) {
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			tag := strings.ToLower(node.Data)
			if tag == "ac:parameter" || tag == "parameter" {
				param := ""
				for _, attr := range node.Attr {
					if attr.Key == "ac:name" || attr.Key == "name" {
						param = attr.Val
					}
				}
				if param == "language" {
					language = strings.TrimSpace(nodeText(node))
				}
				return
			}
			if tag == "ac:plain-text-body" || tag == "plain-text-body" ||
				tag == "ac:rich-text-body" || tag == "rich-text-body" {
				body = nodeText(node)
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return body, language
}

// nodeText collects a node's text, CDATA included — storage format wraps a code
// macro's body in CDATA, which the parser hands back as a text node.
func nodeText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		switch node.Type {
		case html.TextNode:
			b.WriteString(node.Data)
		case html.CommentNode:
			// The parser has no CDATA node type and hands a CDATA section back
			// as a comment whose data still carries the wrapper. A code macro's
			// body is always CDATA, so a walk that collected only text nodes
			// would return an empty string for every code block in the space.
			if inner, ok := cutCDATA(node.Data); ok {
				b.WriteString(inner)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return b.String()
}

// cutCDATA unwraps a CDATA section the parser handed back as a comment.
func cutCDATA(data string) (string, bool) {
	inner, ok := strings.CutPrefix(data, "[CDATA[")
	if !ok {
		return "", false
	}
	return strings.TrimSuffix(inner, "]]"), true
}

func htmlEscapeText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func htmlEscapeAttr(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

// MarkdownToConfluence renders a Markdown body as storage format.
//
// Built on a parse tree rather than on string replacement, which is the whole
// reason goldmark is here: storage format is XHTML, and a title or a paragraph
// carrying an ampersand or a less-than produces a document Confluence rejects if
// the text is concatenated rather than escaped. Walking the tree means every
// piece of text passes the same escape on its way out.
//
// Not a full CommonMark renderer. It covers what the wiki's own pages contain —
// headings, paragraphs, lists, tables, code, quotes, links, emphasis — and falls
// back to the literal text for anything else, which is visible and wrong rather
// than invisible and wrong.
func MarkdownToConfluence(markdown string) (string, error) {
	source := []byte(markdown)
	reader := text.NewReader(source)
	doc := goldmark.New().Parser().Parse(reader)

	var b strings.Builder
	if err := renderConfluenceNode(&b, doc, source); err != nil {
		return "", err
	}
	return strings.TrimSpace(b.String()), nil
}

// renderConfluenceNode walks the parse tree emitting storage format.
func renderConfluenceNode(b *strings.Builder, n ast.Node, src []byte) error {
	switch node := n.(type) {
	case *ast.Document:
		return renderConfluenceChildren(b, n, src)

	case *ast.Heading:
		fmt.Fprintf(b, "<h%d>", node.Level)
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		fmt.Fprintf(b, "</h%d>", node.Level)

	case *ast.Paragraph:
		b.WriteString("<p>")
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		b.WriteString("</p>")

	case *ast.TextBlock:
		return renderConfluenceChildren(b, n, src)

	case *ast.Blockquote:
		b.WriteString("<blockquote>")
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		b.WriteString("</blockquote>")

	case *ast.List:
		tag := "ul"
		if node.IsOrdered() {
			tag = "ol"
		}
		fmt.Fprintf(b, "<%s>", tag)
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		fmt.Fprintf(b, "</%s>", tag)

	case *ast.ListItem:
		b.WriteString("<li>")
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		b.WriteString("</li>")

	case *ast.FencedCodeBlock:
		// A fenced block becomes the code macro rather than <pre>, because that
		// is what a Confluence reader expects to see and what keeps syntax
		// highlighting when the fence named a language.
		language := string(node.Language(src))
		b.WriteString(`<ac:structured-macro ac:name="code">`)
		if language != "" {
			fmt.Fprintf(b, `<ac:parameter ac:name="language">%s</ac:parameter>`,
				htmlEscapeText(language))
		}
		fmt.Fprintf(b, `<ac:plain-text-body><![CDATA[%s]]></ac:plain-text-body>`,
			stripCDATAEnd(codeBlockText(node, src)))
		b.WriteString("</ac:structured-macro>")

	case *ast.CodeBlock:
		b.WriteString(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[`)
		b.WriteString(stripCDATAEnd(codeBlockText(node, src)))
		b.WriteString(`]]></ac:plain-text-body></ac:structured-macro>`)

	case *ast.ThematicBreak:
		b.WriteString("<hr/>")

	case *ast.Text:
		b.WriteString(htmlEscapeText(string(node.Segment.Value(src))))
		if node.SoftLineBreak() {
			b.WriteString(" ")
		}
		if node.HardLineBreak() {
			b.WriteString("<br/>")
		}

	case *ast.String:
		b.WriteString(htmlEscapeText(string(node.Value)))

	case *ast.CodeSpan:
		b.WriteString("<code>")
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		b.WriteString("</code>")

	case *ast.Emphasis:
		tag := "em"
		if node.Level == 2 {
			tag = "strong"
		}
		fmt.Fprintf(b, "<%s>", tag)
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		fmt.Fprintf(b, "</%s>", tag)

	case *ast.Link:
		fmt.Fprintf(b, `<a href="%s">`, htmlEscapeAttr(string(node.Destination)))
		if err := renderConfluenceChildren(b, n, src); err != nil {
			return err
		}
		b.WriteString("</a>")

	case *ast.AutoLink:
		target := string(node.URL(src))
		fmt.Fprintf(b, `<a href="%s">%s</a>`, htmlEscapeAttr(target), htmlEscapeText(target))

	case *ast.Image:
		// An image's source is kept as written. The mirror does not upload
		// attachments (the specification), so a relative path stays relative and visibly points
		// at nothing — which is the honest outcome, and better than a link to a
		// file this run never put there.
		fmt.Fprintf(b, `<img src="%s" alt="%s"/>`,
			htmlEscapeAttr(string(node.Destination)), htmlEscapeAttr(nodeChildText(n, src)))

	case *ast.RawHTML, *ast.HTMLBlock:
		// Raw HTML in a wiki page is left as the literal text it was written as
		// rather than passed through. Passing it through would let a page inject
		// storage-format markup — a macro, a script — into Confluence, and the
		// wiki's own pages are not a place where that is a capability.
		b.WriteString(htmlEscapeText(rawText(n, src)))

	default:
		return renderConfluenceChildren(b, n, src)
	}
	return nil
}

func renderConfluenceChildren(b *strings.Builder, n ast.Node, src []byte) error {
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		if err := renderConfluenceNode(b, child, src); err != nil {
			return err
		}
	}
	return nil
}

// codeBlockText reassembles a code block's lines.
func codeBlockText(n ast.Node, src []byte) string {
	var b strings.Builder
	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		segment := lines.At(i)
		b.Write(segment.Value(src))
	}
	return b.String()
}

// stripCDATAEnd keeps a code body from closing its own CDATA section.
//
// A page containing the three characters that end a CDATA section would
// otherwise produce a document Confluence rejects, or worse, one it accepts with
// the rest of the page read as markup.
func stripCDATAEnd(s string) string { return strings.ReplaceAll(s, "]]>", "]]&gt;") }

// rawText returns the source text a raw node covers.
// An inline node has no Lines() and panics when asked for them, so the two
// kinds are read through the field each one actually has rather than through a
// single call that happens to work for one of them.
func rawText(n ast.Node, src []byte) string {
	var b strings.Builder
	if raw, ok := n.(*ast.RawHTML); ok {
		for i := 0; i < raw.Segments.Len(); i++ {
			segment := raw.Segments.At(i)
			b.Write(segment.Value(src))
		}
		return b.String()
	}
	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		segment := lines.At(i)
		b.Write(segment.Value(src))
	}
	return b.String()
}

// nodeChildText collects the plain text under a node, for an alt attribute.
func nodeChildText(n ast.Node, src []byte) string {
	var b strings.Builder
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		if t, ok := child.(*ast.Text); ok {
			b.Write(t.Segment.Value(src))
			continue
		}
		b.WriteString(nodeChildText(child, src))
	}
	return b.String()
}

// ConfluenceLossesFor turns the macros found in a page into loss entries.
//
// Sorted by name so two runs over the same space produce the same report and a
// diff of two reports means something (the specification). Only the macros with no equivalent
// are losses: a code macro that came across is not a loss, and listing it would
// make a clean import look damaged.
func ConfluenceLossesFor(page string, macros []ConfluenceMacro) []wiki.WikiLoss {
	var names []string
	for _, macro := range macros {
		if !macro.Kept {
			names = append(names, macro.Name)
		}
	}
	sort.Strings(names)

	out := make([]wiki.WikiLoss, 0, len(names))
	for _, name := range names {
		out = append(out, wiki.WikiLoss{
			Page: page,
			What: "macro",
			Why: fmt.Sprintf("the %q macro has no equivalent in the wiki — "+
				"the page carries a visible line at its place", name),
		})
	}
	return out
}
