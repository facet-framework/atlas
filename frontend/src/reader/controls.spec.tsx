import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";

const model = taskflowModel();

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => undefined) } });
});

// Every control a page draws must lead somewhere: a click may navigate or
// change the page, but it must never throw or leave the reader without a page.
const PLACES = [
  "/",
  "/product",
  "/domain/tasks",
  "/domain/tasks/create",
  "/records",
  "/record/tasks/create/quick-add",
  "/record/tasks/create/quick-ad",
  "/contents",
  "/contents/promises",
  "/contents/knowledge",
  "/contents/tests",
  "/contents/anchor",
  "/contents/files",
  "/contents/calibration",
  "/contents/provenance",
  "/contents/operations",
  "/settings",
  "/settings/history",
  "/settings/appearance",
  "/settings/plugins",
  "/p/notes",
  "/contents/drift",
  "/contents/rules",
  "/contents/taxonomy",
  "/glossary",
  "/ask",
  "/settings/git-provider",
  "/settings/language",
  "/nowhere",
];

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

describe.each(PLACES)("every control on %s", (path) => {
  it("leads to a page without throwing", () => {
    mount(path);
    const count = screen.queryAllByRole("button").length;
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 60); i++) {
      cleanup();
      window.localStorage.clear();
      mount(path);
      const button = screen.queryAllByRole("button")[i];
      if (!button || (button as HTMLButtonElement).disabled) continue;
      expect(() => fireEvent.click(button)).not.toThrow();
      expect(screen.getByRole("main")).toBeInTheDocument();
    }
  });
});

describe.each(["/records", "/contents/promises", "/contents/anchor", "/settings", "/glossary"])(
  "every field on %s",
  (path) => {
    it("takes a query without throwing", () => {
      mount(path);
      for (const field of [
        ...screen.queryAllByRole("searchbox"),
        ...screen.queryAllByRole("textbox"),
      ]) {
        expect(() => fireEvent.change(field, { target: { value: "sync" } })).not.toThrow();
      }
      expect(screen.getByRole("main")).toBeInTheDocument();
    });
  },
);

describe("a records query", () => {
  it("narrows the collection to what it matches", () => {
    mount("/records");
    expect(screen.getAllByText("quick-add").length).toBeGreaterThan(0);
    const field = screen.getByPlaceholderText("Id, name, file or team …");
    fireEvent.change(field, { target: { value: "last-write" } });
    // A hit is highlighted, so the name is split across elements.
    expect(
      screen.getAllByText(
        (_, el) => el?.tagName !== "BODY" && el?.textContent === "last-write-wins",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("quick-add")).not.toBeInTheDocument();
  });
});
