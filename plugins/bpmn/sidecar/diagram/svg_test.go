package diagram

import (
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type svgNode struct {
	tag      string
	attrs    map[string]string
	children []*svgNode
}

func parseSVG(t *testing.T, src string) *svgNode {
	t.Helper()
	dec := xml.NewDecoder(strings.NewReader(src))
	var root *svgNode
	var stack []*svgNode
	for {
		token, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("invalid SVG: %v", err)
		}
		switch value := token.(type) {
		case xml.StartElement:
			n := &svgNode{tag: value.Name.Local, attrs: map[string]string{}}
			for _, a := range value.Attr {
				n.attrs[a.Name.Local] = a.Value
			}
			if len(stack) == 0 {
				root = n
			} else {
				p := stack[len(stack)-1]
				p.children = append(p.children, n)
			}
			stack = append(stack, n)
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		}
	}
	if root == nil || root.tag != "svg" {
		t.Fatal("no SVG root")
	}
	return root
}
func (n *svgNode) find(key, value string) *svgNode {
	if n.attrs[key] == value {
		return n
	}
	for _, c := range n.children {
		if found := c.find(key, value); found != nil {
			return found
		}
	}
	return nil
}
func (n *svgNode) count(tag string) int {
	total := 0
	if n.tag == tag {
		total++
	}
	for _, c := range n.children {
		total += c.count(tag)
	}
	return total
}
func (n *svgNode) drawn() bool {
	for _, c := range n.children {
		if inDrawing(c.tag, []string{"path", "rect", "circle", "ellipse", "polygon", "polyline", "line"}) || c.drawn() {
			return true
		}
	}
	return false
}
func drawingFixture(shape Shape) Diagram {
	return Diagram{ID: "fixture", Name: "Notation", Bounds: Rect{X: -20, Y: -20, W: 400, H: 160}, Shapes: []Shape{shape}}
}
func taskFixture() Shape {
	return Shape{Element: "s", Name: "A source label", Form: FormRoundRect, Border: BorderSingle, Rect: Rect{X: 10, Y: 10, W: 120, H: 80}}
}

// This is tied to the parser's vocabulary, not the renderer's allowlist: a new
// parser symbol must get actual SVG geometry before this test can pass.
func TestEveryParserSymbolHasGraphicalGeometry(t *testing.T) {
	cases := map[string][]string{FormRoundRect: {"receive-instantiate"}, FormCircle: {"multiple", "parallel-multiple"}, FormDiamond: {"event-based-start", "parallel-event-based-start"}, FormDocument: {"input", "output"}}
	for _, symbol := range taskSymbols {
		if symbol != "" {
			cases[FormRoundRect] = append(cases[FormRoundRect], symbol)
		}
	}
	for _, symbol := range eventDefinitionSymbols {
		cases[FormCircle] = append(cases[FormCircle], symbol)
	}
	for _, symbol := range gatewaySymbols {
		cases[FormDiamond] = append(cases[FormDiamond], symbol)
	}
	for form, symbols := range cases {
		for _, symbol := range symbols {
			for _, filled := range []bool{false, true} {
				t.Run(form+"/"+symbol+"/"+map[bool]string{false: "catch", true: "throw"}[filled], func(t *testing.T) {
					s := taskFixture()
					s.Form = form
					s.Symbol = symbol
					s.Filled = filled
					if form == FormCircle || form == FormDiamond {
						s.W = 50
						s.H = 50
					}
					out, err := RenderSVG(drawingFixture(s), "notation")
					if err != nil {
						t.Fatal(err)
					}
					root := parseSVG(t, out)
					glyph := root.find("data-glyph", symbol)
					if glyph == nil || !glyph.drawn() {
						t.Fatal("symbol replaced by metadata or prose", out)
					}
					if root.find("data-testid", "bpmn-shape").find("data-glyph", symbol) == nil {
						t.Fatal("glyph detached from its shape")
					}
				})
			}
		}
	}
}

func TestEveryActivityAndCollectionMarkerHasGeometry(t *testing.T) {
	for _, marker := range []string{"loop", "parallel", "sequential", "compensation", "adhoc", "collapsed"} {
		t.Run(marker, func(t *testing.T) {
			s := taskFixture()
			s.Markers = []string{marker}
			out, err := RenderSVG(drawingFixture(s), "markers")
			if err != nil {
				t.Fatal(err)
			}
			node := parseSVG(t, out).find("data-marker", marker)
			if node == nil || !node.drawn() {
				t.Fatal("missing marker geometry", out)
			}
		})
	}
	s := taskFixture()
	s.Form = FormDocument
	s.Collection = true
	out, err := RenderSVG(drawingFixture(s), "collection")
	if err != nil {
		t.Fatal(err)
	}
	if node := parseSVG(t, out).find("data-marker", "parallel"); node == nil || !node.drawn() {
		t.Fatal("missing collection marker")
	}
}

func TestRealModelKeepsItsShapesGlyphsMarkersAndFlowDecorations(t *testing.T) {
	d := loadOrder(t)
	out, err := RenderSVG(d, "order")
	if err != nil {
		t.Fatal(err)
	}
	svg := parseSVG(t, out)
	for _, s := range d.Shapes {
		node := svg.find("data-element", s.Element)
		if node == nil || !node.drawn() {
			t.Fatalf("shape %s missing", s.Element)
		}
		if s.Symbol != "" {
			glyph := node.find("data-glyph", s.Symbol)
			if glyph == nil || !glyph.drawn() {
				t.Fatalf("glyph %s missing", s.Element)
			}
		}
		for _, m := range s.Markers {
			if node.find("data-marker", m) == nil {
				t.Fatalf("marker %s missing", s.Element)
			}
		}
	}
	store := svg.find("data-element", "DS_Stock")
	if store.count("ellipse") != 1 || store.count("path") == 0 {
		t.Fatal("data store rendered as a rectangle")
	}
	note := svg.find("data-element", "TA_1")
	if label := note.find("data-testid", "bpmn-label"); label == nil || label.attrs["text-anchor"] != "start" {
		t.Fatal("annotation alignment lost")
	}
	conditional := svg.find("data-element", "SF_2")
	if conditional.find("marker-start", "url(#order-diamond)") == nil {
		t.Fatal("conditional flow lost its diamond")
	}
	fallback := svg.find("data-element", "SF_No")
	slash := fallback.find("data-testid", "bpmn-slash")
	if slash == nil || slash.attrs["x1"] == slash.attrs["x2"] && slash.attrs["y1"] == slash.attrs["y2"] {
		t.Fatal("default-flow slash missing")
	}
	message := svg.find("data-element", "MF_Order")
	if message.find("marker-start", "url(#order-circle)") == nil || message.find("marker-end", "url(#order-open-arrow)") == nil {
		t.Fatal("message flow decorations missing")
	}
	if svg.find("data-element", "BE_Timer").attrs["data-dashed"] != "true" {
		t.Fatal("non-interrupting timer ring not dashed")
	}
	// An owned, bounded browser artifact can be requested explicitly; callers
	// remove it after the rendering pass, never keep a raw evidence tree.
	if dir := os.Getenv("FACET_BPMN_SVG_TEST_OUT"); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "order.svg"), []byte(out), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestUnknownDrawingVocabularyIsRefusedRatherThanDropped(t *testing.T) {
	for _, change := range []func(*Shape){func(s *Shape) { s.Symbol = "new-task" }, func(s *Shape) { s.Markers = []string{"missing"} }, func(s *Shape) { s.Form = "unknown" }} {
		s := taskFixture()
		change(&s)
		if _, err := RenderSVG(drawingFixture(s), "valid"); err == nil {
			t.Fatal("unknown graphical vocabulary silently accepted")
		}
	}
	if _, err := RenderSVG(drawingFixture(taskFixture()), `x" onload="bad`); err == nil {
		t.Fatal("unsafe marker prefix accepted")
	}
	s := taskFixture()
	s.Name = `<script>alert('x')</script>`
	s.Label = &Label{Rect: Rect{X: 15, Y: 20, W: 100, H: 40}, Lines: []string{s.Name}}
	out, err := RenderSVG(drawingFixture(s), "safe")
	if err != nil {
		t.Fatal(err)
	}
	svg := parseSVG(t, out)
	if svg.count("script") != 0 || !strings.Contains(out, "&lt;script&gt;") {
		t.Fatal("source label became SVG markup")
	}
}

func TestGraphicalNotationGallery(t *testing.T) {
	d := Diagram{ID: "gallery", Name: "BPMN notation", Bounds: Rect{X: 0, Y: 0, W: 980, H: 1100}}
	var forms []string
	for form := range drawingSymbols {
		forms = append(forms, form)
	}
	sort.Strings(forms)
	i := 0
	for _, form := range forms {
		for _, symbol := range drawingSymbols[form] {
			s := taskFixture()
			s.Element = "notation-" + form + "-" + symbol
			s.Name = form + " / " + symbol
			s.Form = form
			s.Symbol = symbol
			s.X = 30 + float64(i%7)*135
			s.Y = 30 + float64(i/7)*125
			if form == FormCircle || form == FormDiamond {
				s.W = 44
				s.H = 44
			}
			s.Label = &Label{Rect: Rect{X: s.X, Y: s.Y + 85, W: 120, H: 26}, Lines: []string{form, symbol}}
			d.Shapes = append(d.Shapes, s)
			i++
		}
	}
	for _, m := range []string{"loop", "parallel", "sequential", "compensation", "adhoc", "collapsed"} {
		s := taskFixture()
		s.Element = "marker-" + m
		s.X = 30 + float64(i%7)*135
		s.Y = 30 + float64(i/7)*125
		s.Markers = []string{m}
		s.Label = &Label{Rect: Rect{X: s.X, Y: s.Y + 85, W: 120, H: 26}, Lines: []string{m}}
		d.Shapes = append(d.Shapes, s)
		i++
	}
	d.Bounds.H = mathCeilRow(i)*125 + 35
	out, err := RenderSVG(d, "gallery")
	if err != nil {
		t.Fatal(err)
	}
	parseSVG(t, out)
	if dir := os.Getenv("FACET_BPMN_SVG_TEST_OUT"); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "gallery.svg"), []byte(out), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
func mathCeilRow(n int) float64 { return float64((n + 6) / 7) }

func TestSharedEventDefinitionsResolveToTheirActualGlyphs(t *testing.T) {
	src := `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:local="urn:local" xmlns:foreign="urn:other" targetNamespace="urn:local" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
 <messageEventDefinition id="SharedMessage"/><errorEventDefinition id="SharedError"/>
 <process id="p">
  <startEvent id="start"><eventDefinitionRef>local:SharedMessage</eventDefinitionRef></startEvent>
  <endEvent id="end"><eventDefinitionRef>SharedError</eventDefinitionRef></endEvent>
  <startEvent id="foreign"><eventDefinitionRef>foreign:SharedMessage</eventDefinitionRef></startEvent>
 </process>
 <bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane bpmnElement="p">
 <bpmndi:BPMNShape id="sd" bpmnElement="start"><dc:Bounds x="0" y="0" width="36" height="36"/></bpmndi:BPMNShape>
 <bpmndi:BPMNShape id="ed" bpmnElement="end"><dc:Bounds x="100" y="0" width="36" height="36"/></bpmndi:BPMNShape>
 <bpmndi:BPMNShape id="fd" bpmnElement="foreign"><dc:Bounds x="200" y="0" width="36" height="36"/></bpmndi:BPMNShape>
 </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>`
	model, err := Parse([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	d := model.Diagrams[0]
	if shapeFor(t, d, "start").Symbol != "message" || shapeFor(t, d, "end").Symbol != "error" {
		t.Fatal("shared trigger type lost", d.Shapes)
	}
	if shapeFor(t, d, "foreign").Symbol != "" || len(model.Warnings) != 1 {
		t.Fatal("foreign definition guessed as local", model.Warnings)
	}
	out, err := RenderSVG(d, "shared")
	if err != nil {
		t.Fatal(err)
	}
	svg := parseSVG(t, out)
	if svg.find("data-element", "start").find("data-glyph", "message") == nil || svg.find("data-element", "end").find("data-glyph", "error") == nil {
		t.Fatal("resolved event lost its graphical trigger")
	}
}

func TestDefaultTaskLabelStaysBetweenItsIconAndMarkers(t *testing.T) {
	d := loadOrder(t)
	s := shapeFor(t, d, "Task_Check")
	if s.Label.Y < s.Y+25 || s.Label.Y+s.Label.H > s.Y+s.H-20 {
		t.Fatalf("label overlaps graphical notation: %+v", s.Label)
	}
}
