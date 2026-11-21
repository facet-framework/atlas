// Package diagram turns a BPMN 2.0 XML document into a drawing model: every
// shape with its outline, border, symbol and markers already decided, every
// edge with its waypoints and line ends, every label already broken into
// lines. What reaches the browser is geometry and a small closed vocabulary,
// never BPMN semantics — the reader draws what it is told and does not have
// to know that a boundary event with cancelActivity="false" is dashed.
package diagram

// Document is what one .bpmn file becomes.
type Document struct {
	// ID and Name come from <definitions>. Name is often empty.
	ID   string `json:"id"`
	Name string `json:"name"`
	// Diagrams holds one entry per <bpmndi:BPMNDiagram>, in file order. A
	// collaboration and each of its processes can each have their own.
	Diagrams []Diagram `json:"diagrams"`
	// Warnings names what was found and not drawn, or drawn as a stand-in —
	// a DI entry pointing at an element that does not exist, an element kind
	// this model has no outline for. Empty means nothing was dropped, not
	// that nobody looked.
	Warnings []string `json:"warnings"`
}

// Diagram is one drawable plane.
type Diagram struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Bounds is the box every shape, waypoint and label fits in, with a
	// margin — the viewBox the reader can use as is.
	Bounds Rect `json:"bounds"`
	// Shapes are in paint order: pools, then lanes, then everything else in
	// the order the file's DI lists them, which is the modeller's own z-order.
	Shapes []Shape `json:"shapes"`
	// Edges are painted after every shape.
	Edges []Edge `json:"edges"`
}

// Rect is an axis-aligned box in diagram units (the file's own pixels).
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Point is one waypoint.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// The outlines a shape can have. A closed list: the reader has one drawing
// routine per entry and none for anything else.
const (
	FormRoundRect = "roundrect" // activities
	FormCircle    = "circle"    // events
	FormDiamond   = "diamond"   // gateways
	FormDocument  = "document"  // data objects, data inputs and outputs
	FormDataStore = "datastore" // data stores
	FormBracket   = "bracket"   // text annotations
	FormGroup     = "group"     // groups
	FormPool      = "pool"      // participants
	FormLane      = "lane"      // lanes
	FormRect      = "rect"      // an element kind this model has no outline for
)

// Border styles.
const (
	BorderSingle = "single"
	BorderThick  = "thick"  // end events, call activities
	BorderDouble = "double" // intermediate and boundary events, transactions
	BorderDashed = "dashed" // non-interrupting events (double ring for intermediates, see Dashed)
	BorderDotted = "dotted" // event subprocesses
)

// Shape is one drawn element.
type Shape struct {
	// ID is the DI shape's id; Element is the BPMN element it draws. Element
	// is the id a reader would search for.
	ID      string `json:"id"`
	Element string `json:"element"`
	// Kind is the BPMN element's own local name ("userTask", "boundaryEvent"),
	// for a tooltip or a filter — the reader draws from Form, never from Kind.
	Kind string `json:"kind"`
	Name string `json:"name"`
	Form string `json:"form"`
	Rect
	Border string `json:"border"`
	// Dashed is set for a non-interrupting event: its rings are dashed.
	Dashed bool `json:"dashed,omitempty"`
	// Symbol is the glyph inside the outline: a task type ("user",
	// "service"), an event trigger ("message", "timer"), a gateway marker
	// ("exclusive", "parallel"). Empty means none.
	Symbol string `json:"symbol,omitempty"`
	// Filled is set when the symbol is drawn solid: a throwing event, as
	// opposed to a catching one.
	Filled bool `json:"filled,omitempty"`
	// Markers are the small glyphs along an activity's bottom edge, in the
	// order they are drawn left to right: "loop", "parallel", "sequential",
	// "compensation", "adhoc", "collapsed". On a pool, "parallel" marks a
	// participant multiplicity.
	Markers []string `json:"markers,omitempty"`
	// Collection marks a data object that stands for a collection.
	Collection bool `json:"collection,omitempty"`
	// Label is where the name goes, already broken into lines. Nil when the
	// element has no name.
	Label *Label `json:"label,omitempty"`
}

// Line ends.
const (
	EndNone        = ""
	EndArrowFilled = "arrow"      // sequence flow
	EndArrowOpen   = "open-arrow" // message flow, directed association
	EndCircle      = "circle"     // message flow source
	EndDiamond     = "diamond"    // conditional sequence flow out of an activity
	EndSlash       = "slash"      // default sequence flow
)

// Strokes.
const (
	StrokeSolid  = "solid"
	StrokeDashed = "dashed"
	StrokeDotted = "dotted"
)

// Edge is one drawn connection.
type Edge struct {
	ID      string  `json:"id"`
	Element string  `json:"element"`
	Kind    string  `json:"kind"`
	Name    string  `json:"name"`
	Points  []Point `json:"points"`
	Stroke  string  `json:"stroke"`
	// Start and End are the decorations at the first and the last waypoint.
	Start string `json:"start,omitempty"`
	End   string `json:"end,omitempty"`
	Label *Label `json:"label,omitempty"`
}

// Label is text already placed: a box and the lines inside it. The reader
// draws one line per entry at LineHeight intervals, centred in the box.
type Label struct {
	Rect
	Lines []string `json:"lines"`
	// Vertical is set for a pool's or lane's name, written bottom-to-top
	// along the left strip. The box is then the strip itself.
	Vertical bool `json:"vertical,omitempty"`
	// Align is "left" for a text annotation, whose text starts at the
	// bracket; empty means centred.
	Align string `json:"align,omitempty"`
}

// Typography the line breaking assumes. The reader must draw with the same
// size, or the measured lines will not fit the box they were measured for.
const (
	FontSize   = 11.0
	LineHeight = 13.0
	// charWidth is an average advance for a proportional sans at FontSize.
	// An estimate, not a measurement: Go has no font here. It errs wide so a
	// line that was judged to fit does fit.
	charWidth = 6.2
)
