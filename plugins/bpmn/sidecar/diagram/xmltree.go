package diagram

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
)

// The namespaces a BPMN 2.0 file speaks. Matched by URI, never by prefix: a
// file is free to call the model namespace "bpmn", "bpmn2", "semantic" or
// nothing at all, and every modeller in the wild uses a different one.
const (
	nsModel  = "http://www.omg.org/spec/BPMN/20100524/MODEL"
	nsBPMNDI = "http://www.omg.org/spec/BPMN/20100524/DI"
	nsDC     = "http://www.omg.org/spec/DD/20100524/DC"
	nsDI     = "http://www.omg.org/spec/DD/20100524/DI"
)

// Limits on what one file may cost. The input arrives from a repository the
// reader opened, which is not the same as a file the reader wrote; a diagram
// nobody can draw is a refusal, a process that runs out of memory is not.
const (
	// MaxInputBytes bounds the XML itself. The host's repo.read already
	// refuses above 1 MiB; this is the sidecar's own bound, so the library
	// does not depend on who called it.
	MaxInputBytes = 4 << 20
	// maxElements bounds the tree. A real process with a thousand tasks has
	// perhaps fifteen thousand elements counting DI and waypoints.
	maxElements = 200_000
	// maxDepth bounds nesting. Subprocesses nest, but not two hundred deep.
	maxDepth = 200
)

// ErrTooLarge and ErrNotBPMN are the two refusals a caller can tell apart.
var (
	ErrTooLarge = errors.New("bpmn: input exceeds the limit")
	ErrNotBPMN  = errors.New("bpmn: not a BPMN 2.0 document")
)

// node is one XML element, reduced to what the builder reads. Text is kept
// only for the few elements whose content is meaningful here (annotation
// text, a condition's presence) — the builder decides which.
type node struct {
	space, local string
	attrs        map[string]string
	namespaces   map[string]string
	children     []*node
	text         strings.Builder
}

func (n *node) is(space, local string) bool { return n.space == space && n.local == local }

func (n *node) attr(name string) string { return n.attrs[name] }

// child answers the first child with the given name, or nil.
func (n *node) child(space, local string) *node {
	for _, c := range n.children {
		if c.is(space, local) {
			return c
		}
	}
	return nil
}

// parseTree reads the whole document into a tree, refusing anything larger
// or deeper than the limits allow.
func parseTree(src []byte) (*node, error) {
	if len(src) > MaxInputBytes {
		return nil, fmt.Errorf("%w: %d bytes, at most %d", ErrTooLarge, len(src), MaxInputBytes)
	}
	dec := xml.NewDecoder(bytes.NewReader(src))
	dec.Strict = true

	var root *node
	var stack []*node
	count := 0
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrNotBPMN, err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			count++
			if count > maxElements {
				return nil, fmt.Errorf("%w: more than %d elements", ErrTooLarge, maxElements)
			}
			if len(stack) >= maxDepth {
				return nil, fmt.Errorf("%w: nested deeper than %d", ErrTooLarge, maxDepth)
			}
			n := &node{space: t.Name.Space, local: t.Name.Local, attrs: make(map[string]string, len(t.Attr))}
			if len(stack) > 0 {
				n.namespaces = stack[len(stack)-1].namespaces
			}
			copied := false
			for _, a := range t.Attr {
				if a.Name.Space == "xmlns" || a.Name.Space == "" && a.Name.Local == "xmlns" {
					if !copied {
						scope := map[string]string{}
						for k, v := range n.namespaces {
							scope[k] = v
						}
						n.namespaces = scope
						copied = true
					}
					prefix := a.Name.Local
					if a.Name.Space == "" {
						prefix = ""
					}
					n.namespaces[prefix] = a.Value
				}
			}
			for _, a := range t.Attr {
				// Attributes the builder reads carry no namespace in BPMN;
				// namespaced ones (xmlns, vendor extensions) are left out so a
				// vendor's "name" can never shadow the model's.
				if a.Name.Space == "" {
					n.attrs[a.Name.Local] = a.Value
				}
			}
			if len(stack) == 0 {
				if root != nil {
					return nil, fmt.Errorf("%w: more than one root element", ErrNotBPMN)
				}
				root = n
			} else {
				parent := stack[len(stack)-1]
				parent.children = append(parent.children, n)
			}
			stack = append(stack, n)
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if len(stack) > 0 {
				top := stack[len(stack)-1]
				// Bounded by MaxInputBytes already: the text cannot be longer
				// than the input it came from.
				top.text.Write(t)
			}
		}
	}
	if root == nil {
		return nil, fmt.Errorf("%w: empty document", ErrNotBPMN)
	}
	if !root.is(nsModel, "definitions") {
		return nil, fmt.Errorf("%w: root element is {%s}%s, want {%s}definitions",
			ErrNotBPMN, root.space, root.local, nsModel)
	}
	return root, nil
}
