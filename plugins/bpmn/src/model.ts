/** The drawing model, as it arrives from the sidecar. */

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export type Label = Rect & {
  lines: string[];
  vertical?: boolean;
  align?: "left";
};

export type Form =
  | "roundrect"
  | "circle"
  | "diamond"
  | "document"
  | "datastore"
  | "bracket"
  | "group"
  | "pool"
  | "lane"
  | "rect";

export type Border = "single" | "thick" | "double" | "dashed" | "dotted";

export type Shape = Rect & {
  id: string;
  element: string;
  kind: string;
  name: string;
  form: Form;
  border: Border;
  dashed?: boolean;
  symbol?: string;
  filled?: boolean;
  markers?: string[];
  collection?: boolean;
  label?: Label;
};

export type LineEnd = "arrow" | "open-arrow" | "circle" | "diamond" | "slash";

export type Edge = {
  id: string;
  element: string;
  kind: string;
  name: string;
  points: Point[];
  stroke: "solid" | "dashed" | "dotted";
  start?: LineEnd;
  end?: LineEnd;
  label?: Label;
};

export type Diagram = {
  id: string;
  name: string;
  bounds: Rect;
  shapes: Shape[];
  edges: Edge[];
};

export type BpmnDocument = {
  id: string;
  name: string;
  diagrams: Diagram[];
  warnings: string[];
};

/** Must equal FontSize and LineHeight in model.go — the lines were broken for them. */
export const FONT_SIZE = 11;
export const LINE_HEIGHT = 13;
