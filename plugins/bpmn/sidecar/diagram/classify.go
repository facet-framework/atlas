package diagram

import "strings"

// The activity kinds. A task type's symbol is its kind without "Task".
var taskSymbols = map[string]string{
	"task":             "",
	"userTask":         "user",
	"manualTask":       "manual",
	"serviceTask":      "service",
	"scriptTask":       "script",
	"businessRuleTask": "business-rule",
	"sendTask":         "send",
	"receiveTask":      "receive",
}

var subprocessKinds = map[string]bool{
	"subProcess":      true,
	"adHocSubProcess": true,
	"transaction":     true,
	"callActivity":    true,
}

var eventKinds = map[string]bool{
	"startEvent":             true,
	"endEvent":               true,
	"intermediateCatchEvent": true,
	"intermediateThrowEvent": true,
	"boundaryEvent":          true,
}

var gatewaySymbols = map[string]string{
	"exclusiveGateway":  "exclusive",
	"inclusiveGateway":  "inclusive",
	"parallelGateway":   "parallel",
	"complexGateway":    "complex",
	"eventBasedGateway": "event-based",
}

// The event definitions, by element name, and the symbol each draws.
var eventDefinitionSymbols = map[string]string{
	"messageEventDefinition":     "message",
	"timerEventDefinition":       "timer",
	"errorEventDefinition":       "error",
	"escalationEventDefinition":  "escalation",
	"cancelEventDefinition":      "cancel",
	"compensateEventDefinition":  "compensation",
	"conditionalEventDefinition": "conditional",
	"linkEventDefinition":        "link",
	"signalEventDefinition":      "signal",
	"terminateEventDefinition":   "terminate",
}

// isActivity answers whether a kind is drawn as a rounded rectangle.
func isActivity(kind string) bool {
	_, task := taskSymbols[kind]
	return task || subprocessKinds[kind]
}

// classify decides a shape's outline, border, symbol and markers from its
// semantic element and the DI shape that draws it.
func classify(s *Shape, el *node, di *node, warn func(string, ...any)) {
	kind := el.local
	s.Kind = kind
	switch {
	case isActivity(kind):
		classifyActivity(s, el, di)
	case eventKinds[kind]:
		classifyEvent(s, el)
	case gatewaySymbols[kind] != "":
		s.Form = FormDiamond
		s.Border = BorderSingle
		s.Symbol = gatewaySymbols[kind]
		// An exclusive gateway's X is optional; the DI says whether this
		// modeller drew it. Without the attribute, BPMN says no marker.
		if kind == "exclusiveGateway" && di.attr("isMarkerVisible") != "true" {
			s.Symbol = ""
		}
		if kind == "eventBasedGateway" && el.attr("instantiate") == "true" {
			s.Symbol = "event-based-start"
			if el.attr("eventGatewayType") == "Parallel" {
				s.Symbol = "parallel-event-based-start"
			}
		}
	case kind == "dataObjectReference" || kind == "dataObject" || kind == "dataInput" || kind == "dataOutput":
		s.Form = FormDocument
		s.Border = BorderSingle
		switch kind {
		case "dataInput":
			s.Symbol = "input"
		case "dataOutput":
			s.Symbol = "output"
		}
		if el.attr("isCollection") == "true" {
			s.Collection = true
		}
	case kind == "dataStoreReference":
		s.Form = FormDataStore
		s.Border = BorderSingle
	case kind == "textAnnotation":
		s.Form = FormBracket
		s.Border = BorderSingle
		if t := el.child(nsModel, "text"); t != nil {
			s.Name = strings.TrimSpace(t.text.String())
		}
	case kind == "group":
		s.Form = FormGroup
		s.Border = BorderDashed
	case kind == "participant":
		s.Form = FormPool
		s.Border = BorderSingle
		if mult := el.child(nsModel, "participantMultiplicity"); mult != nil {
			if max := mult.attr("maximum"); max == "" || max != "1" {
				s.Markers = append(s.Markers, "parallel")
			}
		}
	case kind == "lane":
		s.Form = FormLane
		s.Border = BorderSingle
	default:
		s.Form = FormRect
		s.Border = BorderSingle
		warn("%s: no outline for <%s>, drawn as a plain box", s.Element, kind)
	}
}

func classifyActivity(s *Shape, el *node, di *node) {
	kind := el.local
	s.Form = FormRoundRect
	s.Border = BorderSingle
	if sym, ok := taskSymbols[kind]; ok {
		s.Symbol = sym
		// A receive task that starts its process is drawn with the message
		// inside a start-event ring; the reader keys that off this symbol.
		if kind == "receiveTask" && el.attr("instantiate") == "true" {
			s.Symbol = "receive-instantiate"
		}
	}
	switch kind {
	case "callActivity":
		s.Border = BorderThick
	case "transaction":
		s.Border = BorderDouble
	case "subProcess", "adHocSubProcess":
		if el.attr("triggeredByEvent") == "true" {
			s.Border = BorderDotted
		}
	}

	if loop := el.child(nsModel, "standardLoopCharacteristics"); loop != nil {
		s.Markers = append(s.Markers, "loop")
	} else if mi := el.child(nsModel, "multiInstanceLoopCharacteristics"); mi != nil {
		if mi.attr("isSequential") == "true" {
			s.Markers = append(s.Markers, "sequential")
		} else {
			s.Markers = append(s.Markers, "parallel")
		}
	}
	if kind == "adHocSubProcess" {
		s.Markers = append(s.Markers, "adhoc")
	}
	if el.attr("isForCompensation") == "true" {
		s.Markers = append(s.Markers, "compensation")
	}
	// Collapsed: a subprocess the DI draws closed, or a call activity, which
	// always stands for something drawn elsewhere. isExpanded is the DI's
	// say, and absent means collapsed for a subprocess under BPMN 2.0.
	if subprocessKinds[kind] && (kind == "callActivity" || di.attr("isExpanded") != "true") {
		s.Markers = append(s.Markers, "collapsed")
	}
}

func classifyEvent(s *Shape, el *node) {
	kind := el.local
	s.Form = FormCircle
	switch kind {
	case "startEvent":
		s.Border = BorderSingle
		// A start event inside an event subprocess may be non-interrupting.
		if el.attr("isInterrupting") == "false" {
			s.Dashed = true
		}
	case "endEvent":
		s.Border = BorderThick
	case "boundaryEvent":
		s.Border = BorderDouble
		if el.attr("cancelActivity") == "false" {
			s.Dashed = true
		}
	default:
		s.Border = BorderDouble
	}
	s.Filled = kind == "endEvent" || kind == "intermediateThrowEvent"

	var symbols []string
	for _, c := range el.children {
		if c.space != nsModel {
			continue
		}
		if sym, ok := eventDefinitionSymbols[c.local]; ok {
			symbols = append(symbols, sym)
		}
	}
	// The builder resolves local eventDefinitionRef nodes before this final
	// classification. An unresolved reference still counts as a trigger,
	// with a diagnostic from the builder; its type is never guessed.
	for _, c := range el.children {
		if c.is(nsModel, "eventDefinitionRef") {
			symbols = append(symbols, "")
		}
	}
	switch {
	case len(symbols) == 1:
		s.Symbol = symbols[0]
	case len(symbols) > 1:
		s.Symbol = "multiple"
		if el.attr("parallelMultiple") == "true" {
			s.Symbol = "parallel-multiple"
		}
	}
}
