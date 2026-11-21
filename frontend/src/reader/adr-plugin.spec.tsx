/** The bundled decisions plugin in the running reader: loaded from the real
 * catalogue under its own id with its entry (plugins/adr/src/entry.tsx),
 * its settings page in the Plugins group naming the directory the host
 * reports, and its decisions in the palette before the area was ever opened.
 * Every answer comes through the same `/api/plugin/call` door the host serves. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import Atlas from "./Atlas";
import { atlasT, uiT } from "./testing";

const t = atlasT("en");
const tt = uiT("en");
const realFetch = global.fetch;
const where = () => decodeURIComponent(window.location.pathname);

function reply(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

/** A host with the given decision files; `gate` holds the list back until released. */
function host(files: { path: string; number: string; slug: string }[], gate?: Promise<void>) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/plugin/session") return reply({ capabilities: { adr: "cap-adr" } });
    if (url === "/api/settings/directory")
      return reply({
        file: ".facetrc.yaml",
        line: 4,
        key: "adr.directory",
        directory: "architecture/decisions",
      });
    if (url !== "/api/plugin/call") return reply({});
    const { tool } = JSON.parse(String(init?.body)) as { tool: string };
    calls.push(tool);
    if (tool === "repo.list") {
      await gate;
      return reply({ result: { dir: "docs/adr", files } });
    }
    return reply({ result: { body: "# One\n\n**Status:** accepted\n\nText." } });
  }) as typeof fetch;
  return calls;
}

const ONE = [{ path: "0001-one.md", number: "0001", slug: "one" }];

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={taskflowModel()} readers={null} />);
  await act(async () => undefined);
  return view;
}

function palette() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.getByRole("dialog");
}
const typeIn = (dialog: HTMLElement, value: string) =>
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value } });
const headings = (dialog: HTMLElement) =>
  Array.from(within(dialog).getByRole("listbox").querySelectorAll('[role="presentation"]')).map(
    (h) => h.textContent ?? "",
  );
const decisionsKind = () => t("ui.adr-src.search-decisions");

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(async () => {
  global.fetch = realFetch;
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("the decisions plugin in the reader", () => {
  it("opens the decisions from its navigation entry, which then marks itself as the current place", async () => {
    host(ONE);
    await mount("/");
    const nav = () => screen.getByRole("navigation", { name: tt("shell.nav.label") });
    const entry = () =>
      within(nav()).getByRole("button", { name: new RegExp(tt("shell.nav.item.adr")) });
    // Precondition: on the Overview the entry is not the current place.
    expect(entry()).not.toHaveAttribute("aria-current");
    await userEvent.click(entry());
    expect(where()).toBe("/p/adr");
    expect(entry()).toHaveAttribute("aria-current", "page");
  });

  it("loads under its own id with its entry, its navigation entry and its settings page, which names the directory the host reports", async () => {
    host(ONE);
    await mount("/settings");
    // The entry is what the catalogue loaded: the decisions stand in the navigation.
    const nav = screen.getByRole("navigation", { name: tt("shell.nav.label") });
    expect(
      within(nav).getByRole("button", { name: new RegExp(tt("shell.nav.item.adr")) }),
    ).toBeInTheDocument();
    const group = screen.getByTestId("settings-plugin-sections");
    await userEvent.click(
      within(group).getByRole("button", { name: new RegExp(t("ui.adr-src.entry-decisions")) }),
    );
    expect(window.location.pathname).toBe("/settings/plugin-adr");
    const page = screen.getByTestId("settings-plugin-adr");
    await waitFor(() => expect(page).toHaveTextContent("architecture/decisions"));
  });

  it("words the settings page it registered at load in the language switched to, and back", async () => {
    host(ONE);
    await mount("/settings");
    const group = () => screen.getByTestId("settings-plugin-sections");
    const page = (name: string) =>
      within(group()).queryByRole("button", { name: new RegExp(name) });
    const english = t("ui.adr-src.entry-decisions");
    const german = atlasT("de")("ui.adr-src.entry-decisions");
    expect(german).not.toBe(english);
    expect(page(english)).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    await waitFor(() => expect(page(german)).toBeInTheDocument());
    expect(page(english)).toBeNull();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    await waitFor(() => expect(page(english)).toBeInTheDocument());
    expect(page(german)).toBeNull();
  });

  it("puts a decision into the palette before the decisions were ever opened, with its mark and number, and opens it in the area", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const calls = host(ONE, gate);
    await mount("/");
    // Before the plugin's first load answered, the search has no decisions kind.
    let dialog = palette();
    typeIn(dialog, "One");
    expect(headings(dialog).some((h) => h.startsWith(decisionsKind()))).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(calls).toContain("repo.read"));
    await act(async () => undefined);
    // The area was never opened: the address is still the Overview.
    expect(where()).toBe("/");
    dialog = palette();
    typeIn(dialog, "One");
    expect(headings(dialog).some((h) => h.startsWith(decisionsKind()))).toBe(true);
    const row = within(dialog)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("0001 One"));
    expect(row).toBeDefined();
    expect(within(row!).getByTestId("palette-kind-mark")).toHaveAttribute(
      "title",
      t("ui.adr-src.search-decision"),
    );
    await userEvent.click(row!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The area opens on the decision at its repository path.
    expect(where()).toBe("/p/adr/docs/adr/0001-one.md");
    expect(await screen.findByRole("heading", { level: 1, name: /One/ })).toBeInTheDocument();
  });

  it("offers no decisions kind in a project without decisions", async () => {
    const calls = host([]);
    await mount("/");
    await waitFor(() => expect(calls).toContain("repo.list"));
    await act(async () => undefined);
    const dialog = palette();
    typeIn(dialog, "e");
    expect(headings(dialog).length).toBeGreaterThan(0);
    expect(headings(dialog).some((h) => h.startsWith(decisionsKind()))).toBe(false);
  });
});
