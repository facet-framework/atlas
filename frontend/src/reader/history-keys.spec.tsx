/** The history behind `‹ ›` in the running Atlas shell: the arrows in the
 * top bar, the ⌥← / ⌥→ keys, and which changes are steps. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { HISTORY_KEY } from "./history";

const model = taskflowModel();
const where = () => window.location.pathname;
const RECORD = "/record/tasks/create/quick-add";

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

/** The top bar, found by its wordmark. */
const top = () => within(screen.getByTestId("top-brand").closest("header")!);
const backArrow = () => top().getByRole("button", { name: /^Back/ });
const forwardArrow = () => top().getByRole("button", { name: /^Forward/ });

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the history in the Atlas shell", () => {
  it("stands beside the wordmark, before the doors, and starts with nowhere to go", () => {
    mount("/");
    const back = backArrow();
    const forward = forwardArrow();
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();
    const brand = screen.getByTestId("top-brand");
    const settings = screen.getByRole("button", { name: "Settings" });
    // Reading order: the arrows, then the wordmark, then the doors.
    expect(forward.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(brand.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("retraces the places with the arrows and disables each at its end", async () => {
    const user = userEvent.setup();
    mount("/records");
    await user.click(screen.getByRole("button", { name: "Contents" }));
    expect(where()).toBe("/contents");
    await user.click(screen.getByRole("button", { name: "Glossary" }));
    expect(where()).toBe("/glossary");
    await user.click(backArrow());
    expect(where()).toBe("/contents");
    await user.click(backArrow());
    expect(where()).toBe("/records");
    expect(backArrow()).toBeDisabled();
    await user.click(forwardArrow());
    await user.click(forwardArrow());
    expect(where()).toBe("/glossary");
    expect(forwardArrow()).toBeDisabled();
  });

  it("answers ⌥← and ⌥→ outside a text field", async () => {
    const user = userEvent.setup();
    mount("/records");
    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(screen.getByRole("button", { name: "Glossary" }));
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(where()).toBe("/records");
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(where()).toBe("/contents");
  });

  it("leaves ⌥← to a text field, and a plain arrow to the page", async () => {
    const user = userEvent.setup();
    mount("/records");
    await user.click(screen.getByRole("button", { name: "Contents" }));
    const field = document.createElement("input");
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: "ArrowLeft", altKey: true });
    expect(where()).toBe("/contents");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(where()).toBe("/contents");
    field.remove();
  });

  it("brings a page that was left back, the contents page included", async () => {
    const user = userEvent.setup();
    mount("/contents");
    await user.click(screen.getByRole("button", { name: "Overview" }));
    expect(where()).toBe("/");
    await user.click(backArrow());
    expect(where()).toBe("/contents");
  });

  it("leaves no step for a typed filter, so back leaves the page", async () => {
    const user = userEvent.setup();
    mount("/");
    await user.click(screen.getByRole("button", { name: "Records" }));
    const before = JSON.parse(window.localStorage.getItem(HISTORY_KEY)!).places.length;
    // A filter of the records page changes what is listed, not where the reader is.
    const search = screen.getAllByRole("searchbox")[0];
    await user.type(search, "quick");
    expect(search).toHaveValue("quick");
    expect(where()).toBe("/records");
    expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY)!).places).toHaveLength(before);
    await user.click(backArrow());
    expect(where()).toBe("/");
  });

  it("drops the forward branch on a new step", async () => {
    const user = userEvent.setup();
    mount(RECORD);
    await user.click(screen.getByRole("button", { name: "Contents" }));
    await user.click(backArrow());
    expect(where()).toBe(RECORD);
    expect(forwardArrow()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Glossary" }));
    expect(forwardArrow()).toBeDisabled();
    const paths = JSON.parse(window.localStorage.getItem(HISTORY_KEY)!).places.map(
      (p: { path: string }) => p.path,
    );
    expect(paths).toEqual([RECORD, "/glossary"]);
  });
});
