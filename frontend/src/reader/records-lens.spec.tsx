import { germanLabel } from "@/i18n/testing-labels.spec-support";
/** The Records lens inside the real container: the model's registry decides the
 * record in focus and its neighbours, and the container keeps the reader's view. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import Atlas from "./Atlas";

const model = taskflowModel();

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

const realMatchMedia = window.matchMedia;

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

const dots = () => screen.getAllByTestId("lens-dot");
const focusName = () => screen.getByTestId("lens-focus-name").textContent;

const nav = () => within(screen.getByRole("navigation", { name: "Areas" }));

describe("the records lens", () => {
  it("opens on the lens, with the record that has the most neighbours in focus", async () => {
    mount("/records");
    expect(screen.getByRole("radio", { name: /Lens/ })).toBeChecked();
    expect(screen.getByTestId("lens-focus-name")).toHaveTextContent("quick-add");
    const dots = screen.getAllByTestId("lens-dot");
    expect(dots).toHaveLength(model.features.length + model.assumptions.length);
    // quick-add's neighbours come from the registry: what it needs and what needs it.
    const rec = model.byId["tasks/create/quick-add"];
    const near = dots
      .filter((d) => d.getAttribute("data-state") === "neighbour")
      .map((d) => d.getAttribute("data-lens-id"))
      .sort();
    expect(near).toEqual([...rec.dependsOn, ...rec.dependedOnBy].sort());
    expect(near.length).toBeGreaterThan(0);
  });

  it("puts a clicked dot into focus and opens its record from there", async () => {
    mount("/records");
    const dots = screen.getAllByTestId("lens-dot");
    await userEvent.click(dots.find((d) => d.dataset.lensId === "lists/core/list-store")!);
    expect(screen.getByTestId("lens-focus-name")).toHaveTextContent("list-store");
    await userEvent.click(screen.getByRole("button", { name: "View record" }));
    expect(window.location.pathname).toBe("/record/lists/core/list-store");
  });

  it("keeps the reader's choice of the list after a visit elsewhere", async () => {
    mount("/records");
    await userEvent.click(screen.getByRole("radio", { name: /List/ }));
    await userEvent.click(nav().getByRole("button", { name: "Overview" }));
    await userEvent.click(nav().getByRole("button", { name: "Records" }));
    expect(screen.getByRole("radio", { name: /List/ })).toBeChecked();
    expect(screen.queryByTestId("records-lens")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Records" })).toBeInTheDocument();
  });

  it("puts the best hit of a search into focus and the rest into the depth", async () => {
    mount("/records");
    await userEvent.type(screen.getByRole("searchbox"), "search");
    expect(screen.getByTestId("lens-focus-name")).toHaveTextContent("task-search");
    expect(screen.getByTestId("lens-status")).toHaveTextContent(/^\d+ sharp · \d+ in depth$/);
    const deep = screen
      .getAllByTestId("lens-dot")
      .filter((d) => d.getAttribute("data-state") === "deep");
    expect(deep.map((d) => d.dataset.lensId)).toContain("tasks/archive/bulk-archive");
  });

  it("walks the field with the keyboard, one tab stop, and the focus follows", () => {
    mount("/records");
    const all = dots();
    const start = all.findIndex((d) => d.getAttribute("aria-pressed") === "true");
    // The field is a single tab stop: only the dot in focus takes the tab.
    expect(all.filter((d) => d.tabIndex === 0)).toEqual([all[start]]);
    all[start].focus();
    fireEvent.keyDown(all[start], { key: "Home" });
    expect(document.activeElement).toBe(dots()[0]);
    expect(focusName()).toBe(dots()[0].dataset.lensId!.split("/").pop());
    fireEvent.keyDown(dots()[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(dots()[1]);
    expect(dots()[1].tabIndex).toBe(0);
    expect(focusName()).toBe(dots()[1].dataset.lensId!.split("/").pop());
    fireEvent.keyDown(dots()[1], { key: "End" });
    const last = dots().at(-1)!;
    expect(document.activeElement).toBe(last);
    expect(focusName()).toBe(last.dataset.lensId!.split("/").pop());
  });

  it("switches the sheet's sections with the arrow keys and returns to the dot on Escape", () => {
    mount("/records");
    const promises = screen.getByRole("tab", { name: /Promises/ });
    promises.focus();
    fireEvent.keyDown(promises, { key: "ArrowRight" });
    const knowledge = screen.getByRole("tab", { name: /Knowledge/ });
    expect(knowledge).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(knowledge);
    const open = screen.getByRole("button", { name: "View record" });
    open.focus();
    fireEvent.keyDown(open, { key: "Escape" });
    expect(document.activeElement).toBe(
      dots().find((d) => d.getAttribute("aria-pressed") === "true"),
    );
  });

  it("puts the record in focus before the field on a phone, labelled in German", async () => {
    phone();
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      mount("/records");
      const lens = screen.getByTestId("records-lens");
      const sheet = screen.getByTestId("lens-sheet");
      const field = screen.getByRole("region", { name: germanLabel("All records") });
      expect(lens.contains(sheet)).toBe(true);
      expect(sheet.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole("radio", { name: new RegExp(germanLabel("Lens")) })).toBeChecked();
      expect(
        screen.getByRole("tab", { name: new RegExp(germanLabel("Promises")) }),
      ).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
