package diagram

import (
	"fmt"
	"html"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// RenderSVG draws the complete geometry vocabulary emitted by Parse, including
// glyphs, activity markers, collection markers, rings and every flow decoration.
// It shares the Atlas drawing conventions (src/Zeichnung.tsx) without needing a
// browser runtime. Unknown vocabulary is an error rather than an omitted icon.
// prefix scopes SVG marker ids when several diagrams share an HTML page.
func RenderSVG(d Diagram, prefix string) (string, error) {
	if !svgPrefix.MatchString(prefix) {
		return "", fmt.Errorf("invalid SVG id prefix")
	}
	if err := validateDrawing(d); err != nil {
		return "", err
	}
	w := &svgWriter{prefix: prefix}
	name := d.Name
	if name == "" {
		name = d.ID
	}
	w.raw(`<svg xmlns="http://www.w3.org/2000/svg" role="img" data-testid="bpmn-svg" aria-label="` + escape(name) + `" viewBox="` + nums(d.Bounds.X, d.Bounds.Y, d.Bounds.W, d.Bounds.H) + `" font-family="IBM Plex Sans, system-ui, sans-serif">`)
	w.raw(`<title>` + escape(name) + `</title>`)
	w.defs()
	for _, s := range d.Shapes {
		w.shape(s)
	}
	for _, edge := range d.Edges {
		w.edge(edge)
	}
	w.raw(`</svg>`)
	return w.String(), nil
}

var svgPrefix = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]*$`)

const paper = `var(--bpmn-paper, var(--surface, #fff))`

var escape = html.EscapeString

func n(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
func nums(values ...float64) string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = n(v)
	}
	return strings.Join(out, " ")
}

type svgWriter struct {
	strings.Builder
	prefix string
}

func (w *svgWriter) raw(s string)         { w.WriteString(s) }
func (w *svgWriter) path(d, attrs string) { w.raw(`<path d="` + d + `"` + attrs + `/>`) }
func (w *svgWriter) rect(x, y, width, height, r float64, attrs string) {
	w.raw(`<rect x="` + n(x) + `" y="` + n(y) + `" width="` + n(width) + `" height="` + n(height) + `" rx="` + n(r) + `"` + attrs + `/>`)
}
func (w *svgWriter) circle(x, y, r float64, attrs string) {
	w.raw(`<circle cx="` + n(x) + `" cy="` + n(y) + `" r="` + n(r) + `"` + attrs + `/>`)
}
func (w *svgWriter) defs() {
	w.raw(`<defs>`)
	for _, kind := range []string{EndArrowFilled, EndArrowOpen, EndCircle, EndDiamond} {
		x, width, height := 10.0, 8.0, 8.0
		view := "0 0 10 10"
		if kind == EndCircle {
			x = 5
			width = 7
			height = 7
		}
		if kind == EndDiamond {
			x = 0
			width = 10
			height = 9
			view = "0 0 12 10"
		}
		w.raw(`<marker id="` + w.prefix + `-` + kind + `" data-end="` + kind + `" viewBox="` + view + `" refX="` + n(x) + `" refY="5" markerWidth="` + n(width) + `" markerHeight="` + n(height) + `" orient="auto-start-reverse">`)
		switch kind {
		case EndArrowFilled:
			w.path("M0 0 L10 5 L0 10 Z", ` fill="currentColor"`)
		case EndArrowOpen:
			w.path("M0 0 L10 5 L0 10", ` fill="none" stroke="currentColor"`)
		case EndCircle:
			w.circle(5, 5, 4, ` fill="`+paper+`" stroke="currentColor"`)
		case EndDiamond:
			w.path("M0 5 L6 0 L12 5 L6 10 Z", ` fill="`+paper+`" stroke="currentColor"`)
		}
		w.raw(`</marker>`)
	}
	w.raw(`</defs>`)
}
func (w *svgWriter) shape(s Shape) {
	width := 1.5
	if s.Border == BorderThick {
		width = 3
	}
	dash := ""
	if s.Dashed || s.Border == BorderDashed {
		dash = ` stroke-dasharray="6 3"`
	}
	if s.Border == BorderDotted {
		dash = ` stroke-dasharray="1.5 3"`
	}
	w.raw(`<g data-testid="bpmn-shape" data-element="` + escape(s.Element) + `" data-kind="` + escape(s.Kind) + `" data-form="` + s.Form + `" data-border="` + s.Border + `" data-symbol="` + s.Symbol + `" data-dashed="` + strconv.FormatBool(s.Dashed) + `" fill="` + paper + `" stroke="currentColor" stroke-width="` + n(width) + `"` + dash + `>`)
	w.raw(`<title>` + escape(s.Name+" ("+s.Kind+")") + `</title>`)
	switch s.Form {
	case FormRoundRect:
		w.rect(s.X, s.Y, s.W, s.H, 10, "")
		if s.Border == BorderDouble {
			w.rect(s.X+3, s.Y+3, s.W-6, s.H-6, 8, ` fill="none" stroke-width="1"`)
		}
	case FormCircle:
		r := math.Min(s.W, s.H) / 2
		w.circle(s.X+s.W/2, s.Y+s.H/2, r, "")
		if s.Border == BorderDouble {
			w.circle(s.X+s.W/2, s.Y+s.H/2, r-3, ` fill="none" stroke-width="1"`)
		}
	case FormDiamond:
		w.raw(`<polygon points="` + nums(s.X+s.W/2, s.Y, s.X+s.W, s.Y+s.H/2, s.X+s.W/2, s.Y+s.H, s.X, s.Y+s.H/2) + `"/>`)
	case FormDocument:
		fold := math.Min(12, s.W/3)
		w.path("M"+nums(s.X, s.Y)+" H"+n(s.X+s.W-fold)+" L"+nums(s.X+s.W, s.Y+fold)+" V"+n(s.Y+s.H)+" H"+n(s.X)+" Z M"+nums(s.X+s.W-fold, s.Y)+" V"+n(s.Y+fold)+" H"+n(s.X+s.W), "")
	case FormDataStore:
		ry := math.Min(8, s.H/6)
		w.path("M"+nums(s.X, s.Y+ry)+" V"+n(s.Y+s.H-ry)+" A"+nums(s.W/2, ry)+" 0 0 0 "+nums(s.X+s.W, s.Y+s.H-ry)+" V"+n(s.Y+ry), "")
		w.raw(`<ellipse cx="` + n(s.X+s.W/2) + `" cy="` + n(s.Y+ry) + `" rx="` + n(s.W/2) + `" ry="` + n(ry) + `"/>`)
	case FormBracket:
		w.path("M"+nums(s.X+12, s.Y)+" H"+n(s.X)+" V"+n(s.Y+s.H)+" H"+n(s.X+12), ` fill="none"`)
	case FormGroup:
		w.rect(s.X, s.Y, s.W, s.H, 8, ` fill="none" stroke-dasharray="8 4 2 4"`)
	case FormPool, FormLane:
		w.rect(s.X, s.Y, s.W, s.H, 0, ` fill="none"`)
		w.path("M"+nums(s.X+30, s.Y)+" V"+n(s.Y+s.H), ` fill="none"`)
	case FormRect:
		w.rect(s.X, s.Y, s.W, s.H, 0, "")
	}
	w.glyph(s)
	w.markers(s)
	w.label(s.Label)
	w.raw(`</g>`)
}

func (w *svgWriter) glyph(s Shape) {
	if s.Symbol == "" {
		return
	}
	x, y, k := s.X+8, s.Y+8, 1.0
	if s.Form == FormCircle {
		x = s.X + s.W/2
		y = s.Y + s.H/2
		k = math.Min(s.W, s.H) / 4.5
	}
	if s.Form == FormDiamond {
		x = s.X + s.W/2
		y = s.Y + s.H/2
		k = math.Min(s.W, s.H) / 5
	}
	if s.Form == FormDocument {
		x = s.X + 4
		y = s.Y + 4
	}
	w.raw(`<g data-testid="bpmn-glyph" data-element="` + escape(s.Element) + `" data-glyph="` + s.Symbol + `" data-filled="` + strconv.FormatBool(s.Filled) + `" transform="translate(` + nums(x, y) + `) scale(` + n(k) + `)" fill="none" stroke="currentColor" stroke-dasharray="none" stroke-width="` + n(1.5/k) + `" stroke-linecap="round" stroke-linejoin="round">`)
	fill := "none"
	if s.Filled {
		fill = "currentColor"
	}
	switch s.Form {
	case FormDiamond:
		switch s.Symbol {
		case "exclusive":
			w.path("M-.7 -.7 L.7 .7 M.7 -.7 L-.7 .7", ` stroke-width="`+n(3/k)+`"`)
		case "parallel":
			w.path("M0 -1 V1 M-1 0 H1", ` stroke-width="`+n(3/k)+`"`)
		case "inclusive":
			w.circle(0, 0, .9, ` stroke-width="`+n(2.5/k)+`"`)
		case "complex":
			w.path("M0 -1 V1 M-1 0 H1 M-.7 -.7 L.7 .7 M.7 -.7 L-.7 .7", ` stroke-width="`+n(2.5/k)+`"`)
		default:
			if s.Symbol == "event-based" {
				w.circle(0, 0, 1.2, "")
			}
			w.circle(0, 0, 1.05, "")
			if s.Symbol == "parallel-event-based-start" {
				w.path("M0 -.6 V.6 M-.6 0 H.6", "")
			} else {
				w.raw(`<polygon points="` + pentagon(0, 0, .7) + `"/>`)
			}
		}
	case FormCircle:
		switch s.Symbol {
		case "message":
			envelopeFill := paper
			flap := "currentColor"
			if s.Filled {
				envelopeFill = "currentColor"
				flap = paper
			}
			w.rect(-1, -.7, 2, 1.4, 0, ` fill="`+envelopeFill+`"`)
			w.path("M-1 -.7 L0 0 L1 -.7", ` stroke="`+flap+`"`)
		case "timer":
			w.circle(0, 0, 1.1, "")
			for i := 0; i < 12; i++ {
				a := float64(i) * math.Pi / 6
				w.path("M"+nums(.88*math.Sin(a), -.88*math.Cos(a))+" L"+nums(1.05*math.Sin(a), -1.05*math.Cos(a)), ` stroke-width="`+n(.8/k)+`"`)
			}
			w.path("M0 0 V-.8 M0 0 H.6", "")
		case "terminate":
			w.circle(0, 0, 1.1, ` fill="currentColor"`)
		case "signal":
			w.raw(`<polygon points="0 -1 1 .75 -1 .75" fill="` + fill + `"/>`)
		case "error":
			w.path("M-1 1 L-.4 -1 L.2 .2 L1 -1 L.4 1 L-.2 -.2 Z", ` fill="`+fill+`"`)
		case "escalation":
			w.path("M0 -1 L.8 1 L0 .3 L-.8 1 Z", ` fill="`+fill+`"`)
		case "compensation":
			w.path("M0 -.6 L-1 0 L0 .6 Z M1 -.6 L0 0 L1 .6 Z", ` fill="`+fill+`"`)
		case "conditional":
			w.rect(-.7, -1, 1.4, 2, 0, "")
			w.path("M-.4 -.5 H.4 M-.4 0 H.4 M-.4 .5 H.4", "")
		case "link":
			w.path("M-1 -.4 H.2 V-1 L1 0 L.2 1 V.4 H-1 Z", ` fill="`+fill+`"`)
		case "cancel":
			w.path("M-.75 -1 L0 -.25 L.75 -1 L1 -.75 L.25 0 L1 .75 L.75 1 L0 .25 L-.75 1 L-1 .75 L-.25 0 L-1 -.75 Z", ` fill="`+fill+`"`)
		case "multiple":
			w.raw(`<polygon points="` + pentagon(0, 0, 1) + `" fill="` + fill + `"/>`)
		case "parallel-multiple":
			w.path("M0 -1 V1 M-1 0 H1", ` stroke-width="`+n(2.5/k)+`"`)
		}
	case FormRoundRect:
		switch s.Symbol {
		case "user":
			w.circle(6, 4, 3.5, "")
			w.path("M0 15 Q6 6 12 15 Z", "")
		case "service":
			w.gear(6, 6, 6)
			w.gear(13, 12, 3.5)
		case "script":
			w.path("M2 0 H12 Q8 7 12 14 H2 Q6 7 2 0 Z M4 4 H9 M4 7 H9 M4 10 H9", "")
		case "manual":
			w.path("M1 8 V6 Q1 4 3 4 H6 V1 Q6 -1 8 0 V6 L12 5 Q15 5 15 8 L13 14 H5 L0 10 Q-1 8 1 8 Z", "")
		case "business-rule":
			w.rect(0, 0, 14, 11, 0, "")
			w.path("M0 3.5 H14 M0 7.5 H14 M4 3.5 V11", "")
		case "send", "receive", "receive-instantiate":
			envelopeFill := "none"
			flap := "currentColor"
			if s.Symbol == "send" {
				envelopeFill = "currentColor"
				flap = paper
			}
			if s.Symbol == "receive-instantiate" {
				w.circle(7, 7, 9, "")
			}
			w.rect(0, 2, 14, 10, 0, ` fill="`+envelopeFill+`"`)
			w.path("M0 2 L7 7 L14 2", ` stroke="`+flap+`"`)
		}
	case FormDocument:
		fill := "none"
		if s.Symbol == "output" {
			fill = "currentColor"
		}
		w.path("M0 3 H6 V0 L11 5 L6 10 V7 H0 Z", ` fill="`+fill+`"`)
	}
	w.raw(`</g>`)
}
func (w *svgWriter) gear(cx, cy, r float64) {
	var points []string
	for i := 0; i < 32; i++ {
		a := -math.Pi/2 + float64(i)*math.Pi/16
		rr := r
		if i%4 == 0 || i%4 == 3 {
			rr *= .72
		}
		points = append(points, nums(cx+rr*math.Cos(a), cy+rr*math.Sin(a)))
	}
	w.raw(`<polygon points="` + strings.Join(points, " ") + `" fill="` + paper + `"/>`)
	w.circle(cx, cy, r*.3, ` fill="`+paper+`"`)
}
func pentagon(cx, cy, r float64) string {
	var points []string
	for i := 0; i < 5; i++ {
		a := -math.Pi/2 + float64(i)*2*math.Pi/5
		points = append(points, nums(cx+r*math.Cos(a), cy+r*math.Sin(a)))
	}
	return strings.Join(points, " ")
}

func (w *svgWriter) markers(s Shape) {
	list := append([]string{}, s.Markers...)
	if s.Collection {
		list = append(list, "parallel")
	}
	if len(list) == 0 {
		return
	}
	x := s.X + s.W/2 - float64(len(list)*15-3)/2
	y := s.Y + s.H - 16
	for i, m := range list {
		w.raw(`<g data-testid="bpmn-marker" data-element="` + escape(s.Element) + `" data-marker="` + m + `" transform="translate(` + nums(x+float64(i)*15, y) + `)" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="none" stroke-linejoin="round">`)
		switch m {
		case "loop":
			w.path("M10.2 4.2 A4.8 4.8 0 1 1 6 1.2 M10.2 4.2 v-4 M10.2 4.2 h-4", "")
		case "parallel":
			w.path("M2 0 V12 M6 0 V12 M10 0 V12", "")
		case "sequential":
			w.path("M0 2 H12 M0 6 H12 M0 10 H12", "")
		case "compensation":
			w.path("M6 2 L0 6 L6 10 Z M12 2 L6 6 L12 10 Z", "")
		case "adhoc":
			w.path("M0 6 q3 -4 6 0 t6 0", "")
		case "collapsed":
			w.rect(0, 0, 12, 12, 0, "")
			w.path("M6 3 V9 M3 6 H9", "")
		}
		w.raw(`</g>`)
	}
}
func (w *svgWriter) label(l *Label) {
	if l == nil || len(l.Lines) == 0 {
		return
	}
	x, y := l.X+l.W/2, l.Y+l.H/2-float64(len(l.Lines)-1)*LineHeight/2
	anchor := "middle"
	if l.Align == "left" {
		anchor = "start"
		x = l.X
	}
	transform := ""
	if l.Vertical {
		transform = ` transform="rotate(-90 ` + nums(l.X+l.W/2, l.Y+l.H/2) + `)"`
	}
	w.raw(`<text data-testid="bpmn-label" text-anchor="` + anchor + `" dominant-baseline="central" font-size="` + n(FontSize) + `" fill="currentColor" stroke="none"` + transform + `>`)
	for i, line := range l.Lines {
		w.raw(`<tspan x="` + n(x) + `" y="` + n(y+float64(i)*LineHeight) + `">` + escape(line) + `</tspan>`)
	}
	w.raw(`</text>`)
}
func (w *svgWriter) edge(edge Edge) {
	w.raw(`<g data-testid="bpmn-edge" data-element="` + escape(edge.Element) + `" data-stroke="` + edge.Stroke + `" data-start="` + edge.Start + `" data-end="` + edge.End + `"><title>` + escape(edge.Name+" ("+edge.Kind+")") + `</title>`)
	var path []string
	for i, p := range edge.Points {
		cmd := "L"
		if i == 0 {
			cmd = "M"
		}
		path = append(path, cmd+nums(p.X, p.Y))
	}
	attrs := ` fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"`
	if edge.Stroke == StrokeDashed {
		attrs += ` stroke-dasharray="8 5"`
	}
	if edge.Stroke == StrokeDotted {
		attrs += ` stroke-dasharray="2 4"`
	}
	for _, end := range []struct{ pos, kind string }{{"start", edge.Start}, {"end", edge.End}} {
		if end.kind != "" && end.kind != EndSlash {
			attrs += ` marker-` + end.pos + `="url(#` + w.prefix + `-` + end.kind + `)"`
		}
	}
	w.path(strings.Join(path, " "), attrs)
	if edge.Start == EndSlash {
		w.slash(edge.Points, false)
	}
	if edge.End == EndSlash {
		w.slash(edge.Points, true)
	}
	w.label(edge.Label)
	w.raw(`</g>`)
}
func (w *svgWriter) slash(points []Point, reverse bool) {
	pts := append([]Point{}, points...)
	if reverse {
		for i, j := 0, len(pts)-1; i < j; i, j = i+1, j-1 {
			pts[i], pts[j] = pts[j], pts[i]
		}
	}
	a := pts[0]
	for _, b := range pts[1:] {
		length := math.Hypot(b.X-a.X, b.Y-a.Y)
		if length == 0 {
			continue
		}
		ux, uy := (b.X-a.X)/length, (b.Y-a.Y)/length
		px, py := a.X+ux*math.Min(10, length/2), a.Y+uy*math.Min(10, length/2)
		nx, ny := -uy, ux
		k := 4.2
		w.raw(`<line data-testid="bpmn-slash" x1="` + n(px-(nx-ux)*k) + `" y1="` + n(py-(ny-uy)*k) + `" x2="` + n(px+(nx-ux)*k) + `" y2="` + n(py+(ny-uy)*k) + `" stroke="currentColor" stroke-width="1.5"/>`)
		return
	}
}

var drawingSymbols = map[string][]string{
	FormRoundRect: {"", "user", "service", "script", "manual", "business-rule", "send", "receive", "receive-instantiate"},
	FormCircle:    {"", "message", "timer", "terminate", "signal", "error", "escalation", "compensation", "conditional", "link", "cancel", "multiple", "parallel-multiple"},
	FormDiamond:   {"", "exclusive", "parallel", "inclusive", "complex", "event-based", "event-based-start", "parallel-event-based-start"},
	FormDocument:  {"", "input", "output"}, FormDataStore: {""}, FormBracket: {""}, FormGroup: {""}, FormPool: {""}, FormLane: {""}, FormRect: {""},
}

func inDrawing(s string, list []string) bool {
	for _, v := range list {
		if s == v {
			return true
		}
	}
	return false
}
func finite(values ...float64) bool {
	for _, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}
func validateDrawing(d Diagram) error {
	if !finite(d.Bounds.X, d.Bounds.Y, d.Bounds.W, d.Bounds.H) || d.Bounds.W <= 0 || d.Bounds.H <= 0 {
		return fmt.Errorf("diagram %q has invalid bounds", d.ID)
	}
	label := func(l *Label) error {
		if l != nil && (!finite(l.X, l.Y, l.W, l.H) || l.W < 0 || l.H < 0 || !inDrawing(l.Align, []string{"", "left"})) {
			return fmt.Errorf("invalid label geometry or alignment")
		}
		return nil
	}
	for _, s := range d.Shapes {
		symbols, ok := drawingSymbols[s.Form]
		if !ok || !inDrawing(s.Symbol, symbols) {
			return fmt.Errorf("%s: unsupported drawing form/symbol %q/%q", s.Element, s.Form, s.Symbol)
		}
		if !finite(s.X, s.Y, s.W, s.H) || s.W <= 0 || s.H <= 0 {
			return fmt.Errorf("%s: invalid shape geometry", s.Element)
		}
		if !inDrawing(s.Border, []string{BorderSingle, BorderThick, BorderDouble, BorderDashed, BorderDotted}) {
			return fmt.Errorf("%s: unsupported border %q", s.Element, s.Border)
		}
		if s.Border == BorderDouble && (s.W <= 6 || s.H <= 6) {
			return fmt.Errorf("%s: shape too small for a double border", s.Element)
		}
		for _, m := range s.Markers {
			if !inDrawing(m, []string{"loop", "parallel", "sequential", "compensation", "adhoc", "collapsed"}) {
				return fmt.Errorf("%s: unsupported activity marker %q", s.Element, m)
			}
		}
		if err := label(s.Label); err != nil {
			return fmt.Errorf("%s: %v", s.Element, err)
		}
	}
	for _, edge := range d.Edges {
		if len(edge.Points) < 2 {
			return fmt.Errorf("%s: fewer than two waypoints", edge.Element)
		}
		for _, p := range edge.Points {
			if !finite(p.X, p.Y) {
				return fmt.Errorf("%s: invalid waypoint", edge.Element)
			}
		}
		if !inDrawing(edge.Stroke, []string{StrokeSolid, StrokeDashed, StrokeDotted}) {
			return fmt.Errorf("%s: unsupported stroke %q", edge.Element, edge.Stroke)
		}
		for _, end := range []string{edge.Start, edge.End} {
			if !inDrawing(end, []string{EndNone, EndArrowFilled, EndArrowOpen, EndCircle, EndDiamond, EndSlash}) {
				return fmt.Errorf("%s: unsupported line end %q", edge.Element, end)
			}
		}
		if err := label(edge.Label); err != nil {
			return fmt.Errorf("%s: %v", edge.Element, err)
		}
	}
	return nil
}
