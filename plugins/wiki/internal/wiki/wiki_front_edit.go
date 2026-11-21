package wiki

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"github.com/goccy/go-yaml"
	"github.com/goccy/go-yaml/ast"
	"github.com/goccy/go-yaml/parser"
	"github.com/goccy/go-yaml/token"
)

// editWikiFrontBytes replaces only fields whose values changed. Parsing supplies
// boundaries, never a serialization of the author's untouched YAML or body.
func editWikiFrontBytes(before string, old, next WikiFront) (string, error) {
	head, _, ok := SplitFrontMatter([]byte(before))
	if !ok {
		return RenderWikiPage(next, before), nil
	}
	values := func(front WikiFront) (map[string]interface{}, error) {
		h, _, _ := SplitFrontMatter([]byte(RenderWikiPage(front, "")))
		var m map[string]interface{}
		err := yaml.Unmarshal(h, &m)
		return m, err
	}
	previous, err := values(old)
	if err != nil {
		return "", err
	}
	desired, err := values(next)
	if err != nil {
		return "", err
	}
	changed := map[string]bool{}
	for k, v := range previous {
		if !reflect.DeepEqual(v, desired[k]) {
			changed[k] = true
		}
	}
	for k, v := range desired {
		if !reflect.DeepEqual(v, previous[k]) {
			changed[k] = true
		}
	}
	if len(changed) == 0 {
		return before, nil
	}
	parsed, err := parser.ParseBytes(head, parser.ParseComments)
	if err != nil {
		return "", err
	}
	var root *ast.MappingNode
	if len(parsed.Docs) > 0 {
		root, _ = parsed.Docs[0].Body.(*ast.MappingNode)
	}
	if root == nil {
		commentsOnly := true
		for _, line := range strings.Split(string(head), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				commentsOnly = false
			}
		}
		if len(parsed.Docs) == 0 || parsed.Docs[0].Body == nil || commentsOnly {
			root = &ast.MappingNode{}
		} else {
			return "", fmt.Errorf("the page header must be a mapping")
		}
	}
	text := string(head)
	canonicalHead, _, _ := SplitFrontMatter([]byte(RenderWikiPage(next, "")))
	canonicalField := func(key string) string {
		lines := strings.SplitAfter(string(canonicalHead), "\n")
		var out strings.Builder
		found := false
		for _, line := range lines {
			if strings.HasPrefix(line, key+":") {
				found = true
			} else if found && strings.TrimSpace(line) != "" && line[0] != ' ' && line[0] != '\t' {
				break
			}
			if found {
				out.WriteString(line)
			}
		}
		return out.String()
	}
	// Parser positions count Unicode characters, while slices count bytes.
	offset := func(t *token.Token) int {
		line, col := 1, 1
		for i, r := range text {
			if line == t.Position.Line && col == t.Position.Column {
				return i
			}
			if r == '\n' {
				line++
				col = 1
			} else {
				col++
			}
		}
		return len(text)
	}
	type patch struct {
		start, end int
		value      string
	}
	patches := []patch{}
	present := map[string]bool{}
	newline := "\n"
	if strings.HasSuffix(text, "\r\n") {
		newline = "\r\n"
	}
	encodeFlow := func(value interface{}) (string, error) {
		var b bytes.Buffer
		encoder := json.NewEncoder(&b)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(value); err != nil {
			return "", err
		}
		return strings.TrimSuffix(b.String(), "\n"), nil
	}
	blockField := func(key, indent, ending string) string {
		var b strings.Builder
		for _, line := range strings.SplitAfter(canonicalField(key), "\n") {
			if line != "" {
				b.WriteString(indent)
				b.WriteString(strings.ReplaceAll(line, "\n", ending))
			}
		}
		return b.String()
	}
	rawKeys := map[string]bool{}
	for _, field := range root.Values {
		var key string
		if err := yaml.NodeToValue(field.Key, &key); err != nil {
			return "", err
		}
		rawKeys[key] = true
	}
	for i, field := range root.Values {
		var key string
		if err := yaml.NodeToValue(field.Key, &key); err != nil {
			return "", err
		}
		removeLegacy := false
		if english, legacy := wikiKeyAliases[key]; legacy {
			removeLegacy = rawKeys[english]
			key = english
		}
		present[key] = true
		if !changed[key] {
			continue
		}
		// A shared YAML anchor couples this field to another value. Refuse
		// rather than corrupt aliases or silently change an unnamed field.
		for _, anchor := range ast.Filter(ast.AnchorType, field.Value) {
			name := anchor.(*ast.AnchorNode).Name.String()
			for _, alias := range ast.Filter(ast.AliasType, root) {
				if alias.(*ast.AliasNode).Value.String() == name {
					return "", fmt.Errorf("cannot edit %s independently: YAML anchor %s is shared", key, name)
				}
			}
		}
		start := offset(field.Key.GetToken())
		end := len(text)
		if root.IsFlowStyle {
			end = offset(root.End)
			if i+1 < len(root.Values) {
				end = offset(root.Values[i+1].CollectEntry)
			}
			for end > start && strings.ContainsRune(" \t\r\n", rune(text[end-1])) {
				end--
			}
		} else {
			start = strings.LastIndex(text[:start], "\n") + 1
			if i+1 < len(root.Values) {
				end = offset(root.Values[i+1].Key.GetToken())
				end = strings.LastIndex(text[:end], "\n") + 1
			}
			// Comments and blank lines preceding the next field belong to the
			// untouched surroundings, rather than to the value being replaced.
			for end > start {
				trimmed := strings.TrimSuffix(text[start:end], "\n")
				lineStart := strings.LastIndex(trimmed, "\n") + start + 1
				line := strings.TrimSpace(text[lineStart:end])
				if line != "" && !strings.HasPrefix(line, "#") {
					break
				}
				end = lineStart
			}
		}
		replacement := ""
		if value, exists := desired[key]; exists && !removeLegacy {
			encoded, err := encodeFlow(value)
			if err != nil {
				return "", err
			}
			replacement = key + ": " + encoded
			if !root.IsFlowStyle {
				ending := "\n"
				if strings.HasSuffix(text[start:end], "\r\n") {
					ending = "\r\n"
				}
				replacement = blockField(key, strings.Repeat(" ", field.Key.GetToken().Position.Column-1), ending)
				for _, comment := range ast.Filter(ast.CommentType, field) {
					tok := comment.GetToken()
					if tok.Position.Line != field.Key.GetToken().Position.Line {
						continue
					}
					at := offset(tok)
					for at > start && (text[at-1] == ' ' || text[at-1] == '\t') {
						at--
					}
					last := strings.IndexByte(text[at:end], '\n')
					if last < 0 {
						last = end - at
					}
					suffix := strings.TrimSuffix(text[at:at+last], "\r")
					first := strings.IndexByte(replacement, '\n')
					if first >= 0 {
						pos := first
						if pos > 0 && replacement[pos-1] == '\r' {
							pos--
						}
						replacement = replacement[:pos] + suffix + replacement[pos:]
					}
					break
				}
			}
		} else if root.IsFlowStyle {
			if i+1 < len(root.Values) {
				if field.CollectEntry != nil {
					start = offset(field.CollectEntry) + 1
				} else {
					start = offset(root.Start) + 1
				}
				end = offset(root.Values[i+1].CollectEntry) + 1
			} else if field.CollectEntry != nil {
				start = offset(field.CollectEntry)
			}
		}
		patches = append(patches, patch{start, end, replacement})
	}
	keys := []string{}
	for key := range changed {
		if !present[key] {
			if _, exists := desired[key]; exists {
				keys = append(keys, key)
			}
		}
	}
	sort.Strings(keys)
	addition := ""
	for _, key := range keys {
		encoded, err := encodeFlow(desired[key])
		if err != nil {
			return "", err
		}
		if root.IsFlowStyle {
			retained := 0
			for key := range present {
				if _, exists := desired[key]; exists || !changed[key] {
					retained++
				}
			}
			if retained > 0 || addition != "" {
				addition += ", "
			}
			addition += key + ": " + encoded
		} else {
			indent := ""
			if len(root.Values) > 0 {
				indent = strings.Repeat(" ", root.Values[0].Key.GetToken().Position.Column-1)
			}
			addition += blockField(key, indent, newline)
		}
	}
	if addition != "" {
		at := len(text)
		if root.IsFlowStyle {
			at = offset(root.End)
			for at > offset(root.Start)+1 && strings.ContainsRune(" \t\r\n", rune(text[at-1])) {
				at--
			}
		}
		patches = append(patches, patch{at, at, addition})
	}
	// Removing adjacent flow entries can include the same separator. Merge
	// deletion spans so a comma is removed exactly once.
	sort.SliceStable(patches, func(i, j int) bool { return patches[i].start < patches[j].start })
	merged := []patch{}
	for _, p := range patches {
		if len(merged) > 0 && p.value == "" && merged[len(merged)-1].value == "" && p.start <= merged[len(merged)-1].end {
			if p.end > merged[len(merged)-1].end {
				merged[len(merged)-1].end = p.end
			}
		} else {
			merged = append(merged, p)
		}
	}
	patches = merged
	sort.SliceStable(patches, func(i, j int) bool { return patches[i].start > patches[j].start })
	for _, p := range patches {
		text = text[:p.start] + p.value + text[p.end:]
	}
	rest, _ := cutFence([]byte(before))
	start := len(before) - len(rest)
	after := before[:start] + text + before[start+len(head):]
	checked := parseWikiPage("edited.md", []byte(after))
	if checked.FrontErr != nil {
		return "", fmt.Errorf("edited header is invalid: %w", checked.FrontErr)
	}
	measured, err := values(checked.Front)
	if err != nil {
		return "", err
	}
	if !reflect.DeepEqual(measured, desired) {
		return "", fmt.Errorf("edited header changes an unnamed field")
	}
	return after, nil
}
