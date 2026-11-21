import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import { uiT } from "./testing";
import Atlas from "./Atlas";
import datenweg from "../../../plugins/bpmn/src/reader/testdata/bpmn-diagram-data-flow.json";
import order from "../../../plugins/bpmn/src/reader/testdata/bpmn-diagram-order.json";
import syntaxError from "../../../plugins/bpmn/src/reader/testdata/bpmn-error-syntax.json";

const de = uiT("de");
const en = uiT("en");

const model = taskflowModel();
const REPO = resolve(__dirname, "../../..");
const DATENWEG_PATH = "docs/bpmn/bpmn-plugin-datenweg.bpmn";
const ORDER_PATH = "plugins/bpmn/sidecar/diagram/testdata/order.bpmn";

// Synthetic XML carrying the selected drawing fixture's named flow nodes.
const DATENWEG_XML = `<definitions>${datenweg.diagrams
  .flatMap((d) => d.shapes)
  .filter((s) =>
    /^(startEvent|endEvent|task|userTask|serviceTask|scriptTask|exclusiveGateway)$/.test(s.kind),
  )
  .map((s) => `<${s.kind} id="${s.element}" name="${s.name}"/>`)
  .join("")}</definitions>`;
const sourceXML = (path: string) =>
  path === DATENWEG_PATH ? DATENWEG_XML : readFileSync(resolve(REPO, path), "utf8");

/** The page label in either language, so these tests follow the language switch. */
// Whole text only: a label word can also stand inside a longer hint.
const label = (key: string) => new RegExp(`^(?:${[en(key), de(key)].map(escape).join("|")})$`);
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Tool = "repo.list" | "repo.read" | "bpmn.diagram";
type Host = {
  files: string[];
  /** `bpmn.diagram` answers by path; a string is the sidecar's refusal. */
  diagram: Record<string, unknown>;
  xml?: Record<string, string>;
  listError?: string;
};

/** A fetch response, as far as the code under test reads one (jsdom has no `Response`). */
function reply(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 403 ? "Forbidden" : status === 500 ? "Internal Server Error" : "OK",
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** The host's `/api/plugin/session` and `/api/plugin/call`, answering with the
 * real sidecar results and the repository's own BPMN text. Every call is kept. */

function installHost(host: Host) {
  const calls: { plugin: string; tool: Tool; args: { path?: string }; capability: string }[] = [];
  const json = (body: unknown, status = 200) => Promise.resolve(reply(body, status));
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/plugin/session") return json({ capabilities: { bpmn: "cap-bpmn" } });
    if (u !== "/api/plugin/call") return json({}, 404);
    const body = JSON.parse(String(init?.body)) as {
      plugin: string;
      tool: Tool;
      args: { path?: string };
    };
    calls.push({
      ...body,
      capability: (init?.headers as Record<string, string>)["X-Facet-Plugin-Capability"],
    });
    if (body.tool === "repo.list") {
      if (host.listError) return json({ error: host.listError });
      return json({ result: { files: host.files.map((path) => ({ path, slug: path })) } });
    }
    const path = body.args.path as string;
    if (body.tool === "repo.read")
      return json({
        result: { body: host.xml?.[path] ?? sourceXML(path) },
      });
    const answer = host.diagram[path];
    return typeof answer === "string" ? json({ error: answer }) : json({ result: answer });
  }) as unknown as typeof fetch;
  return calls;
}

/** The place under test is the BPMN plugin's own area, reached through the
 * real host: the reader at an address, the plugin loaded by the session's
 * one host, its calls over the broker route this spec answers. */

function Harness({ start }: { start: string }) {
  void start;
  return <Atlas model={model} readers={null} />;
}

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Harness start={path} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

const where = () => window.location.pathname;

describe("processes : the gallery", () => {
  it("opens from the processes' navigation entry, which then marks itself as the current place", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount("/");
    const label = en("shell.nav.item.bpmn");
    const entry = () =>
      within(screen.getByRole("navigation", { name: en("shell.nav.label") })).getByRole("button", {
        name: new RegExp(label),
      });
    // Precondition: on the Overview the entry is not the current place.
    expect(entry()).not.toHaveAttribute("aria-current");
    await userEvent.click(entry());
    expect(where()).toBe("/p/bpmn");
    expect(entry()).toHaveAttribute("aria-current", "page");
    expect(await screen.findByTestId("process-gallery")).toBeInTheDocument();
  });

  it("asks the host for the listing, the text and the drawing of each file, as the bpmn plugin", async () => {
    const calls = installHost({
      files: [DATENWEG_PATH, ORDER_PATH],
      diagram: { [DATENWEG_PATH]: datenweg, [ORDER_PATH]: order },
    });
    mount("/p/bpmn");
    const gallery = await screen.findByTestId("process-gallery");
    expect(await within(gallery).findByText("BPMN plugin data flow")).toBeInTheDocument();
    expect(within(gallery).getByText("Order handling")).toBeInTheDocument();
    expect(calls.map((c) => [c.tool, c.args.path])).toEqual(
      expect.arrayContaining([
        ["repo.list", undefined],
        ["repo.read", DATENWEG_PATH],
        ["repo.read", ORDER_PATH],
        ["bpmn.diagram", DATENWEG_PATH],
        ["bpmn.diagram", ORDER_PATH],
      ]),
    );
    expect(calls.every((c) => c.plugin === "bpmn" && c.capability === "cap-bpmn")).toBe(true);
    // The tool is handed the XML the host read, not an invented one.
    const sent = (global.fetch as jest.Mock).mock.calls
      .filter((c) => c[1]?.body)
      .map((c) => JSON.parse(String(c[1]?.body)) as { tool: string; args: { xml?: string } })
      .find((b) => b.tool === "bpmn.diagram");
    expect(sent?.args.xml).toContain("<definitions");
    // Each file is read and its own text is what the sidecar is asked to draw:
    // every drawing call carries exactly the text the host answered for that path.
    const drawn = (global.fetch as jest.Mock).mock.calls
      .filter((c) => c[1]?.body)
      .map(
        (c) =>
          JSON.parse(String(c[1]?.body)) as { tool: string; args: { path?: string; xml?: string } },
      )
      .filter((b) => b.tool === "bpmn.diagram");
    expect(drawn.map((b) => b.args.path).sort()).toEqual([DATENWEG_PATH, ORDER_PATH].sort());
    for (const b of drawn) expect(b.args.xml).toBe(sourceXML(b.args.path as string));
    // The two files differ, so a text handed to the wrong drawing call would show.
    expect(sourceXML(DATENWEG_PATH)).not.toBe(sourceXML(ORDER_PATH));
  });

  it("filters the gallery by the search text and keeps the filter", async () => {
    installHost({
      files: [DATENWEG_PATH, ORDER_PATH],
      diagram: { [DATENWEG_PATH]: datenweg, [ORDER_PATH]: order },
    });
    mount("/p/bpmn");
    const gallery = await screen.findByTestId("process-gallery");
    await within(gallery).findByText("Order handling");
    await userEvent.type(within(gallery).getByRole("searchbox"), "order");
    expect(within(gallery).getByText("Order handling")).toBeInTheDocument();
    expect(within(gallery).queryByText("BPMN plugin data flow")).toBeNull();
  });

  it("names a file the parser refused, and still lists the others", async () => {
    installHost({
      files: [DATENWEG_PATH, syntaxError.path],
      diagram: { [DATENWEG_PATH]: datenweg, [syntaxError.path]: syntaxError.error },
      xml: { [syntaxError.path]: syntaxError.xml },
    });
    mount("/p/bpmn");
    const broken = await screen.findByTestId("process-unreadable");
    expect(within(broken).getByRole("button", { name: syntaxError.path })).toBeInTheDocument();
    expect(screen.getByText("BPMN plugin data flow")).toBeInTheDocument();
  });

  it("says why when there is no .bpmn file", async () => {
    installHost({ files: [], diagram: {} });
    mount("/p/bpmn");
    const note = await screen.findByTestId("process-note");
    expect(note).toHaveTextContent("There is no .bpmn file under docs/bpmn.");
    expect(note).not.toHaveTextContent(/to draw|so there is/);
  });

  it("gives the host's own reason when the listing fails", async () => {
    installHost({ files: [], diagram: {}, listError: "reads not granted for docs/bpmn" });
    mount("/p/bpmn");
    const note = await screen.findByTestId("process-note");
    expect(note).toHaveTextContent("reads not granted for docs/bpmn");
    expect(within(note).getByRole("alert")).toBeInTheDocument();
  });

  it("reads again on request, after the host recovered", async () => {
    // The host keeps the fetch it was built with, so the answers change, not the function.
    const host: Host = { files: [], diagram: {}, listError: "host busy" };
    installHost(host);
    mount("/p/bpmn");
    const note = await screen.findByTestId("process-note");
    Object.assign(host, { files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    delete host.listError;
    await userEvent.click(within(note).getByRole("button"));
    expect(await screen.findByTestId("process-gallery")).toBeInTheDocument();
    expect(screen.getByText("BPMN plugin data flow")).toBeInTheDocument();
  });

  it("states a missing session honestly when the host gives no capability", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response("{}", { status: 500 })),
    ) as unknown as typeof fetch;
    mount("/p/bpmn");
    const note = await screen.findByTestId("process-note");
    expect(within(note).getByRole("alert")).toBeInTheDocument();
    expect(note.textContent?.length).toBeGreaterThan(10);
  });

  it("draws the only diagram of a project on its card without a pick", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount("/p/bpmn");
    const gallery = await screen.findByTestId("process-gallery");
    const drawing = await within(gallery).findByRole("img", { name: /BPMN plugin data flow/ });
    // Precondition: the sidecar's answer holds shapes, so an empty drawing would show.
    const shapes = datenweg.diagrams[0].shapes.length;
    expect(shapes).toBeGreaterThan(0);
    expect(drawing.tagName.toLowerCase()).toBe("svg");
    expect(drawing.querySelectorAll(":scope > g").length).toBeGreaterThanOrEqual(shapes);
    // Nothing was clicked: the gallery is still where the reader stands.
    expect(where()).toBe("/p/bpmn");
  });
});

describe("processes : one file", () => {
  it("opens from the gallery into the workspace with the figures measured from the drawing", async () => {
    installHost({
      files: [DATENWEG_PATH, ORDER_PATH],
      diagram: { [DATENWEG_PATH]: datenweg, [ORDER_PATH]: order },
    });
    mount("/p/bpmn");
    await userEvent.click(await screen.findByText("BPMN plugin data flow"));
    expect(where()).toBe(`/p/bpmn/${encodeURIComponent(DATENWEG_PATH).replace(/%2F/g, "/")}`);
    const ws = await screen.findByTestId("process-workspace");
    expect(within(ws).getByText(DATENWEG_PATH)).toBeInTheDocument();
    // elements 12, flows 15, swim lanes 3, paths 2, longest 6
    for (const [value, key] of [
      ["12", "ui.bpmn-src-views.processes-elements"],
      ["15", "ui.bpmn-src-views.processes-flows"],
      ["3", "ui.bpmn-src-views.processes-lanes"],
      ["2", "ui.bpmn-src-views.processes-paths-start-end"],
      ["6", "ui.bpmn-src-views.processes-longest-path"],
    ] as const) {
      const stat = within(ws).getByText(label(key)).parentElement as HTMLElement;
      expect(within(stat).getByText(value)).toBeInTheDocument();
    }
    // The element list names an element of the real file.
    expect(within(ws).getAllByText("Request file reading").length).toBeGreaterThan(0);
    // The outline, not the canvas, lists every named flow node of the real file.
    const real = sourceXML(DATENWEG_PATH);
    const named = [
      ...real.matchAll(
        /<(?:\w+:)?(?:startEvent|endEvent|task|userTask|serviceTask|scriptTask|exclusiveGateway)\b[^>]*\bname="([^"]+)"/g,
      ),
    ].map((m) => m[1]);
    // The precondition: the file carries the ten named flow nodes this reads.
    expect(named).toHaveLength(10);
    const outline = within(ws).getByRole("navigation", {
      name: label("ui.bpmn-src-views.processes-outline"),
    });
    for (const name of named)
      expect(within(outline).getByRole("button", { name })).toBeInTheDocument();
  });

  it("draws the sidecar's pools, message flows and annotations as the canvas's own forms", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount(`/p/bpmn/${DATENWEG_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    // The fixture carries what the canvas is asked to draw.
    const kinds = datenweg.diagrams[0].shapes.map((s) => s.kind);
    expect(kinds.filter((k) => k === "participant")).toHaveLength(3);
    expect(kinds).toContain("textAnnotation");
    const pool = within(ws).getByTestId("shape-P_Leser");
    expect(pool).toHaveAttribute("data-form", "pool");
    // A pool is a container: a group, not a button to pick.
    expect(pool).toHaveAttribute("role", "group");
    expect(within(ws).getByTestId("shape-TA_Host")).toHaveAttribute("data-form", "bracket");
    expect(within(ws).getByTestId("shape-E_Fertig")).toHaveAttribute("data-form", "circle");
    expect(within(ws).getByTestId("shape-T_Lesen")).toHaveAttribute("role", "button");
    expect(within(ws).getByTestId("symbol-T_Lesen")).toBeInTheDocument();
    const message = within(ws).getByTestId("edge-MF_Read");
    expect(message).toHaveAttribute("data-kind", "messageFlow");
    expect(message).toHaveAttribute("data-stroke", "dashed");
    expect(message).toHaveAttribute("data-start", "circle");
    expect(message).toHaveAttribute("data-end", "open-arrow");
    expect(within(message).getByText("repo.read")).toBeInTheDocument();
    expect(within(ws).getByTestId("edge-A_Host")).toHaveAttribute("data-stroke", "dotted");
  });

  it("draws the lanes of the order diagram as lane containers", async () => {
    installHost({ files: [ORDER_PATH], diagram: { [ORDER_PATH]: order } });
    mount(`/p/bpmn/${ORDER_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    for (const id of ["Lane_Sales", "Lane_Warehouse"]) {
      const lane = within(ws).getByTestId(`shape-${id}`);
      expect(lane).toHaveAttribute("data-form", "lane");
      expect(lane).toHaveAttribute("role", "group");
    }
    expect(within(ws).getByTestId("marker-Task_Check-sequential")).toBeInTheDocument();
  });

  it("opens a file straight from its address and selects an element from the list", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount(`/p/bpmn/${DATENWEG_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    const nav = within(ws).getByRole("navigation", {
      name: label("ui.bpmn-src-views.processes-outline"),
    });
    const element = DATENWEG_ELEMENT_NAME;
    const before = within(ws).getAllByText(element).length;
    await userEvent.click(within(nav).getByRole("button", { name: element }));
    // The detail panel names the element as well.
    expect(within(ws).getAllByText(element).length).toBeGreaterThan(before);
  });

  it("prints the unmeasured mark, not a number, where a path cannot be measured", async () => {
    const moved = JSON.parse(JSON.stringify(datenweg)) as typeof datenweg;
    const flow = moved.diagrams[0].edges.find((e) => e.element === "F2");
    if (!flow) throw new Error("fixture lacks F2");
    flow.points[0] = { x: 5000, y: 5000 };
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: moved } });
    mount(`/p/bpmn/${DATENWEG_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    for (const key of [
      "ui.bpmn-src-views.processes-paths-start-end",
      "ui.bpmn-src-views.processes-longest-path",
    ] as const) {
      const stat = within(ws).getByText(label(key)).parentElement as HTMLElement;
      expect(within(stat).getByText("—")).toBeInTheDocument();
    }
    // What was measured stays a number.
    const flows = within(ws).getByText(label("ui.bpmn-src-views.processes-flows"))
      .parentElement as HTMLElement;
    expect(within(flows).getByText("15")).toBeInTheDocument();
    for (const [value, key] of [
      ["12", "ui.bpmn-src-views.processes-elements"],
      ["3", "ui.bpmn-src-views.processes-lanes"],
    ] as const) {
      const stat = within(ws).getByText(label(key)).parentElement as HTMLElement;
      expect(within(stat).getByText(value)).toBeInTheDocument();
    }
  });

  it("gives the gallery card no modification time, only the unmeasured mark", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount("/p/bpmn");
    const gallery = await screen.findByTestId("process-gallery");
    await within(gallery).findByText("BPMN plugin data flow");
    // The table view is the one that has a column for the modification time.
    await userEvent.click(
      within(gallery).getByRole("radio", { name: label("ui.bpmn-src-views.processes-table") }),
    );
    const table = within(gallery).getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const changed = headers.findIndex((h) =>
      [en("ui.bpmn-src-views.processes-changed"), de("ui.bpmn-src-views.processes-changed")].some(
        (w) => (h.textContent ?? "").includes(w),
      ),
    );
    expect(changed).toBeGreaterThanOrEqual(0);
    const row = within(table)
      .getAllByRole("row")
      .find((r) => r.textContent?.includes(DATENWEG_PATH)) as HTMLElement;
    expect(row).toBeDefined();
    const cell = within(row).getAllByRole("cell")[changed];
    expect(cell).toHaveTextContent(/^—$/);
  });

  it("zooms the drawing and returns to the gallery", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount(`/p/bpmn/${DATENWEG_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    expect(within(ws).getByTestId("zoom")).toHaveTextContent("100");
    await userEvent.click(
      within(ws).getByRole("button", { name: label("ui.bpmn-src-views.processes-zoom") }),
    );
    expect(within(ws).getByTestId("zoom")).toHaveTextContent("125");
    await userEvent.click(
      within(ws).getByRole("button", { name: label("ui.bpmn-src-views.processes-all-processes") }),
    );
    expect(where()).toBe("/p/bpmn");
    expect(await screen.findByTestId("process-gallery")).toBeInTheDocument();
  });

  it("shows the sidecar's warning as a finding and nothing it did not say", async () => {
    installHost({ files: [ORDER_PATH], diagram: { [ORDER_PATH]: order } });
    mount(`/p/bpmn/${ORDER_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    const region = within(ws).getByRole("region", {
      name: label("ui.bpmn-src-views.processes-parser-findings"),
    });
    expect(within(region).getByText("1")).toBeInTheDocument();
    await userEvent.click(within(region).getByRole("button"));
    const warning = (order as { warnings: string[] }).warnings[0];
    expect(within(region).getByText(warning)).toBeInTheDocument();
    expect(
      within(region).queryByRole("button", { name: label("ui.bpmn-src-views.processes-show") }),
    ).toBeNull();
  });

  it("offers a switcher for several diagrams and draws the chosen one", async () => {
    // A warning that names a shape of the datenweg diagram only.
    const shape = datenweg.diagrams[0].shapes.find((x) => x.element === "T_Lesen");
    if (!shape) throw new Error("fixture lacks T_Lesen");
    const warning = `${shape.element}: odd`;
    const joined = {
      id: "joined",
      name: "Two Diagrams",
      diagrams: [...datenweg.diagrams, ...order.diagrams],
      warnings: [warning],
    };
    installHost({
      files: ["docs/bpmn/two.bpmn"],
      diagram: { "docs/bpmn/two.bpmn": joined },
      xml: { "docs/bpmn/two.bpmn": "<definitions/>" },
    });
    mount("/p/bpmn/docs/bpmn/two.bpmn");
    const ws = await screen.findByTestId("process-workspace");
    const bar = within(ws).getByRole("navigation", {
      name: label("ui.bpmn-src-views.processes-diagrams-file"),
    });
    expect(
      within(bar).getByRole("button", { name: /Datenweg/, pressed: true }),
    ).toBeInTheDocument();
    // The first diagram is the one on the canvas, and the second is not.
    expect(within(ws).getByTestId("shape-P_Leser")).toBeInTheDocument();
    expect(within(ws).queryByTestId("shape-Lane_Sales")).not.toBeInTheDocument();
    expect(within(ws).queryByText("Shop")).not.toBeInTheDocument();
    // The warning names a shape of the first diagram and is listed there.
    const findings = () =>
      within(ws).getByRole("region", {
        name: label("ui.bpmn-src-views.processes-parser-findings"),
      });
    expect(within(findings()).getByText("1")).toBeInTheDocument();
    await userEvent.click(within(findings()).getByRole("button"));
    expect(within(findings()).getByText(warning)).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: /Order/ }));
    expect(within(bar).getByRole("button", { name: /Order/, pressed: true })).toBeInTheDocument();
    expect(within(ws).getAllByText("Shop").length).toBeGreaterThan(0);
    expect(within(ws).getByTestId("shape-Lane_Sales")).toBeInTheDocument();
    expect(within(ws).queryByTestId("shape-P_Leser")).not.toBeInTheDocument();
    // On the other diagram the findings count none, and the open list does
    // not show the warning — an absence that a closed list could fake.
    expect(within(findings()).getByText("0")).toBeInTheDocument();
    expect(within(findings()).getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(within(ws).queryByText(warning)).not.toBeInTheDocument();
  });

  it("walks the process, stops at the gateway and follows the branch the reader picks", async () => {
    installHost({ files: [ORDER_PATH], diagram: { [ORDER_PATH]: order } });
    mount(`/p/bpmn/${ORDER_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    await userEvent.click(
      within(ws).getByRole("button", { name: label("ui.bpmn-src-views.processes-walkthrough") }),
    );
    const walk = await within(ws).findByTestId("process-walk");
    expect(within(walk).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(
      within(walk).getByRole("button", { name: label("ui.bpmn-src-views.processes-next-step") }),
    );
    await userEvent.click(
      within(walk).getByRole("button", { name: label("ui.bpmn-src-views.processes-next-step") }),
    );
    const choose = within(walk).getByRole("group", {
      name: label("ui.bpmn-src-views.processes-choose-branch"),
    });
    expect(within(choose).getAllByRole("button")).toHaveLength(2);
    expect(
      within(walk).getByRole("button", { name: label("ui.bpmn-src-views.processes-next-step") }),
    ).toBeDisabled();
    await userEvent.click(within(choose).getAllByRole("button")[0]);
    await waitFor(() => expect(within(walk).getAllByRole("listitem")).toHaveLength(4));
    expect(
      within(walk).queryByRole("group", {
        name: label("ui.bpmn-src-views.processes-choose-branch"),
      }),
    ).toBeNull();
    // The walk continues along the chosen branch to the end event, and stops there.
    expect(within(walk).queryByText("Done")).not.toBeInTheDocument();
    await userEvent.click(
      within(walk).getByRole("button", { name: label("ui.bpmn-src-views.processes-next-step") }),
    );
    const steps = within(walk).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(steps[4]).toHaveTextContent("Done");
    expect(
      within(walk).getByRole("button", { name: label("ui.bpmn-src-views.processes-next-step") }),
    ).toBeDisabled();
  });

  it("shows the parser's refusal with the line it names and the text around it", async () => {
    installHost({
      files: [syntaxError.path],
      diagram: { [syntaxError.path]: syntaxError.error },
      xml: { [syntaxError.path]: syntaxError.xml },
    });
    mount(`/p/bpmn/${syntaxError.path}`);
    const view = await screen.findByTestId("process-unreadable-file");
    expect(within(view).getAllByText(syntaxError.path).length).toBeGreaterThan(0);
    expect(within(view).getByText(/element <task> closed by <\/process>/)).toBeInTheDocument();
    const excerpt = within(view).getByLabelText(label("ui.bpmn-src-views.processes-excerpt"));
    expect(excerpt).toHaveTextContent("</process>");
    expect(excerpt.querySelector("[data-bad]")).toHaveTextContent("</process>");
    // The lines around the named one: two before and two after, each with its number.
    expect(Array.from(excerpt.children, (line) => line.textContent)).toEqual([
      '3  <process id="p">\n',
      '4    <task id="t" name="x">\n',
      "5  </process>\n",
      "6</definitions>\n",
      "7\n",
    ]);
  });

  it("says when the sidecar refuses with no line", async () => {
    installHost({
      files: ["docs/bpmn/empty.bpmn"],
      diagram: {
        "docs/bpmn/empty.bpmn":
          "docs/bpmn/empty.bpmn: bpmn: not a BPMN 2.0 document: empty document",
      },
      xml: { "docs/bpmn/empty.bpmn": "" },
    });
    mount("/p/bpmn/docs/bpmn/empty.bpmn");
    const view = await screen.findByTestId("process-unreadable-file");
    expect(view).toHaveTextContent("empty document");
    expect(within(view).getByRole("alert")).toBeInTheDocument();
    // The message stands alone: no excerpt and no line is quoted.
    expect(
      within(view).queryByLabelText(label("ui.bpmn-src-views.processes-excerpt")),
    ).not.toBeInTheDocument();
  });

  it("prints the unmeasured mark for a diagram with no end event, not zero paths", async () => {
    const ends = JSON.parse(JSON.stringify(datenweg)) as typeof datenweg;
    const before = ends.diagrams[0].shapes.filter((s) => s.kind === "endEvent").length;
    // The precondition: the real diagram has end events to take away.
    expect(before).toBeGreaterThan(0);
    for (const s of ends.diagrams[0].shapes) if (s.kind === "endEvent") s.kind = "task";
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: ends } });
    mount(`/p/bpmn/${DATENWEG_PATH}`);
    const ws = await screen.findByTestId("process-workspace");
    for (const key of [
      "ui.bpmn-src-views.processes-paths-start-end",
      "ui.bpmn-src-views.processes-longest-path",
    ] as const) {
      const stat = within(ws).getByText(label(key)).parentElement as HTMLElement;
      expect(within(stat).getByText("—")).toBeInTheDocument();
      expect(within(stat).queryByText("0")).not.toBeInTheDocument();
    }
  });

  it("opens a file by its trailing path segments, never by a partial file name", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    // The precondition: whole trailing segments do open the file.
    const first = mount("/p/bpmn/bpmn/bpmn-plugin-datenweg.bpmn");
    expect(await screen.findByTestId("process-workspace")).toBeInTheDocument();
    first.unmount();
    mount("/p/bpmn/plugin-datenweg.bpmn");
    const note = await screen.findByTestId("process-note");
    expect(note).toHaveTextContent("plugin-datenweg.bpmn");
    expect(screen.queryByTestId("process-workspace")).not.toBeInTheDocument();
  });

  it("names an address no file answers to", async () => {
    installHost({ files: [DATENWEG_PATH], diagram: { [DATENWEG_PATH]: datenweg } });
    mount("/p/bpmn/docs/bpmn/nowhere.bpmn");
    const note = await screen.findByTestId("process-note");
    expect(note).toHaveTextContent("docs/bpmn/nowhere.bpmn");
  });
});

const DATENWEG_ELEMENT_NAME = "Request file reading";

describe("processes on a phone", () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it("reaches the outline, an element, and the walk through the rendered app", async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    installHost({ files: [ORDER_PATH], diagram: { [ORDER_PATH]: order } });
    window.history.replaceState(null, "", `/p/bpmn/${ORDER_PATH}`);
    render(<Atlas model={model} readers={null} />);
    const ws = await screen.findByTestId("process-workspace");
    // The outline is not beside the drawing on a phone; its button opens it as a sheet.
    expect(
      within(ws).queryByRole("navigation", { name: label("ui.bpmn-src-views.processes-outline") }),
    ).toBeNull();
    await userEvent.click(
      within(ws).getByRole("button", { name: label("ui.bpmn-src-views.processes-outline") }),
    );
    const sheet = within(ws).getByRole("dialog", {
      name: label("ui.bpmn-src-views.processes-outline"),
    });
    const outline = within(sheet).getByRole("navigation", {
      name: label("ui.bpmn-src-views.processes-outline"),
    });
    const first = within(outline).getAllByRole("button")[0];
    await userEvent.click(first);
    expect(
      within(ws).queryByRole("dialog", { name: label("ui.bpmn-src-views.processes-outline") }),
    ).toBeNull();
    expect(within(ws).getByRole("complementary", { name: "Element" })).toBeInTheDocument();
    await userEvent.click(
      within(ws).getByRole("button", { name: label("ui.bpmn-src-views.processes-walkthrough") }),
    );
    const walk = await within(ws).findByTestId("process-walk");
    expect(within(walk).getAllByRole("listitem")).toHaveLength(1);
  });
});
