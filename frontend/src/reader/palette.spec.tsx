/** The palette as the reader opens it in the Atlas shell (Ctrl K): what it
 * finds across kinds, how a kind is chosen, and how the keys walk it. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { listedRecords } from "./derive-reader";
import { nextKind, PAGE } from "./palette";

const base = taskflowModel();
const where = () => window.location.pathname;

function mount(model: AtlasModel = base, path = "/") {
  window.history.replaceState(null, "", path);
  render(<Atlas model={model} readers={null} />);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.getByRole("dialog");
}

const field = () => within(screen.getByRole("dialog")).getByRole("combobox");
const options = () => within(screen.getByRole("dialog")).getAllByRole("option");
/** The group headings of the open palette, in order. */
const headings = (dialog: HTMLElement) =>
  Array.from(within(dialog).getByRole("listbox").querySelectorAll('[role="presentation"]')).map(
    (h) => h.textContent ?? "",
  );
/** The listed row whose text contains `text`; fails when there is none. */
const rowWith = (text: string) => {
  const row = options().find((o) => o.textContent?.includes(text));
  if (!row) throw new Error(`no row with ${text}`);
  return row;
};
const typeIn = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the palette in the Atlas shell", () => {
  it("shows the records with their standing of proof before anything is typed", () => {
    const dialog = mount();
    expect(field()).toHaveValue("");
    expect(headings(dialog)[0]).toMatch(/^Records/);
    const first = listedRecords(base).find((r) => r.scenarios.length)!;
    const row = options().find((o) => o.textContent?.includes(first.id))!;
    // The count is of promises with a declared test, and claims no run.
    expect(row).toHaveTextContent(`${first.proven}/${first.scenarios.length} with a test`);
    expect(dialog).not.toHaveTextContent(/passed|green/i);
  });

  it("finds a string in a record id and in an anchor's path, each under its own kind", () => {
    // The fixture's sync queue: "queue" stands in a record id and in an anchor's file path.
    const pair = base.anchorPairs.find((a) => a.path.endsWith("/queue.rs"));
    expect(pair?.id).toContain("queue");
    const dialog = mount();
    typeIn("queue");
    const heads = headings(dialog);
    expect(heads.some((h) => h.startsWith("Records"))).toBe(true);
    expect(heads.some((h) => h.startsWith("Anchors"))).toBe(true);
    expect(rowWith(`${pair!.path}:${pair!.line}`)).toHaveTextContent(pair!.id);
    expect(rowWith(pair!.id.split("/").pop()!)).toBeDefined();
  });

  it("starts each hit with its kind's mark, whose tooltip and the row's description name the kind", () => {
    const pair = base.anchorPairs.find((a) => a.path.endsWith("/queue.rs"))!;
    mount();
    typeIn("queue");
    const anchor = rowWith(`${pair.path}:${pair.line}`);
    const record = options().find((o) => o.textContent?.includes(pair.id.split("/").pop()!))!;
    expect(within(anchor).getByTestId("palette-kind-mark")).toHaveAttribute("title", "Anchors");
    expect(within(record).getByTestId("palette-kind-mark")).toHaveAttribute("title", "Records");
    expect(anchor).toHaveAccessibleDescription("Anchors");
    // The mark's title is a tooltip the shell shows on hover.
    jest.useFakeTimers();
    fireEvent.mouseOver(within(anchor).getByTestId("palette-kind-mark"));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Anchors");
    jest.useRealTimers();
  });

  it("offers only the kinds whose source is there: no glossary group and no glossary step without a glossary", () => {
    expect(base.glossary).toBeNull();
    const dialog = mount();
    // "e" stands in nearly everything, so every kind that has a source shows.
    typeIn("e");
    expect(headings(dialog).some((h) => h.startsWith("Glossary"))).toBe(false);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(window, { key: "Tab" });
      seen.push(headings(screen.getByRole("dialog"))[0] ?? "");
    }
    // Precondition: Tab did walk the kinds.
    expect(seen.filter((h) => h.startsWith("Only ")).length).toBeGreaterThan(2);
    expect(seen.some((h) => /Glossary/.test(h))).toBe(false);
    expect(field()).toHaveAttribute("placeholder", "Record, area, page, command …");
  });

  it("closes and goes where a row points: a record to its page, an anchor to its record, a file to the file list", async () => {
    const pair = base.anchorPairs.find((a) => a.path.endsWith("/queue.rs"))!;
    mount(base, "/contents");
    typeIn(pair.id);
    const record = options().find(
      (o) =>
        o.textContent?.includes(pair.id.split("/").pop()!) &&
        within(o).getByTestId("palette-kind-mark").getAttribute("title") === "Records",
    );
    expect(record).toBeDefined();
    await userEvent.click(record!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(decodeURIComponent(where())).toBe(`/record/${pair.id}`);

    window.history.replaceState(null, "", "/contents");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    typeIn(pair.path);
    await userEvent.click(rowWith(`${pair.path}:${pair.line}`));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(decodeURIComponent(where())).toBe(`/record/${pair.id}`);

    const file = base.scan.unanchoredFiles![0];
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    typeIn(file.path);
    await userEvent.click(rowWith(file.path));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe("/contents/files");
  });

  it("forces neither hand onto the other: the field takes typing, Esc and the close button both leave", async () => {
    const user = userEvent.setup();
    mount();
    expect(field()).toHaveFocus();
    await user.keyboard("queue");
    expect(field()).toHaveValue("queue");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe("/");
  });

  it("holds the focus and makes the bars, the page and the chat inert while it is open, and gives them back on close", () => {
    mount();
    expect(field()).toHaveFocus();
    const parts = () => [
      screen.getByTestId("shell-head"),
      screen.getByRole("main", { hidden: true }),
      screen.getByRole("complementary", { hidden: true }),
    ];
    for (const part of parts()) expect(part.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    for (const part of parts()) expect(part.closest("[inert]")).toBeNull();
  });

  it("searches a record's summary too and shows it as the row's second line", () => {
    const rec = listedRecords(base).find((r) => r.summary.trim().split(/\s+/).length > 3)!;
    const word = rec.summary
      .split(/[^\p{L}]+/u)
      .find(
        (w) =>
          w.length > 5 &&
          !listedRecords(base).some((r) => r.id.toLowerCase().includes(w.toLowerCase())),
      )!;
    expect(word).toBeDefined();
    mount();
    typeIn(word);
    const row = options().find((o) => o.textContent?.includes(rec.id.split("/").pop()!))!;
    expect(row).toBeDefined();
    expect(row).toHaveTextContent(word);
  });

  it("finds what no record describes: a file without a record and an anchor whose record is absent", async () => {
    // The fixture scan reports an anchor whose record does not exist, and files no anchor names.
    const orphan = base.scan.orphanAnchors?.[0];
    expect(orphan && base.byId[orphan.id]).toBeUndefined();
    expect(orphan).toBeDefined();
    const file = base.scan.unanchoredFiles?.[0];
    expect(file).toBeDefined();

    const dialog = mount();
    typeIn(orphan!.path);
    expect(headings(dialog).some((h) => h.startsWith("Without a record"))).toBe(true);
    expect(rowWith(`${orphan!.path}:${orphan!.line}`)).toHaveTextContent(
      `Anchor without a record: ${orphan!.id}`,
    );
    await userEvent.click(rowWith(`${orphan!.path}:${orphan!.line}`));
    expect(where()).toBe("/contents/anchor");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    typeIn(file!.path);
    expect(rowWith(file!.path)).toHaveTextContent("File without a record");
    await userEvent.click(rowWith(file!.path));
    expect(where()).toBe("/contents/files");
  });

  it("says nothing was found, and counts a full result", () => {
    const dialog = mount();
    typeIn("zzqx-nothing");
    expect(dialog).toHaveTextContent("No matches for “zzqx-nothing”");
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    typeIn("");
    const total = listedRecords(base).length;
    // More records than listed: the group names all of them and the field the sum.
    expect(total).toBeGreaterThan(6);
    expect(headings(dialog)[0]).toContain(String(total));
    expect(dialog).toHaveTextContent(/\d+ matches/);
  });

  it("narrows to a kind with Tab, walks the kinds back with Shift-Tab, and keeps the query", () => {
    const dialog = mount();
    typeIn("task");
    const kinds = headings(dialog).length;
    expect(kinds).toBeGreaterThan(1);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(headings(dialog)).toEqual([expect.stringMatching(/^Only Records/)]);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(headings(dialog)).toHaveLength(1);
    expect(headings(dialog)[0]).not.toMatch(/records/);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(headings(dialog)[0]).toMatch(/^Only Records/);
    expect(field()).toHaveValue("task");
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(headings(dialog)).toHaveLength(kinds);
  });

  it("names the chosen kind when nothing in it matches", () => {
    const dialog = mount();
    fireEvent.keyDown(window, { key: "Tab" });
    typeIn("zzqx-nothing");
    expect(headings(dialog)[0]).toMatch(/^Nothing found in Records/);
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
  });

  it("narrows through a group's show-all, for the mouse", async () => {
    const dialog = mount();
    // The first group's show-all is the records'.
    await userEvent.click(within(dialog).getAllByRole("button", { name: /show all \d+/ })[0]);
    expect(headings(dialog)).toEqual([expect.stringMatching(/^Only Records/)]);
    expect(options()).toHaveLength(Math.min(PAGE, listedRecords(base).length));
  });

  it("loads the next rows of a chosen kind when its list is scrolled to the end", () => {
    const many: AtlasModel = {
      ...base,
      features: Array.from({ length: PAGE * 2 + 5 }, (_, i) => ({
        ...base.features[0],
        id: `bulk/load/r${i}`,
      })),
      assumptions: [],
    };
    const dialog = mount(many);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(options()).toHaveLength(PAGE);
    const list = within(dialog).getByRole("listbox");
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 400 });
    list.scrollTop = 600;
    act(() => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(options()).toHaveLength(PAGE * 2);
  });

  it("finds glossary terms, content kinds and settings pages and opens each where it lives", async () => {
    // The fixture declares no glossary; this one term is the whole of it.
    expect(base.glossary).toBeNull();
    const term = {
      term: "Schnellerfassung",
      definition: "A task on one line.",
      renderings: {},
    };
    mount({ ...base, glossary: { schemaVersion: "1.0", terms: [term] } });
    typeIn("schnellerf");
    // With a glossary, its kind is offered.
    expect(headings(screen.getByRole("dialog")).some((h) => h.startsWith("Glossary"))).toBe(true);
    await userEvent.click(rowWith(term.term));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe(`/glossary/${term.term}`);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    typeIn("Drift");
    await userEvent.click(
      within(screen.getByRole("dialog"))
        .getAllByRole("option")
        .find((o) => o.textContent === "Drift")!,
    );
    expect(where()).toBe("/contents/drift");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    typeIn("language");
    await userEvent.click(screen.getByRole("option", { name: /^Language/ }));
    expect(where()).toBe("/settings/language");
  });

  it("names no notes when the project has none", () => {
    const dialog = mount();
    typeIn("e");
    expect(headings(dialog).some((h) => /^Notes/.test(h))).toBe(false);
  });

  it("walks the hits in a ring with the arrow keys and opens the selected one", () => {
    mount();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(options().at(-1)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    // A new query starts at the top again.
    typeIn("a");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    typeIn("");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const second = options()[1].textContent!;
    const id = listedRecords(base).find((r) => second.includes(r.id))!.id;
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Enter opened the selected row, the second, not the first.
    expect(where()).toBe(`/record/${id}`);
    expect(id).not.toBe(listedRecords(base)[0].id);
  });
});

describe("nextKind", () => {
  it("walks all kinds, then each, in a ring both ways", () => {
    expect(nextKind(["a", "b"], null, false)).toBe("a");
    expect(nextKind(["a", "b"], "b", false)).toBeNull();
    expect(nextKind(["a", "b"], null, true)).toBe("b");
    expect(nextKind(["a", "b"], "gone", false)).toBe("a");
  });
});
