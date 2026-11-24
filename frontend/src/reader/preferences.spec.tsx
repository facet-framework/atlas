/** The five reader choices of the settings page, each proven where it acts:
 * the shell's attributes, the stored history, the address after a fresh
 * start, and the chat sessions after a reload. The stored value is never the
 * evidence on its own. */

import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentState, AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import type { HostReaders } from "./host";
import { atlasT, uiT } from "./testing";
import { HISTORY_KEY, trim, type Place } from "./history";
import { PREFERENCES_KEY, parseHistoryLimit, readPreferences } from "./preferences";

const model = taskflowModel();
const t = atlasT("en");
const tt = uiT("en");
const realMatchMedia = window.matchMedia;

const SIGNED_IN: AgentState = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [{ id: "", label: "Default" }],
  model: "",
};

const readers: HostReaders = {
  repo: async () => {
    throw new Error("no repository in this spec");
  },
  agent: async () => SIGNED_IN,
  tools: async () => {
    throw new Error("no tools in this spec");
  },
  installed: async () => [],
};

const silent = (): AgentStream => ({ addEventListener: () => undefined, close: () => undefined });

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={readers} openStream={silent} />);
  // The host's state arrives after the first paint.
  await act(async () => undefined);
  return view;
}

/** A browser that asks for reduced motion (or not), and nothing else. */
function systemMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const shell = () => screen.getByTestId("app-shell");
const where = () => window.location.pathname;
const segment = (name: string) => screen.getByRole("radiogroup", { name });
const storedPlaces = () =>
  (JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}") as { places?: Place[] }).places ??
  [];

function seedHistory(paths: string[]) {
  const places = paths.map((path, i) => ({ path, label: path, kind: "area", at: i }));
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify({ places, cursor: places.length - 1 }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  systemMotion(false);
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("settings, density", () => {
  it("sets the whole shell compact or wide and keeps it on the next start", async () => {
    const first = await mount("/settings");
    expect(shell()).not.toHaveAttribute("data-density");
    await userEvent.click(
      within(segment(tt("ui.screens-contents.settings-density"))).getByRole("radio", {
        name: tt("ui.screens-contents.settings-compact"),
      }),
    );
    expect(shell()).toHaveAttribute("data-density", "compact");
    first.unmount();

    const again = await mount("/product");
    expect(shell()).toHaveAttribute("data-density", "compact");
    again.unmount();

    await mount("/settings");
    await userEvent.click(
      within(segment(tt("ui.screens-contents.settings-density"))).getByRole("radio", {
        name: tt("ui.screens-contents.settings-wide"),
      }),
    );
    expect(shell()).toHaveAttribute("data-density", "spacious");
    await userEvent.click(
      within(segment(tt("ui.screens-contents.settings-density"))).getByRole("radio", {
        name: "Normal",
      }),
    );
    expect(shell()).not.toHaveAttribute("data-density");
  });
});

describe("settings, motion", () => {
  it("offers only System and Reduced, and Reduced marks the shell until System is picked", async () => {
    const first = await mount("/settings");
    const motion = () => segment(tt("ui.screens-contents.settings-motion"));
    expect(
      within(motion())
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["System", tt("ui.screens-contents.settings-reduced")]);
    expect(shell()).not.toHaveAttribute("data-motion");
    await userEvent.click(
      within(motion()).getByRole("radio", { name: tt("ui.screens-contents.settings-reduced") }),
    );
    expect(shell()).toHaveAttribute("data-motion", "reduced");
    first.unmount();

    const again = await mount("/records");
    expect(shell()).toHaveAttribute("data-motion", "reduced");
    again.unmount();

    await mount("/settings");
    await userEvent.click(within(motion()).getByRole("radio", { name: "System" }));
    expect(shell()).not.toHaveAttribute("data-motion");

    // The mark is what the stylesheet Atlas ships turns every animation and transition off on.
    const css = readFileSync(
      join(dirname(require.resolve("@facet-tools/ui/package.json")), "dist/styles.css"),
      "utf8",
    );
    const rule = /\.t-shell\[data-motion="reduced"\] \*,[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/animation:\s*none !important/);
    expect(rule).toMatch(/transition:\s*none !important/);
  });

  it("marks the shell reduced when the system asks for it, without any choice", async () => {
    systemMotion(true);
    await mount("/");
    expect(shell()).toHaveAttribute("data-motion", "reduced");
    expect(window.localStorage.getItem(PREFERENCES_KEY)).toBeNull();
  });
});

describe("settings, history maximum", () => {
  it("cuts the stored history to the typed maximum at once and keeps it there", async () => {
    seedHistory(["/product", "/records", "/glossary", "/contents"]);
    await mount("/settings/history");
    expect(storedPlaces()).toHaveLength(5);
    const limit = screen.getByRole("textbox", {
      name: tt("ui.screens-contents.settings-maximum"),
    });
    expect(limit).toHaveValue("200");

    await userEvent.clear(limit);
    await userEvent.type(limit, "3");
    expect(storedPlaces().map((p) => p.path)).toEqual([
      "/glossary",
      "/contents",
      "/settings/history",
    ]);
    // The place menu lists what the history holds.
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    const menu = screen.getByRole("menu", { name: "History" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    await userEvent.keyboard("{Escape}");

    // A visit to a new place still keeps three.
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", {
        name: "Product",
      }),
    );
    expect(where()).toBe("/product");
    expect(storedPlaces().map((p) => p.path)).toEqual([
      "/contents",
      "/settings/history",
      "/product",
    ]);
  });

  it("refuses a maximum that is not a whole number from 1 to 1000 and keeps the last one", async () => {
    seedHistory(["/product", "/records"]);
    await mount("/settings/history");
    const limit = screen.getByRole("textbox", {
      name: tt("ui.screens-contents.settings-maximum"),
    });
    await userEvent.clear(limit);
    await userEvent.type(limit, "0");
    expect(limit).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(t("ui.reader-pages.settings-whole-number-min-max", { min: 1, max: 1000 })),
    ).toBeInTheDocument();
    expect(storedPlaces()).toHaveLength(3);
  });
});

describe("settings, restore the last place", () => {
  it("opens the last place on a start at /, and the overview once it is switched off", async () => {
    const first = await mount("/product");
    first.unmount();

    const restored = await mount("/");
    expect(where()).toBe("/product");
    expect(screen.queryByTestId("overview")).not.toBeInTheDocument();
    restored.unmount();

    // A deep link wins over the last place.
    const deep = await mount("/records");
    expect(where()).toBe("/records");
    deep.unmount();

    const settings = await mount("/settings/history");
    await userEvent.click(
      screen.getByRole("switch", { name: tt("ui.screens-contents.settings-restore-place") }),
    );
    expect(
      screen.getByRole("switch", { name: tt("ui.screens-contents.settings-restore-place") }),
    ).toHaveAttribute("aria-checked", "false");
    settings.unmount();

    await mount("/");
    expect(where()).toBe("/");
    expect(screen.getByTestId("overview")).toBeInTheDocument();
  });
});

describe("settings, keep chat sessions", () => {
  const field = () =>
    screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") });
  const sessions = () =>
    screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") });

  it("keeps a conversation across a reload while on, and none once switched off", async () => {
    const first = await mount("/ask");
    await userEvent.type(field(), "Will it stay?{Enter}");
    expect(sessions()).toHaveTextContent("Will it stay?");
    first.unmount();

    const kept = await mount("/ask");
    expect(sessions()).toHaveTextContent("Will it stay?");
    kept.unmount();

    const settings = await mount("/settings/history");
    await userEvent.click(
      screen.getByRole("switch", {
        name: tt("ui.screens-contents.settings-keep-chat-sessions"),
      }),
    );
    settings.unmount();

    // Switching off ended the stored conversation …
    const fresh = await mount("/ask");
    expect(sessions()).not.toHaveTextContent("Will it stay?");
    // … and a new one lives only as long as the page.
    await userEvent.type(field(), "Just once{Enter}");
    expect(sessions()).toHaveTextContent("Just once");
    fresh.unmount();

    await mount("/ask");
    expect(sessions()).not.toHaveTextContent("Just once");
  });
});

describe("preferences store", () => {
  it("reads each unknown or malformed field as its default", () => {
    const store = {
      getItem: () =>
        JSON.stringify({
          density: "huge",
          motion: "full",
          historyLimit: 5000,
          keepChat: "yes",
          restoreLast: false,
        }),
    };
    expect(readPreferences(store)).toEqual({
      density: "normal",
      motion: "system",
      restoreLast: false,
      keepChat: true,
      historyLimit: 200,
      followAnswer: false,
    });
    expect(readPreferences({ getItem: () => "[1]" }).historyLimit).toBe(200);
  });

  it("takes only whole numbers from 1 to 1000 as a maximum", () => {
    expect(["1", " 50 ", 1000].map(parseHistoryLimit)).toEqual([1, 50, 1000]);
    expect(["", "0", "1.5", "1001", "abc", null].map(parseHistoryLimit)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("cuts the oldest places first but never the one under the cursor", () => {
    const place = (path: string): Place => ({ path, label: path, kind: "area", at: 0 });
    const v = { places: ["/a", "/b", "/c", "/d"].map(place), cursor: 0 };
    const cut = trim(v, 2);
    expect(cut.places.map((p) => p.path)).toEqual(["/a", "/b"]);
    expect(cut.cursor).toBe(0);
    const end = trim({ ...v, cursor: 3 }, 2);
    expect(end.places.map((p) => p.path)).toEqual(["/c", "/d"]);
    expect(end.cursor).toBe(1);
  });
});
