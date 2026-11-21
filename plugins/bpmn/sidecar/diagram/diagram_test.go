package diagram

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

func loadOrder(t *testing.T) Diagram {
	t.Helper()
	src, err := os.ReadFile(diagramTestPath("testdata", "order.bpmn"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := Parse(src)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(doc.Diagrams) != 1 {
		t.Fatalf("want one diagram, got %d", len(doc.Diagrams))
	}
	return doc.Diagrams[0]
}

func shapeFor(t *testing.T, d Diagram, element string) Shape {
	t.Helper()
	for _, s := range d.Shapes {
		if s.Element == element {
			return s
		}
	}
	t.Fatalf("no shape draws %q", element)
	return Shape{}
}

func edgeFor(t *testing.T, d Diagram, element string) Edge {
	t.Helper()
	for _, e := range d.Edges {
		if e.Element == element {
			return e
		}
	}
	t.Fatalf("no edge draws %q", element)
	return Edge{}
}

// The decisions the reader would otherwise have to make about BPMN, made here.
func TestEveryShapeArrivesWithItsOutlineDecided(t *testing.T) {
	d := loadOrder(t)
	cases := []struct {
		element, form, border, symbol string
		dashed, filled                bool
		markers                       []string
	}{
		{"Start_Order", FormCircle, BorderSingle, "message", false, false, nil},
		{"Task_Check", FormRoundRect, BorderSingle, "user", false, false, []string{"sequential"}},
		{"GW_Ok", FormDiamond, BorderSingle, "exclusive", false, false, nil},
		{"Task_Ship", FormRoundRect, BorderSingle, "service", false, false, nil},
		{"BE_Timer", FormCircle, BorderDouble, "timer", true, false, nil},
		{"Sub_Reorder", FormRoundRect, BorderSingle, "", false, false, []string{"collapsed"}},
		{"End_Done", FormCircle, BorderThick, "", false, true, nil},
		{"DS_Stock", FormDataStore, BorderSingle, "", false, false, nil},
		{"TA_1", FormBracket, BorderSingle, "", false, false, nil},
		{"P_Shop", FormPool, BorderSingle, "", false, false, nil},
		{"Lane_Sales", FormLane, BorderSingle, "", false, false, nil},
	}
	for _, c := range cases {
		s := shapeFor(t, d, c.element)
		if s.Form != c.form || s.Border != c.border || s.Symbol != c.symbol ||
			s.Dashed != c.dashed || s.Filled != c.filled || strings.Join(s.Markers, ",") != strings.Join(c.markers, ",") {
			t.Errorf("%s: got form=%s border=%s symbol=%q dashed=%v filled=%v markers=%v, want %s %s %q %v %v %v",
				c.element, s.Form, s.Border, s.Symbol, s.Dashed, s.Filled, s.Markers,
				c.form, c.border, c.symbol, c.dashed, c.filled, c.markers)
		}
	}
}

// Line ends follow the flow's meaning, including the two that depend on
// something other than the flow itself: the default named by the gateway,
// and a condition that only gets its diamond when it leaves an activity.
//
// Named mutation: in build.go's sequenceFlow case, drop the
// `isActivity(src.local)` guard (set EndDiamond for every conditional flow)
// — the SF_Yes row goes red: a condition out of a gateway gets a diamond.
func TestEveryEdgeArrivesWithItsLineEndsDecided(t *testing.T) {
	d := loadOrder(t)
	cases := []struct{ element, stroke, start, end string }{
		{"SF_1", StrokeSolid, EndNone, EndArrowFilled},
		{"SF_2", StrokeSolid, EndDiamond, EndArrowFilled},
		{"SF_Yes", StrokeSolid, EndNone, EndArrowFilled},
		{"SF_No", StrokeSolid, EndSlash, EndArrowFilled},
		{"MF_Order", StrokeDashed, EndCircle, EndArrowOpen},
		{"A_1", StrokeDotted, EndNone, EndNone},
	}
	for _, c := range cases {
		e := edgeFor(t, d, c.element)
		if e.Stroke != c.stroke || e.Start != c.start || e.End != c.end {
			t.Errorf("%s: got %s %q→%q, want %s %q→%q", c.element, e.Stroke, e.Start, e.End, c.stroke, c.start, c.end)
		}
	}
	if pts := edgeFor(t, d, "SF_No").Points; len(pts) != 2 || pts[1] != (Point{X: 430, Y: 240}) {
		t.Errorf("SF_No waypoints: %v", pts)
	}
}

// Pools and lanes are painted first whatever order the DI lists them in.
func TestContainersArePaintedBeneathTheirContent(t *testing.T) {
	d := loadOrder(t)
	// Precondition: the fixture really lists a task before the pool, or this
	// proves nothing about ordering.
	src, _ := os.ReadFile(diagramTestPath("testdata", "order.bpmn"))
	if strings.Index(string(src), `"Task_Check_di"`) > strings.Index(string(src), `"P_Shop_di"`) {
		t.Fatal("fixture: Task_Check_di must be listed before P_Shop_di")
	}
	seenOther := false
	for _, s := range d.Shapes {
		container := s.Form == FormPool || s.Form == FormLane
		if container && seenOther {
			t.Fatalf("%s (%s) is painted after a non-container shape", s.Element, s.Form)
		}
		if !container {
			seenOther = true
		}
	}
}

// Labels arrive broken into lines that fit, placed where the modeller put
// them, or where BPMN convention puts them when the file does not say.
func TestLabelsArriveBrokenIntoLinesAndPlaced(t *testing.T) {
	d := loadOrder(t)

	start := shapeFor(t, d, "Start_Order")
	if start.Label == nil || start.Label.Y != 145 || start.Label.X != 164 {
		t.Errorf("Start_Order label should use the DI's own bounds, got %+v", start.Label)
	}

	check := shapeFor(t, d, "Task_Check")
	if check.Label == nil || len(check.Label.Lines) < 2 {
		t.Fatalf("a 33-character name in a 100-wide task must wrap, got %+v", check.Label)
	}
	for _, line := range check.Label.Lines {
		if w := float64(len([]rune(line))) * charWidth; w > check.W-10 {
			t.Errorf("line %q is %.0f wide, box is %.0f", line, w, check.W-10)
		}
	}

	pool := shapeFor(t, d, "P_Shop")
	if pool.Label == nil || !pool.Label.Vertical || pool.Label.W != 30 {
		t.Errorf("a pool's name goes in its left strip, vertically: %+v", pool.Label)
	}

	if l := edgeFor(t, d, "SF_No").Label; l == nil || l.Lines[0] != "no" {
		t.Errorf("SF_No should carry its name: %+v", l)
	}
	if edgeFor(t, d, "SF_1").Label != nil {
		t.Error("an unnamed flow has no label")
	}
}

// A vendor's namespaced attribute never shadows the model's own. The
// fixture's Task_Check carries camunda:name="vendor-name-must-not-win".
func TestAVendorAttributeDoesNotShadowTheModel(t *testing.T) {
	d := loadOrder(t)
	if got := shapeFor(t, d, "Task_Check").Name; got != "Check the order against the stock" {
		t.Errorf("name = %q", got)
	}
}

// What is not drawn is said. The fixture's Ghost_di points at an element
// that does not exist.
func TestWhatIsNotDrawnIsNamed(t *testing.T) {
	src, _ := os.ReadFile(diagramTestPath("testdata", "order.bpmn"))
	doc, err := Parse(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range doc.Diagrams[0].Shapes {
		if s.ID == "Ghost_di" {
			t.Fatal("a shape for an undefined element was drawn")
		}
	}
	found := false
	for _, w := range doc.Warnings {
		if strings.Contains(w, "Ghost_di") && strings.Contains(w, "Does_Not_Exist") {
			found = true
		}
	}
	if !found {
		t.Errorf("warnings do not name Ghost_di: %v", doc.Warnings)
	}
}

// No layout is guessed. A process without DI has nothing to draw, and says
// so — a made-up layout would look authoritative and be nobody's.
func TestAFileWithoutLayoutSaysSo(t *testing.T) {
	src := `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d">
	  <process id="p"><startEvent id="s"/></process></definitions>`
	doc, err := Parse([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Diagrams) != 0 {
		t.Fatalf("diagrams: %d", len(doc.Diagrams))
	}
	if len(doc.Warnings) != 1 || !strings.Contains(doc.Warnings[0], "BPMNDI") {
		t.Errorf("warnings: %v", doc.Warnings)
	}
}

// What is not BPMN, or too much of it, is refused with an error a caller can
// tell apart — not a half-built model.
func TestWhatIsNotBPMNIsRefused(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want error
	}{
		{"svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`, ErrNotBPMN},
		{"broken", `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process>`, ErrNotBPMN},
		{"empty", ``, ErrNotBPMN},
		{"too large", strings.Repeat(" ", MaxInputBytes+1), ErrTooLarge},
		{"too deep", `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">` +
			strings.Repeat("<a>", maxDepth+1) + strings.Repeat("</a>", maxDepth+1) + `</definitions>`, ErrTooLarge},
	}
	for _, c := range cases {
		doc, err := Parse([]byte(c.src))
		if !errors.Is(err, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, err, c.want)
		}
		if !reflect.DeepEqual(doc, Document{}) {
			t.Errorf("%s returned a partial model on refusal: %+v", c.name, doc)
		}
	}
}

// An entity declared in the document is never expanded: the decoder refuses
// it rather than reading a file or growing a billion laughs.
func TestADeclaredEntityIsNotExpanded(t *testing.T) {
	src := `<?xml version="1.0"?>
<!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" name="&x;"/>`
	doc, err := Parse([]byte(src))
	if err == nil && strings.Contains(doc.Name, "root") {
		t.Fatalf("entity expanded: %q", doc.Name)
	}
	if err == nil {
		t.Fatalf("an undeclared-to-the-decoder entity should be refused, got name %q", doc.Name)
	}
	if !reflect.DeepEqual(doc, Document{}) {
		t.Fatalf("entity refusal returned partial model: %+v", doc)
	}
}

// A coordinate JSON cannot carry is refused per shape, never passed on: one
// NaN would make the whole reply unmarshallable.
func TestANonFiniteCoordinateIsDroppedNotPassedOn(t *testing.T) {
	src := `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
	  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
	  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="d">
	  <process id="p"><task id="t" name="T"/><task id="u"/></process>
	  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="P" bpmnElement="p">
	    <bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="NaN" y="0" width="100" height="80"/></bpmndi:BPMNShape>
	    <bpmndi:BPMNShape id="u_di" bpmnElement="u"><dc:Bounds x="0" y="+Inf" width="100" height="80"/></bpmndi:BPMNShape>
	  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>`
	doc, err := Parse([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(doc); err != nil {
		t.Fatalf("reply does not marshal: %v", err)
	}
	if n := len(doc.Diagrams[0].Shapes); n != 0 {
		t.Errorf("shapes with non-finite bounds were kept: %d", n)
	}
}

func TestWrapSplitsAWordWiderThanTheLine(t *testing.T) {
	lines := wrap("calculateInvoiceTotalsForTheQuarter", 60)
	if len(lines) < 2 {
		t.Fatalf("lines: %v", lines)
	}
	for _, l := range lines {
		if float64(len([]rune(l)))*charWidth > 60 {
			t.Errorf("line %q too long", l)
		}
	}
	if got := wrap(strings.Repeat("word ", 200), 60); len(got) != maxLabelLines || !strings.HasSuffix(got[len(got)-1], "…") {
		t.Errorf("a long name is cut at %d lines with an ellipsis, got %d: %v", maxLabelLines, len(got), got)
	}
}

// A box the file gives is trusted with its words: "repo.read" in a box the
// estimate calls too narrow stays one word, while the same name in a
// convention box (no BPMNLabel) is still split rather than spilling out.
func TestAWordInTheFilesOwnLabelBoxIsNotSplit(t *testing.T) {
	src := `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
	  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
	  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
	  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d">
	  <process id="p"><task id="a"/><task id="b"/>
	    <sequenceFlow id="f" name="repo.read" sourceRef="a" targetRef="b"/></process>
	  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="P" bpmnElement="p">
	    <bpmndi:BPMNEdge id="f_di" bpmnElement="f"><di:waypoint x="0" y="0"/><di:waypoint x="100" y="0"/>
	      <bpmndi:BPMNLabel><dc:Bounds x="10" y="5" width="40" height="14"/></bpmndi:BPMNLabel></bpmndi:BPMNEdge>
	  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>`
	doc, err := Parse([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	// Precondition: the estimate really does call this box too narrow, or
	// the case proves nothing about which wrap was used.
	if got := wrap("repo.read", 40); len(got) < 2 {
		t.Fatalf("fixture: wrap should split repo.read at width 40, got %v", got)
	}
	l := doc.Diagrams[0].Edges[0].Label
	if l == nil || strings.Join(l.Lines, "|") != "repo.read" {
		t.Fatalf("label = %+v, want the single line repo.read", l)
	}
}

func TestBoundsEncloseEverythingDrawn(t *testing.T) {
	d := loadOrder(t)
	b := d.Bounds
	for _, s := range d.Shapes {
		if s.X < b.X || s.Y < b.Y || s.X+s.W > b.X+b.W || s.Y+s.H > b.Y+b.H {
			t.Errorf("%s at %+v lies outside %+v", s.Element, s.Rect, b)
		}
	}
}

// The drawing model the TypeScript side is tested against is the one this
// library produces, not a hand-written imitation: a fixture written by hand
// would let the two sides agree on a shape Go never answers. Regenerate with
// BPMN_UPDATE_FIXTURE=1 go test ./plugins/bpmn/sidecar/diagram.
func TestTheBrowserFixtureIsWhatTheLibraryAnswers(t *testing.T) {
	src, err := os.ReadFile(diagramTestPath("testdata", "order.bpmn"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := Parse(src)
	if err != nil {
		t.Fatal(err)
	}
	got, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	fixture := diagramModulePath(t, "plugins", "bpmn", "src", "testdata", "order.json")
	if os.Getenv("BPMN_UPDATE_FIXTURE") == "1" {
		if err := os.WriteFile(fixture, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatalf("%v — run with BPMN_UPDATE_FIXTURE=1 to write it", err)
	}
	// Compared as values, not bytes: the file sits in a TypeScript tree a
	// formatter may reflow, and a reflowed array is the same model. Measured:
	// prettier --write turned this test red without changing one value.
	var wantDoc, gotDoc any
	if err := json.Unmarshal(want, &wantDoc); err != nil {
		t.Fatalf("%s is not JSON: %v", fixture, err)
	}
	if err := json.Unmarshal(got, &gotDoc); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(wantDoc, gotDoc) {
		t.Fatalf("%s is stale — run with BPMN_UPDATE_FIXTURE=1 and review the diff", fixture)
	}
}
