/** The FACET mark reflects the rendered record drift identity. */

import { cleanup, render, screen, within } from "@testing-library/react";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { driftViews } from "./derive-reader";
import { uiT } from "./testing";

const model = taskflowModel();
const tt = uiT("en");
const realMatchMedia = window.matchMedia;

function mount(path: string, props: Partial<Parameters<typeof Atlas>[0]> = {}) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} {...props} />);
}

const brand = () => screen.getByRole("button", { name: tt("shell.top.home") });
const logo = () => within(brand()).getByTestId("logo-mark");

/** The same project, but the host sent no drift comparison at all. */
function withoutDrift() {
  return { ...model, scan: { ...model.scan, drift: undefined } } as typeof model;
}

function phone() {
  window.matchMedia = ((query: string) => ({
    matches: query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("the drift mark in Atlas", () => {
  it("keeps the fixture honest: the scan carries drift on some records, not all", () => {
    const records = new Set(driftViews(model).map((d) => d.record)).size;
    expect(records).toBeGreaterThan(0);
    expect(records).toBeLessThan(model.features.length);
  });

  it("offsets the header logo by the share of records with drift", () => {
    mount("/");
    expect(logo()).toHaveAttribute("data-state", "drift");
    expect(Number(logo().getAttribute("data-offset"))).toBeGreaterThanOrEqual(6);
    expect(Number(logo().getAttribute("data-offset"))).toBeLessThan(22);
    expect(within(brand()).getByTestId("top-brand").getAttribute("title")).toMatch(
      /^Drift: \d+% of records$/,
    );
    const desktop = logo().getAttribute("data-offset");
    cleanup();
    // The compact phone bar draws the same logo at the same offset.
    phone();
    mount("/");
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(logo()).toHaveAttribute("data-offset", desktop);
  });

  it("shows no drift comparison as not measured: resting logo, dash in the figures and the finding", () => {
    mount("/", { model: withoutDrift() });
    expect(logo()).toHaveAttribute("data-state", "unmeasured");
    expect(within(brand()).getByTestId("top-brand")).toHaveAttribute(
      "title",
      tt("shell.mark.unmeasured"),
    );
    const top = brand().closest("header")!;
    const figures = within(top).getByText(tt("shell.top.drift")).parentElement!;
    expect(within(figures).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      tt("ui.screens-frame.overviewpage-drift-not-measured"),
    );
    expect(screen.getByRole("img", { name: tt("shell.mark.unmeasured") })).toHaveAttribute(
      "data-state",
      "unmeasured",
    );
  });

  it("draws the mark beside the Overview's drift finding", () => {
    mount("/");
    const overview = screen.getByTestId("overview");
    const mark = within(overview).getByRole("img", { name: /^Drift: \d+% of records$/ });
    expect(mark).toHaveAttribute("data-state", "drift");
    // The finding's mark and the header's logo say the same offset.
    expect(mark.getAttribute("data-offset")).toBe(logo().getAttribute("data-offset"));
  });

  it("draws the mark beside the figure of the drift page", () => {
    mount("/contents/drift");
    const page = screen.getByTestId("drift-page");
    expect(within(page).getByRole("img", { name: /^Drift: \d+% of records$/ })).toHaveAttribute(
      "data-state",
      "drift",
    );
  });
});

/** The record page's own mark: the one in the top right corner of its head. */
const recordMark = () => within(screen.getByTestId("record-drift-mark")).getByTestId("logo-mark");

const FILES = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];

/** The same project with one record anchored in the four `FILES` and drifted
 * in `drifted` of them (none: no drift on it). */

function withRecordDrift(drifted: string[]) {
  const target = model.features[0];
  const anchors = FILES.map((path, i) => ({
    ...target.anchors[0],
    path,
    line: i + 1,
  }));
  const record = { ...target, anchors };
  const features = model.features.map((f) => (f.id === target.id ? record : f));
  const byId = { ...model.byId, [target.id]: record };
  const others = (model.scan.drift ?? []).filter((d) => d.id !== target.id);
  const mine = drifted.map((path) => ({ id: target.id, path, changedAt: "2026-11-14T10:00:00Z" }));
  const driftIds = { ...model.driftIds };
  if (mine.length) driftIds[target.id] = mine;
  else delete driftIds[target.id];
  const next = {
    ...model,
    features,
    byId,
    scan: { ...model.scan, drift: [...others, ...mine] },
    driftIds,
  } as typeof model;
  // The precondition: the record page reads these four anchored files.
  expect(next.byId[target.id].anchors).toHaveLength(4);
  expect(target.anchors.length).toBeGreaterThan(0);
  return { id: target.id, model: next };
}

describe("the record's own drift mark (#914)", () => {
  it("stands level in the brand signal on a record without drift", () => {
    const { id, model: m } = withRecordDrift([]);
    mount(`/record/${id}`, { model: m });
    expect(recordMark()).toHaveAttribute("data-state", "level");
    expect(recordMark()).toHaveAttribute("data-offset", "0");
    expect(recordMark()).toHaveAttribute("data-tone", "signal");
    expect(recordMark()).toHaveAccessibleName(tt("shell.mark.level"));
  });

  it("offsets the second block in the warning tone when one of several files drifted", () => {
    const { id, model: m } = withRecordDrift([FILES[0]]);
    mount(`/record/${id}`, { model: m });
    expect(recordMark()).toHaveAttribute("data-state", "drift");
    expect(recordMark()).toHaveAttribute("data-tone", "warn");
    expect(Number(recordMark().getAttribute("data-offset"))).toBeGreaterThanOrEqual(6);
    expect(recordMark()).toHaveAccessibleName(
      tt("ui.screens-records.recorddetailspage-drift-drifted-files-anchored-files", {
        drifted: 1,
        files: FILES.length,
      }),
    );
    expect(screen.getByTestId("record-drift-mark")).toHaveAttribute(
      "title",
      tt("ui.screens-records.recorddetailspage-drift-drifted-files-anchored-files", {
        drifted: 1,
        files: FILES.length,
      }),
    );
  });

  it("offsets further and turns to the bad tone when every file drifted", () => {
    const light = withRecordDrift([FILES[0]]);
    mount(`/record/${light.id}`, { model: light.model });
    const lightOffset = Number(recordMark().getAttribute("data-offset"));
    cleanup();
    const strong = withRecordDrift(FILES);
    mount(`/record/${strong.id}`, { model: strong.model });
    expect(recordMark()).toHaveAttribute("data-tone", "bad");
    expect(Number(recordMark().getAttribute("data-offset"))).toBeGreaterThan(lightOffset);
    // The second block carries the tone; the first stays ink.
    const [first, second] = recordMark().querySelectorAll("rect");
    expect(second).toBeInTheDocument();
    expect(recordMark()).toHaveAttribute("data-tone", "bad");
    expect(first).toHaveStyle({ fill: "var(--t-ink)" });
  });

  it("rests as not measured when the host sent no drift comparison", () => {
    const id = model.features[0].id;
    mount(`/record/${id}`, { model: withoutDrift() });
    expect(recordMark()).toHaveAttribute("data-state", "unmeasured");
    expect(recordMark()).toHaveAttribute("data-tone", "resting");
    expect(recordMark()).toHaveAccessibleName(tt("shell.mark.unmeasured"));
  });
});
