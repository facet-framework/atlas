import { germanLabel } from "@/i18n/testing-labels.spec-support";
/** The product city as Atlas draws it at /product: a 3D city in WebGL
 * the reader can turn, tilt, zoom and move, where every record is a storey and
 * every scenario a window, with every name whole. Without WebGL the isometric
 * map stands in. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import Atlas from "./Atlas";
import { domainViews } from "./derive-reader";

const model = taskflowModel();

function mount() {
  window.history.replaceState(null, "", "/product");
  return render(<Atlas model={model} readers={null} />);
}

/** jsdom has no WebGL. This context draws nothing and answers what the city
 * asks while it sets itself up; everything the tests read is the DOM the city
 * renders around it: its names, its list, its controls and its camera. */

function withWebGl() {
  const lose = jest.fn();
  const fixed: Record<string, unknown> = {
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    isContextLost: () => false,
    getExtension: () => ({ loseContext: lose }),
  };
  const gl = new Proxy(
    {},
    {
      get: (_, key: string) =>
        key in fixed ? fixed[key] : /^[A-Z_0-9]+$/.test(key) ? 0 : () => ({}),
    },
  );
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => gl as unknown as RenderingContext);
  return { lose };
}

/** Gives the canvas the size a browser would give it. */
function sized(canvas: HTMLCanvasElement, w = 1600, h = 800) {
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: h });
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 }) as DOMRect;
}

/** A reader who asks for reduced motion: the camera jumps instead of flying. */
function reducedMotion() {
  const media = window.matchMedia;
  jest.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    ...media(query),
    matches: query === "(prefers-reduced-motion: reduce)",
  }));
}

/** Lets the frame the city asked for run. */
async function frame() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await act(() => i18n.changeLanguage("en"));
});

/** The state of each scenario as the raw model has it, in record order. */
function statesOf(id: string) {
  const rec = [...model.features, ...model.assumptions].find((r) => r.id === id)!;
  return rec.scenarios
    .filter((s) => !s.deviation)
    .map((s) => (s.proven ? "test named" : s.backing?.state === "unbacked" ? "unbacked" : "open"));
}

describe("product city", () => {
  it("turns, zooms and resets the 3D city from its controls, in the reader's language", async () => {
    withWebGl();
    // A reader who asks for reduced motion: the camera jumps instead of flying.
    const media = window.matchMedia;
    jest.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      ...media(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    await act(() => i18n.changeLanguage("de"));
    mount();
    await frame();
    const city = screen.getByTestId("city");
    // The precondition: a WebGL scene, drawn whole from the home angle.
    expect(city.querySelector("canvas")).not.toBeNull();
    expect(city).toHaveAttribute("data-zoom", "1.00");
    const yaw = Number(city.getAttribute("data-yaw"));
    await userEvent.click(screen.getByRole("button", { name: germanLabel("Zoom in") }));
    await frame();
    expect(city).toHaveAttribute("data-zoom", "1.33");
    await userEvent.click(screen.getByRole("button", { name: germanLabel("Turn right") }));
    await frame();
    expect(Number(city.getAttribute("data-yaw"))).toBe(yaw - 45);
    await userEvent.click(screen.getByRole("button", { name: germanLabel("Reset") }));
    await frame();
    expect(city).toHaveAttribute("data-zoom", "1.00");
  });

  it("zooms with the wheel and keeps the page where it is", async () => {
    withWebGl();
    mount();
    await frame();
    const city = screen.getByTestId("city");
    const wheel = new WheelEvent("wheel", { deltaY: -300, bubbles: true, cancelable: true });
    act(() => {
      city.dispatchEvent(wheel);
    });
    await frame();
    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(city.getAttribute("data-zoom"))).toBeGreaterThan(1);
  });

  it("lists every storey with one scenario state per window, as the records have them", async () => {
    withWebGl();
    mount();
    await frame();
    const list = within(screen.getByTestId("city-list"));
    const ids = [...model.features, ...model.assumptions].map((r) => r.id);
    // The precondition: a record whose windows differ, so order and state both count.
    const mixed = ids.find((id) => new Set(statesOf(id)).size > 1);
    expect(mixed).toBeDefined();
    for (const id of ids.filter((x) => statesOf(x).length)) {
      expect(list.getByText(`${id}: ${statesOf(id).join(", ")}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("city")).toHaveAccessibleName(
      new RegExp(`${domainViews(model).length} areas`),
    );
  });

  it("names every area and capability whole, never with an ellipsis", async () => {
    withWebGl();
    mount();
    sized(screen.getByTestId("city").querySelector("canvas")!);
    await frame();
    const titles = domainViews(model).flatMap((d) => [
      d.title.replace(/\s+/g, ""),
      ...d.capabilities.map((c) => c.title.replace(/\s+/g, "")),
    ]);
    // Close up, the buildings near the middle carry their names too.
    await userEvent.click(screen.getByRole("radio", { name: "Records" }));
    await frame();
    await frame();
    const names = [
      ...screen.getAllByTestId(/^city-area-/),
      ...screen.queryAllByTestId(/^city-cap-/),
    ];
    // The precondition: there are names on the map at all.
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const title = name.firstElementChild;
      expect(name.textContent).not.toContain("…");
      expect(titles).toContain((title?.textContent ?? "").replace(/\s+/g, ""));
    }
  });

  it("names the areas of the whole city, and the capabilities once zooming in makes room", async () => {
    withWebGl();
    reducedMotion();
    mount();
    const canvas = screen.getByTestId("city").querySelector("canvas")!;
    sized(canvas);
    await frame();
    await frame();
    const city = screen.getByTestId("city");
    // The precondition: the city opens whole, at the level of capabilities.
    expect(city).toHaveAttribute("data-level", "mid");
    expect(screen.getAllByTestId(/^city-area-/).length).toBeGreaterThan(0);
    const whole = screen.queryAllByTestId(/^city-cap-/).length;
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByTestId("city-zoom-in"));
      await frame();
    }
    const close = screen.queryAllByTestId(/^city-cap-/).length;
    expect(close).toBeGreaterThan(1);
    expect(close).toBeGreaterThan(whole);
  });

  it("keeps the storeys while zooming out until the tallest tower is in view", async () => {
    withWebGl();
    reducedMotion();
    const base = model.features[0];
    // One capability of 105 records, far taller than the rest of the city.
    const tower = Array.from({ length: 105 }, (_, i) => ({
      ...base,
      id: `${base.domain}/${base.capability}/storey-${i}`,
    }));
    const tall = {
      ...model,
      features: [...model.features, ...tower],
      byId: { ...model.byId, ...Object.fromEntries(tower.map((t) => [t.id, t])) },
    };
    window.history.replaceState(null, "", "/product");
    render(<Atlas model={tall} readers={null} />);
    sized(screen.getByTestId("city").querySelector("canvas")!);
    await frame();
    await frame();
    const city = screen.getByTestId("city");
    const probe = () => JSON.parse(city.getAttribute("data-probe") || "null");
    // The precondition: from home the tower reaches out of the picture.
    expect(city).toHaveAttribute("data-level", "mid");
    expect(probe().tcompletetInView).toBe(false);
    let before = probe();
    for (let i = 0; i < 20 && city.getAttribute("data-level") !== "far"; i += 1) {
      before = probe();
      await userEvent.click(screen.getByTestId("city-zoom-out"));
      await frame();
    }
    expect(city).toHaveAttribute("data-level", "far");
    // The last view with storeys held the whole tower.
    expect(before.tcompletetInView).toBe(true);
  });

  it("draws the isometric map when the browser has no WebGL", () => {
    mount();
    const city = screen.getByTestId("city");
    expect(city.tagName.toLowerCase()).toBe("svg");
    expect(city).toHaveAttribute("data-zoom", "1.00");
    expect(screen.getAllByTestId(/^city-cap-/).length).toBeGreaterThan(0);
  });

  it("counts each district's records and capabilities in singular and plural", () => {
    mount();
    const domains = domainViews(model);
    const rows = within(screen.getByRole("list", { name: "Areas" })).getAllByRole("listitem");
    // The precondition: one row per district.
    expect(rows).toHaveLength(domains.length);
    const word = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    domains.forEach((d, i) => {
      const n = [...model.features, ...model.assumptions].filter((f) => f.domain === d.id).length;
      expect(rows[i]).toHaveTextContent(
        `${word(n, "record", "records")} · ${word(d.capabilities.length, "capability", "capabilities")}`,
      );
    });
  });

  it("draws the time slider under the city, and Today keeps its place at today", async () => {
    mount();
    const slider = screen.getByRole("slider", { name: "Time" });
    const bar = screen.getByTestId("time");
    const max = Number(slider.getAttribute("max"));
    // The precondition: there are moments to step back to, and the slider is at today.
    expect(max).toBeGreaterThan(1);
    expect(slider).toHaveValue(String(max));
    expect(
      screen.getByTestId("city").compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      bar.compareDocumentPosition(screen.getByTestId("district-strip")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // At today "Today" is not offered, yet its button stays in the bar.
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
    const cells = bar.children.length;
    const heading = screen.getByRole("heading", { level: 1 });
    const now = heading.textContent;

    fireEvent.change(slider, { target: { value: "0" } });
    expect(bar.children).toHaveLength(cells);
    // The heading names the earlier count and keeps today's, unseen, as its room.
    const reserve = heading.querySelector("[aria-hidden='true']");
    expect(reserve).toHaveTextContent(now ?? "");
    expect(heading.textContent).not.toBe(now);

    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(slider).toHaveValue(String(max));
    expect(slider).toHaveFocus();
    expect(bar.children).toHaveLength(cells);
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });
});
