import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initialStatus, type IndexStatus } from "@/model";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { taskflowModel } from "@/model/fixtures";
import Atlas, { placeOf } from "./Atlas";
import { bootView } from "./AtlasLive";
import { loadTheme, useAtlas } from "./useAtlas";
import { parse, type Route } from "./route";
import i18n from "@/i18n";
import type { T } from "./text";
import { HISTORY_KEY, placeLabel, type Place } from "./history";

describe("place names", () => {
  const cases: [string, Partial<Place>][] = [
    ["/", { name: { id: "overview" }, kind: "overviewPage" }],
    ["/product", { name: { id: "product" }, kind: "area" }],
    ["/records", { name: { id: "records" }, kind: "area" }],
    ["/domain/navigation", { name: { id: "area", arg: "navigation" }, kind: "overview" }],
    [
      "/domain/navigation/atlas",
      { name: { id: "capability", arg: "atlas" }, kind: "overview", sub: "navigation" },
    ],
    [
      "/record/documents/decisions/adr-plugin",
      { label: "adr-plugin", kind: "record", sub: "documents/decisions" },
    ],
    ["/contents", { name: { id: "contents", arg: undefined }, kind: "content" }],
    ["/contents/drift", { name: { id: "contents", arg: "drift" }, kind: "content" }],
    ["/glossary", { name: { id: "glossary" } }],
    ["/glossary/Anchor", { label: "Anchor" }],
    ["/settings/appearance", { name: { id: "settings" }, sub: "appearance" }],
    ["/p/notes/getting-started.md", { label: "notes", kind: "plugin", sub: "getting-started.md" }],
    ["/p/adr", { label: "adr", kind: "plugin", sub: undefined }],
    ["/ask", { name: { id: "ask" } }],
    ["/nowhere", { label: "/nowhere" }],
  ];
  // One test over every case, so the runner reports a name a record can cite;
  // the path is part of each match, so a failure still says which place broke.
  it("names every kind of place for the place list", () => {
    for (const [path, expected] of cases) {
      expect(placeOf(parse(path), path, 5)).toMatchObject({ path, at: 5, ...expected });
    }
  });

  it("words a fixed place name in the language the list is drawn in", () => {
    const place = placeOf(parse("/domain/navigation"), "/domain/navigation", 5);
    const tIn = (language: string) => i18n.getFixedT(language) as unknown as T;
    expect(placeLabel(place, tIn("de"))).toBe(
      germanLabel("Area {{name}}").replace("{{name}}", "navigation"),
    );
    expect(placeLabel(place, tIn("en"))).toBe("Area navigation");
  });

  it("resolves the Git provider settings alias", () => {
    expect(parse("/settings/forge")).toEqual({ area: "settings", section: "git-provider" });
  });
});

describe("boot screen", () => {
  const status = (s: Partial<IndexStatus>): IndexStatus =>
    ({ ...initialStatus, ...s }) as IndexStatus;

  it("shows no share while the files are still being counted", () => {
    expect(bootView(status({ phase: "enumerate", total: 40, done: 3 })).progress).toBeNull();
    expect(bootView(status({ phase: "records", total: 0 })).progress).toBeNull();
  });

  it("shows a measured share and counts, a zero the search took, and a dash for what was not taken", () => {
    const view = bootView(
      status({
        phase: "index",
        total: 100,
        done: 50,
        records: 220,
        files: 1852,
        anchors: 0,
        file: "a.go",
      }),
    );
    expect(view.progress).toBeGreaterThan(0);
    // The search for anchors has reported: no anchor found so far is a measured 0.
    expect(view.counts).toEqual({ records: 220, files: 1852, anchors: 0 });
    // Still counting the tree: the records were taken; files and anchors remain.
    expect(bootView(status({ phase: "enumerate", records: 0 })).counts).toEqual({
      records: 0,
      files: null,
      anchors: null,
    });
    expect(bootView(status({ phase: "records" })).counts).toEqual({
      records: null,
      files: null,
      anchors: null,
    });
    expect(view.file).toBe("a.go");
    expect(bootView(status({ phase: "ready" })).progress).toBe(100);
  });
});

describe("palette", () => {
  it("restores a stored palette and falls back to the system preference otherwise", () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(loadTheme(store(JSON.stringify({ theme: "paper", mode: "light" })), false)).toEqual({
      theme: "paper",
      mode: "light",
    });
    expect(loadTheme(store(JSON.stringify({ theme: "neon", mode: "light" })), false)).toEqual({
      theme: "facet",
      mode: "dark",
      system: true,
    });
    expect(loadTheme(store("{broken"), true)).toEqual({
      theme: "facet",
      mode: "light",
      system: true,
    });
    expect(loadTheme(undefined, false)).toEqual({ theme: "facet", mode: "dark", system: true });
  });
});

function Probe() {
  const app = useAtlas((route: Route, path: string) => placeOf(route, path, 0));
  return (
    <div>
      <p data-testid="path">{app.path}</p>
      <p data-testid="cursor">
        {app.history.cursor}/{app.history.places.length}
      </p>
      <p data-testid="theme">{app.theme.mode}</p>
      <button type="button" onClick={() => app.go("/product")}>
        product
      </button>
      <button type="button" onClick={() => app.go("/record/a/b/c")}>
        record
      </button>
      <button type="button" onClick={app.back}>
        back
      </button>
      <button type="button" onClick={app.forward}>
        forward
      </button>
      <button type="button" onClick={() => app.jump(0)}>
        first
      </button>
      <button type="button" onClick={app.clear}>
        clear
      </button>
      <button type="button" onClick={() => app.setTheme({ theme: "facet", mode: "light" })}>
        light
      </button>
    </div>
  );
}

describe("address and history in step", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("visits, goes back and forward through the address, jumps and clears", async () => {
    render(<Probe />);
    expect(screen.getByTestId("cursor")).toHaveTextContent("0/1");
    await userEvent.click(screen.getByRole("button", { name: "product" }));
    await userEvent.click(screen.getByRole("button", { name: "record" }));
    expect(window.location.pathname).toBe("/record/a/b/c");
    expect(screen.getByTestId("cursor")).toHaveTextContent("2/3");

    await userEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/product");
    expect(screen.getByTestId("cursor")).toHaveTextContent("1/3");

    await userEvent.click(screen.getByRole("button", { name: "forward" }));
    expect(screen.getByTestId("cursor")).toHaveTextContent("2/3");

    // The browser's own back button lands on the neighbour: the cursor moves.
    window.history.replaceState(null, "", "/product");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(screen.getByTestId("cursor")).toHaveTextContent("1/3");

    await userEvent.click(screen.getByRole("button", { name: "first" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/");
    expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}").cursor).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByTestId("cursor")).toHaveTextContent("0/1");

    await userEvent.click(screen.getByRole("button", { name: "product" }));
    await userEvent.click(screen.getByRole("button", { name: "product" }));
    expect(screen.getByTestId("cursor")).toHaveTextContent("1/2");
  });

  it("stores the chosen palette", async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "light" }));
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(window.localStorage.getItem("facet.atlas.theme")).toContain("light");
  });
});

describe("document scroll", () => {
  // globals.css holds the app at the window height; this mark is what lets
  // the document grow instead. Layout itself is measured in a browser by
  // runScrollContract.
  it("marks the page as the reader while the reader is mounted and removes the mark after", () => {
    const root = document.documentElement;
    // The precondition: nothing else set the mark before the reader was mounted.
    expect(root.dataset.atlas).toBeUndefined();
    const view = render(<Atlas model={taskflowModel()} readers={null} />);
    expect(root.dataset.atlas).toBe("reader");
    view.unmount();
    expect(root.dataset.atlas).toBeUndefined();
  });

  it("releases the window-high page only under the mark", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ");
    // The precondition: the page is held at the window height, which the mark must undo.
    expect(css).toMatch(/#atlas \{ height: 100%;/);
    const rule = css.match(/html\[data-atlas="reader"\][^{]*\{([^}]*)\}/);
    expect(rule?.[0]).toContain('html[data-atlas="reader"] body');
    expect(rule?.[0]).toContain('html[data-atlas="reader"] #atlas');
    expect(rule?.[1]).toContain("overflow: visible");
    expect(rule?.[1]).toContain("height: auto");
  });
});

it("reads the palette from exactly one storage key", () => {
  const getItem = jest.fn(() => null);
  loadTheme({ getItem }, false);
  expect(getItem.mock.calls).toEqual([["facet.atlas.theme"]]);
});
