/** The breadcrumbs of every place: each segment leads to its place, the
 * sibling list is searched and closed like a menu, it belongs to the place in
 * the history, and the record's head rows can be pinned to the top. */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { KIND_KEYS } from "./pages/contents";
import { STUCK_KEY } from "./stuck";

const model = taskflowModel();

// What `scrollIntoView` was asked to bring into view; jsdom has no layout.
let scrolled: Element[] = [];

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

const where = () => decodeURIComponent(window.location.pathname);
const path = () => screen.getAllByRole("navigation", { name: "Path" })[0];

describe("every breadcrumb segment leads to its place", () => {
  it("on every contents kind page, Contents opens the hub and the group shows its section", async () => {
    for (const kind of KIND_KEYS) {
      cleanup();
      scrolled = [];
      mount(`/contents/${kind}`);
      const crumbs = within(path()).getAllByRole("button");
      // Two places above the kind: Contents and the group. The kind itself is the page.
      expect(crumbs).toHaveLength(2);
      const name = crumbs[1].textContent;
      await userEvent.click(crumbs[1]);
      expect(where()).toBe("/contents");
      // The section brought into view is the one the crumb named.
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]).toHaveAttribute("aria-label", name);
      expect(scrolled[0].getAttribute("data-testid")).toMatch(/^hub-group-/);

      cleanup();
      mount(`/contents/${kind}`);
      await userEvent.click(within(path()).getAllByRole("button")[0]);
      expect(where()).toBe("/contents");
      expect(screen.getByTestId("contents-hub")).toBeInTheDocument();
    }
    // Two full mounts per contents kind: a loaded runner needs more than the default 5 s.
  }, 30_000);

  it("walks a record's path to the product, the domain and the capability", async () => {
    for (const [label, target] of [
      ["Product", "/product"],
      ["tasks", "/domain/tasks"],
      ["create", "/domain/tasks/create"],
    ]) {
      cleanup();
      mount("/record/tasks/create/quick-add");
      await userEvent.click(within(path()).getByRole("button", { name: label }));
      expect(where()).toBe(target);
    }
  });

  it("leads an assumption's kind segment to the collection filtered to assumptions", async () => {
    const a = model.assumptions[0];
    mount(`/record/${a.id}`);
    await userEvent.click(within(path()).getByRole("button", { name: "Assumptions" }));
    expect(where()).toBe("/records");
    // The filter chip of the collection names the assumptions.
    expect(screen.getAllByText(/Assumptions/).length).toBeGreaterThan(0);
    expect(screen.queryByText("quick-add")).not.toBeInTheDocument();
  });

  it("writes the record itself as where you are, neither a link nor a button", () => {
    mount("/record/tasks/create/quick-add");
    const crumbs = within(path());
    expect(crumbs.getByText("quick-add")).toHaveAttribute("aria-current", "page");
    expect(crumbs.queryByRole("button", { name: "quick-add" })).toBeNull();
    expect(crumbs.queryByRole("link", { name: "quick-add" })).toBeNull();
    // The segments above it are places.
    expect(crumbs.getByRole("button", { name: "create" })).toBeInTheDocument();
  });

  it("draws no half path for a record this run does not have", () => {
    // Precondition: a record this run has does carry a path.
    mount("/record/tasks/create/quick-add");
    expect(screen.getAllByRole("navigation", { name: "Path" }).length).toBeGreaterThan(0);
    cleanup();
    mount("/record/tasks/create/nope");
    expect(screen.getByTestId("record-not-found")).toHaveTextContent("tasks/create/nope");
    expect(screen.queryAllByRole("navigation", { name: "Path" })).toHaveLength(0);
  });
});

describe("the sibling list of a path segment", () => {
  const caret = () => within(path()).getAllByRole("button", { name: "Show siblings" });

  it("is searched: typing filters, Enter opens the first hit", async () => {
    mount("/record/tasks/create/quick-add");
    await userEvent.click(caret()[1]);
    const field = screen.getByRole("searchbox", { name: "Find a sibling" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "recur");
    const menu = screen.getByRole("menu", { name: "Siblings" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    expect(within(menu).getByRole("menuitem")).toHaveTextContent(/^recurring/);
    await userEvent.keyboard("{Enter}");
    expect(where()).toBe("/domain/tasks/recurring");
  });

  it("says so when nothing matches", async () => {
    mount("/record/tasks/create/quick-add");
    await userEvent.click(caret()[1]);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(within(screen.getByRole("menu")).getByRole("status")).toHaveTextContent("No match");
  });

  it("closes on a press outside it, and on Esc with the focus back on the caret", async () => {
    mount("/record/tasks/create/quick-add");
    await userEvent.click(caret()[1]);
    expect(screen.getByRole("menu", { name: "Siblings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    expect(screen.queryByRole("menu", { name: "Siblings" })).not.toBeInTheDocument();
    await userEvent.click(caret()[1]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Siblings" })).not.toBeInTheDocument();
    expect(caret()[1]).toHaveFocus();
  });

  it("is closed on a fresh visit and comes back as it was on ‹", async () => {
    mount("/record/tasks/create/quick-add");
    await userEvent.click(caret()[1]);
    await userEvent.type(screen.getByRole("searchbox"), "rec");
    await userEvent.keyboard("{Enter}");
    expect(where()).toBe("/domain/tasks/recurring");
    expect(screen.queryByRole("menu", { name: "Siblings" })).not.toBeInTheDocument();

    // ‹ brings the record back with its list open and its search as typed.
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(where()).toBe("/record/tasks/create/quick-add");
    expect(screen.getByRole("menu", { name: "Siblings" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("rec");

    // A fresh visit to the same record, through its capability, finds it closed.
    await userEvent.click(within(path()).getByRole("button", { name: "create" }));
    expect(where()).toBe("/domain/tasks/create");
    await userEvent.click(screen.getAllByText("quick-add")[0]);
    expect(where()).toBe("/record/tasks/create/quick-add");
    expect(screen.queryByRole("menu", { name: "Siblings" })).not.toBeInTheDocument();
  });

  it("comes back as it was on the browser's own back", async () => {
    mount("/domain/tasks");
    await userEvent.click(within(path()).getByRole("button", { name: "Show siblings" }));
    await userEvent.type(screen.getByRole("searchbox"), "sync");
    await userEvent.keyboard("{Enter}");
    expect(where()).toBe("/domain/sync");
    // The browser's back: the address changes first, then `popstate` fires.
    act(() => {
      window.history.replaceState(null, "", "/domain/tasks");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("menu", { name: "Siblings" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("sync");
  });
});

describe("pinning the record's head rows", () => {
  it("offers a pin on each of path, status, name and id, reachable by keyboard", () => {
    mount("/record/tasks/create/quick-add");
    for (const what of ["path", "status", "name", "id"]) {
      const pin = screen.getByRole("button", { name: `Pin ${what} to the top` });
      expect(pin).toHaveAttribute("aria-pressed", "false");
      expect(pin.tabIndex).toBe(0);
    }
  });

  it("keeps a pinned row in the strip at the top, for this reader, until it is unpinned", async () => {
    const { unmount } = mount("/record/tasks/create/quick-add");
    expect(screen.queryByRole("region", { name: "Pinned to the top" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pin name to the top" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin id to the top" }));
    // Without layout every pinned row counts as scrolled away, so the strip holds both.
    const strip = screen.getByRole("region", { name: "Pinned to the top" });
    expect(within(strip).getByText("quick-add")).toBeInTheDocument();
    expect(within(strip).getByText("tasks/create/quick-add")).toBeInTheDocument();
    expect(within(strip).queryByRole("navigation", { name: "Path" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STUCK_KEY) ?? "[]")).toEqual(["name", "id"]);

    // The next record, and the next visit, keep the reader's pins.
    unmount();
    mount("/record/tasks/recurring/repeat-rule");
    const again = screen.getByRole("region", { name: "Pinned to the top" });
    expect(within(again).getByText("tasks/recurring/repeat-rule")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Unpin name" })[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Unpinning from the strip lets the row go.
    for (const b of within(again).getAllByRole("button", { name: /^Unpin / })) fireEvent.click(b);
    expect(screen.queryByRole("region", { name: "Pinned to the top" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STUCK_KEY) ?? "[]")).toEqual([]);
  });

  it("drops a stored value that is not a list of known rows", () => {
    window.localStorage.setItem(STUCK_KEY, JSON.stringify(["name", "elsewhere", 3]));
    mount("/record/tasks/create/quick-add");
    expect(screen.getAllByRole("button", { name: "Unpin name" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Pin path to the top" })).toBeInTheDocument();
    window.localStorage.setItem(STUCK_KEY, "{");
    mount("/record/tasks/create/quick-add");
    expect(screen.getAllByRole("button", { name: "Pin name to the top" }).length).toBeGreaterThan(
      0,
    );
  });
});
