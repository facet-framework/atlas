/** The reset under Settings → history and storage in the running Atlas
 * shell: what it names, what it removes, and what it reports. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { readSessions } from "./chat";
import { resetHeld } from "./pages/settings";
import { STORAGE_KEY } from "@/state";

const model = taskflowModel();
const conversation = (id: number, name: string) => ({
  id,
  name,
  turns: [],
  busy: false,
  agent: null,
  continuation: "fresh",
});
const OTHER = "other-app.preference";

function mount() {
  window.history.replaceState(null, "", "/settings/history");
  return render(<Atlas model={model} readers={null} />);
}

const resetAll = () => screen.getByRole("button", { name: /^Clear all \d+/ });

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      conversations: [
        conversation(1, "Question about storage"),
        conversation(2, "Question about sync"),
      ],
    }),
  );
  window.localStorage.setItem(OTHER, "kept");
});

afterEach(() => jest.restoreAllMocks());

describe("the storage reset in the Atlas settings", () => {
  it("names the conversations among what the reset clears, and counts them", () => {
    mount();
    const items = screen.getAllByTestId("storage-item");
    const chat = items.find((i) => i.textContent?.includes(STORAGE_KEY))!;
    expect(chat).toHaveTextContent("Chat sessions");
    expect(within(chat).getByTestId("storage-item-contents")).toHaveTextContent("2 chat sessions");
    // The reset button counts every listed key, the conversations' among them.
    expect(resetAll()).toHaveTextContent(`Clear all ${items.length}`);
    expect(items.some((i) => i.textContent?.includes(OTHER))).toBe(false);
  });

  it("removes the Atlas state, keeps another application's value, and a new reader restores no conversation", async () => {
    // The premise: the stored conversations are what a reader would restore.
    expect(readSessions().map((g) => g.name)).toEqual([
      "Question about storage",
      "Question about sync",
    ]);
    const first = mount();
    await userEvent.click(resetAll());
    expect(screen.getByTestId("storage-reset")).toHaveTextContent("Reset completed");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(OTHER)).toBe("kept");
    first.unmount();
    mount();
    expect(readSessions().map((g) => g.name)).not.toContain("Question about storage");
    expect(readSessions().map((g) => g.name)).not.toContain("Question about sync");
  });

  it("reports that the reset did not complete when the browser refuses, and leaves the value as it was", async () => {
    const before = window.localStorage.getItem(STORAGE_KEY);
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    mount();
    await userEvent.click(resetAll());
    const report = screen.getByTestId("storage-reset");
    expect(report).toHaveAttribute("role", "alert");
    expect(report).toHaveTextContent("Not reset");
    expect(screen.queryByText("Reset completed")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("reads the outcome back from the storage", () => {
    const store = new Map<string, string>([["a", "1"]]);
    const read = { getItem: (k: string) => store.get(k) ?? null };
    expect(resetHeld(["a"], read)).toBe(false);
    store.delete("a");
    expect(resetHeld(["a"], read)).toBe(true);
    expect(resetHeld(["a"], null)).toBe(false);
    store.set("facet.atlas.history", JSON.stringify({ places: [{}], cursor: 0 }));
    expect(resetHeld(["facet.atlas.history"], read)).toBe(true);
    store.set("facet.atlas.history", JSON.stringify({ places: [{}, {}], cursor: 1 }));
    expect(resetHeld(["facet.atlas.history"], read)).toBe(false);
  });
});
