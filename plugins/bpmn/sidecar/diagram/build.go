package diagram

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// maxWarnings bounds the warning list. A file with ten thousand dangling DI
// entries says so in its count, not in ten thousand lines.
const maxWarnings = 50

// margin is the space Bounds leaves around the drawing.
const margin = 20

// Parse reads one BPMN 2.0 document and answers its drawing model.
func Parse(src []byte) (Document, error) {
	root, err := parseTree(src)
	if err != nil {
		return Document{}, err
	}
	b := &builder{elements: map[string]*node{}, parentKind: map[string]string{}, defaults: map[string]bool{}, namespace: root.attr("targetNamespace")}
	b.index(root, "definitions")

	doc := Document{ID: root.attr("id"), Name: root.attr("name"), Diagrams: []Diagram{}}
	for _, c := range root.children {
		if c.is(nsBPMNDI, "BPMNDiagram") {
			doc.Diagrams = append(doc.Diagrams, b.diagram(c))
		}
	}
	if len(doc.Diagrams) == 0 {
		b.warn("the file carries no diagram interchange (BPMNDI); there is nothing to draw, and no layout is guessed")
	}
	if b.dropped > 0 {
		b.warnings = append(b.warnings, fmt.Sprintf("%d further warnings not listed", b.dropped))
	}
	doc.Warnings = b.warnings
	if doc.Warnings == nil {
		doc.Warnings = []string{}
	}
	return doc, nil
}

type builder struct {
	namespace string
	// elements holds every semantic element with an id, by id.
	elements map[string]*node
	// parentKind is the local name of the element each id sits directly in.
	parentKind map[string]string
	// defaults holds every sequence flow some gateway or activity names as
	// its default.
	defaults map[string]bool
	warnings []string
	dropped  int
}

func (b *builder) warn(format string, args ...any) {
	if len(b.warnings) >= maxWarnings {
		b.dropped++
		return
	}
	b.warnings = append(b.warnings, fmt.Sprintf(format, args...))
}

// index records every model element with an id. The DI half of the file is
// skipped: its ids name shapes, not elements, and must not shadow one.
func (b *builder) index(n *node, parent string) {
	for _, c := range n.children {
		if c.space != nsModel {
			continue
		}
		if id := c.attr("id"); id != "" {
			if _, dup := b.elements[id]; dup {
				b.warn("%s: id used twice; the first element keeps it", id)
			} else {
				b.elements[id] = c
				b.parentKind[id] = parent
			}
		}
		if d := c.attr("default"); d != "" {
			b.defaults[d] = true
		}
		b.index(c, c.local)
	}
}

func (b *builder) diagram(d *node) Diagram {
	out := Diagram{ID: d.attr("id"), Name: d.attr("name"), Shapes: []Shape{}, Edges: []Edge{}}
	plane := d.child(nsBPMNDI, "BPMNPlane")
	if plane == nil {
		b.warn("%s: diagram without a plane", out.ID)
		return out
	}
	var pools, lanes, rest []Shape
	for _, c := range plane.children {
		switch {
		case c.is(nsBPMNDI, "BPMNShape"):
			s, ok := b.shape(c)
			if !ok {
				continue
			}
			switch s.Form {
			case FormPool:
				pools = append(pools, s)
			case FormLane:
				lanes = append(lanes, s)
			default:
				rest = append(rest, s)
			}
		case c.is(nsBPMNDI, "BPMNEdge"):
			if e, ok := b.edge(c); ok {
				out.Edges = append(out.Edges, e)
			}
		}
	}
	// Pools and lanes first, whatever order the file lists them in: a lane
	// painted over a task would hide it, and modellers do write lanes last.
	out.Shapes = append(append(append(out.Shapes, pools...), lanes...), rest...)
	out.Bounds = bounds(out)
	return out
}

// shape builds one drawn element, or reports why it is skipped.
func (b *builder) shape(di *node) (Shape, bool) {
	ref := di.attr("bpmnElement")
	s := Shape{ID: di.attr("id"), Element: ref}
	el, ok := b.elements[ref]
	if !ok {
		b.warn("%s: draws %q, which the file does not define", s.ID, ref)
		return s, false
	}
	r, ok := readBounds(di.child(nsDC, "Bounds"))
	if !ok {
		b.warn("%s: no usable bounds", s.ID)
		return s, false
	}
	s.Rect = r
	s.Name = strings.TrimSpace(el.attr("name"))
	classify(&s, el, di, b.warn)
	if eventKinds[el.local] {
		resolved := *el
		resolved.children = nil
		for _, child := range el.children {
			if child.is(nsModel, "eventDefinitionRef") {
				ref := strings.TrimSpace(child.text.String())
				if prefix, local, qualified := strings.Cut(ref, ":"); qualified {
					if child.namespaces[prefix] == "" || child.namespaces[prefix] != b.namespace {
						b.warn("%s: eventDefinitionRef %q has no local target namespace", s.Element, ref)
						resolved.children = append(resolved.children, child)
						continue
					}
					ref = local
				}
				if def := b.elements[ref]; def != nil && eventDefinitionSymbols[def.local] != "" {
					resolved.children = append(resolved.children, def)
				} else {
					b.warn("%s: eventDefinitionRef %q cannot be resolved", s.Element, ref)
					resolved.children = append(resolved.children, child)
				}
			} else {
				resolved.children = append(resolved.children, child)
			}
		}
		classifyEvent(&s, &resolved)
	}
	s.Label = shapeLabel(s, di)
	return s, true
}

// edge builds one drawn connection, or reports why it is skipped.
func (b *builder) edge(di *node) (Edge, bool) {
	ref := di.attr("bpmnElement")
	e := Edge{ID: di.attr("id"), Element: ref}
	el, ok := b.elements[ref]
	if !ok {
		b.warn("%s: draws %q, which the file does not define", e.ID, ref)
		return e, false
	}
	for _, c := range di.children {
		if c.is(nsDI, "waypoint") {
			x, okx := num(c.attr("x"))
			y, oky := num(c.attr("y"))
			if okx && oky {
				e.Points = append(e.Points, Point{X: x, Y: y})
			}
		}
	}
	if len(e.Points) < 2 {
		b.warn("%s: fewer than two waypoints", e.ID)
		return e, false
	}
	e.Kind = el.local
	e.Name = strings.TrimSpace(el.attr("name"))
	e.Stroke = StrokeSolid
	switch el.local {
	case "sequenceFlow":
		e.End = EndArrowFilled
		switch {
		case b.defaults[ref]:
			e.Start = EndSlash
		case el.child(nsModel, "conditionExpression") != nil:
			// The mini-diamond only marks a condition leaving an activity;
			// out of a gateway the condition is the gateway's business.
			if src, ok := b.elements[el.attr("sourceRef")]; ok && isActivity(src.local) {
				e.Start = EndDiamond
			}
		}
	case "messageFlow":
		e.Stroke = StrokeDashed
		e.Start = EndCircle
		e.End = EndArrowOpen
	case "association", "dataInputAssociation", "dataOutputAssociation":
		e.Stroke = StrokeDotted
		switch {
		case el.local != "association":
			e.End = EndArrowOpen
		case el.attr("associationDirection") == "One":
			e.End = EndArrowOpen
		case el.attr("associationDirection") == "Both":
			e.Start, e.End = EndArrowOpen, EndArrowOpen
		}
	case "conversationLink":
		e.Stroke = StrokeSolid
	default:
		b.warn("%s: no line style for <%s>, drawn as a plain line", e.ID, el.local)
	}
	e.Label = edgeLabel(e, di)
	return e, true
}

// shapeLabel places a shape's name. The DI's own label bounds win where the
// file gives them — that is where the modeller put the text. Otherwise the
// position follows the BPMN convention for the outline.
func shapeLabel(s Shape, di *node) *Label {
	if s.Name == "" {
		return nil
	}
	if s.Form == FormPool || s.Form == FormLane {
		// The strip along the left edge, 30 units wide, text rotated.
		return &Label{
			Rect:     Rect{X: s.X, Y: s.Y, W: 30, H: s.H},
			Lines:    wrap(s.Name, s.H-10),
			Vertical: true,
		}
	}
	if r, ok := diLabelBounds(di); ok {
		return &Label{Rect: r, Lines: wrapWords(s.Name, math.Max(r.W, 30))}
	}
	switch s.Form {
	case FormRoundRect:
		lines := wrap(s.Name, s.W-10)
		// An expanded subprocess carries its name at the top, not centred
		// over its content.
		if !contains(s.Markers, "collapsed") && subprocessKinds[s.Kind] {
			return &Label{Rect: Rect{X: s.X + 5, Y: s.Y + 5, W: s.W - 10, H: float64(len(lines)) * LineHeight}, Lines: lines}
		}
		top, bottom := s.Y+5, s.Y+s.H-5
		if s.Symbol != "" {
			top += 20
		}
		if len(s.Markers) > 0 {
			bottom -= 16
		}
		// Names without explicit DI labels occupy the space between the task
		// icon and its bottom markers, not the full activity box.
		if bottom < top {
			bottom = top
		}
		return &Label{Rect: Rect{X: s.X + 5, Y: top, W: s.W - 10, H: bottom - top}, Lines: lines}
	case FormBracket:
		lines := wrap(s.Name, s.W-10)
		return &Label{Rect: Rect{X: s.X + 5, Y: s.Y, W: s.W - 10, H: s.H}, Lines: lines, Align: "left"}
	case FormGroup:
		lines := wrap(s.Name, s.W)
		return &Label{Rect: Rect{X: s.X, Y: s.Y - float64(len(lines))*LineHeight - 4, W: s.W, H: float64(len(lines)) * LineHeight}, Lines: lines}
	default:
		// Events, gateways, data: underneath, 90 units wide, centred.
		const w = 90.0
		lines := wrap(s.Name, w)
		return &Label{Rect: Rect{X: s.X + s.W/2 - w/2, Y: s.Y + s.H + 5, W: w, H: float64(len(lines)) * LineHeight}, Lines: lines}
	}
}

// edgeLabel places a connection's name: the DI's bounds if given, otherwise
// beside the middle of the path.
func edgeLabel(e Edge, di *node) *Label {
	if e.Name == "" {
		return nil
	}
	if r, ok := diLabelBounds(di); ok {
		return &Label{Rect: r, Lines: wrapWords(e.Name, math.Max(r.W, 30))}
	}
	const w = 90.0
	mid := midpoint(e.Points)
	lines := wrap(e.Name, w)
	return &Label{Rect: Rect{X: mid.X - w/2, Y: mid.Y - float64(len(lines))*LineHeight - 4, W: w, H: float64(len(lines)) * LineHeight}, Lines: lines}
}

func diLabelBounds(di *node) (Rect, bool) {
	lbl := di.child(nsBPMNDI, "BPMNLabel")
	if lbl == nil {
		return Rect{}, false
	}
	return readBounds(lbl.child(nsDC, "Bounds"))
}

// midpoint answers the point halfway along a polyline, by length.
func midpoint(pts []Point) Point {
	total := 0.0
	for i := 1; i < len(pts); i++ {
		total += dist(pts[i-1], pts[i])
	}
	half := total / 2
	for i := 1; i < len(pts); i++ {
		d := dist(pts[i-1], pts[i])
		if half <= d && d > 0 {
			t := half / d
			return Point{X: pts[i-1].X + t*(pts[i].X-pts[i-1].X), Y: pts[i-1].Y + t*(pts[i].Y-pts[i-1].Y)}
		}
		half -= d
	}
	return pts[len(pts)-1]
}

func dist(a, b Point) float64 { return math.Hypot(b.X-a.X, b.Y-a.Y) }

func readBounds(n *node) (Rect, bool) {
	if n == nil {
		return Rect{}, false
	}
	x, ok1 := num(n.attr("x"))
	y, ok2 := num(n.attr("y"))
	w, ok3 := num(n.attr("width"))
	h, ok4 := num(n.attr("height"))
	if !(ok1 && ok2 && ok3 && ok4) || w < 0 || h < 0 {
		return Rect{}, false
	}
	return Rect{X: x, Y: y, W: w, H: h}, true
}

// num parses a coordinate, refusing what JSON cannot carry: a NaN or an
// infinity would make the whole reply unmarshallable.
func num(s string) (float64, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}

// bounds answers the box around everything drawn, with a margin.
func bounds(d Diagram) Rect {
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	add := func(r Rect) {
		minX, minY = math.Min(minX, r.X), math.Min(minY, r.Y)
		maxX, maxY = math.Max(maxX, r.X+r.W), math.Max(maxY, r.Y+r.H)
	}
	for _, s := range d.Shapes {
		add(s.Rect)
		if s.Label != nil {
			add(s.Label.Rect)
		}
	}
	for _, e := range d.Edges {
		for _, p := range e.Points {
			add(Rect{X: p.X, Y: p.Y})
		}
		if e.Label != nil {
			add(e.Label.Rect)
		}
	}
	if math.IsInf(minX, 1) {
		return Rect{}
	}
	return Rect{X: minX - margin, Y: minY - margin, W: maxX - minX + 2*margin, H: maxY - minY + 2*margin}
}

func contains(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
