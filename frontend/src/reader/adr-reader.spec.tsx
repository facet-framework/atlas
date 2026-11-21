/** The decision reader, fed a long example ADR through the same
 * `/api/plugin/call` answers the host gives. Its own file: the decisions
 * place caches its model per module, and this suite needs one that loaded. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { adrFront } from "../../../plugins/adr/src/entry";

const PATH = "docs/adr/0002-sync-conflicts.md";
/** A decision long enough to fold, with the header lines a decision file carries. */
const BODY = [
  "# ADR 0002 — The newest edit wins a sync conflict",
  "",
  "**Status:** accepted",
  "**Date:** 2026-02-03",
  "**Concerns:** sync service, mobile app, web board",
  "**Supersedes:** server-first saving",
  "**Added:** ADR-0001",
  "**Measured against:** `4f2a9c1` (2026-02-03)",
  "**Sources:** `cmd/taskflow/main.go`, `services/sync/conflict.go`",
  "",
  "---",
  "",
  "## 1. Decision",
  "",
  "The newest edit wins a sync conflict. The sync service compares the timestamps of both versions, keeps the newer one as the task and stores the older one in the task's history, where either member can restore it. A member edits a task on the train while a colleague edits the same task at the office. Both devices keep the change locally and send it when they can. The sync service then holds two versions of one task and has to decide which one every device shows next, without asking either member and without losing the version it does not show.",
  "",
  "## 2. The question",
  "",
  "A member edits a task on the train while a colleague edits the same task at the office. Both devices keep the change locally and send it when they can. The sync service then holds two versions of one task and has to decide which one every device shows next, without asking either member and without losing the version it does not show. Earlier versions asked the server first and refused an edit made offline, which lost work whenever the connection dropped.",
  "",
  "## 3. What the rule protects",
  "",
  "The rule protects the member who typed last: what they see after the sync is what they wrote. It also protects the other member, whose version is never deleted, only moved into the history. A member edits a task on the train while a colleague edits the same task at the office. Both devices keep the change locally and send it when they can. The sync service then holds two versions of one task and has to decide which one every device shows next, without asking either member and without losing the version it does not show.",
  "",
  "## 4. Consequences",
  "",
  "Every change carries a timestamp and the device that made it. Devices with a wrong clock are corrected by the server time on their next sync. A member edits a task on the train while a colleague edits the same task at the office. Both devices keep the change locally and send it when they can. The sync service then holds two versions of one task and has to decide which one every device shows next, without asking either member and without losing the version it does not show.",
  "",
  "## 5. Alternatives",
  "",
  "A lock per task was rejected: it blocks the second editor and fails when either device is offline. Merging single fields was postponed until members ask for it. A member edits a task on the train while a colleague edits the same task at the office. Both devices keep the change locally and send it when they can. The sync service then holds two versions of one task and has to decide which one every device shows next, without asking either member and without losing the version it does not show.",
  "",
  "## 6. Open points",
  "",
  "Repeating tasks keep their rule when one instance wins a conflict; whether the rule itself can conflict is not decided yet. A member edits a task on the train while a colleague edits the same task at the office. Both devices keep the change locally and send it when they can. The sync service then holds two versions of one task and has to decide which one every device shows next, without asking either member and without losing the version it does not show.",
  "",
].join("\n");

const realFetch = global.fetch;

function reply(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/plugin/session") return reply({ capabilities: { adr: "cap-adr" } });
    if (url !== "/api/plugin/call") return reply({});
    const { tool } = JSON.parse(String(init?.body)) as { tool: string };
    if (tool === "repo.list")
      return reply({
        result: {
          dir: "docs/adr",
          // The host's shape: a path inside the decision directory.
          files: [{ path: "0002-sync-conflicts.md", number: "0002", slug: "sync-conflicts" }],
        },
      });
    return reply({ result: { body: BODY } });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={taskflowModel()} readers={null} />);
}

describe("adrFront", () => {
  it("takes the title, the header lines and the closing rule off the text", () => {
    const { facts, markdown } = adrFront(
      "# ADR 1 — X\n\n**Status:** accepted\n**Date:** 2026-01-01\n**Concerns:** `a.go`, #12\n\n---\n\n## 1. One\n\nText",
    );
    expect(facts).toEqual([["Concerns", "`a.go`, #12"]]);
    expect(markdown.trim()).toBe("## 1. One\n\nText");
  });

  it("leaves a text without header lines as it is, below its title", () => {
    const { facts, markdown } = adrFront("# T\n\nStatus: implementiert. Date: today.\n\n## A");
    expect(facts).toEqual([]);
    expect(markdown.trim()).toBe("Status: implementiert. Date: today.\n\n## A");
  });
});

describe("the decision reader", () => {
  it("shows the header lines as facts and the status as a label with nothing to press", async () => {
    mount("/p/adr/0002-sync-conflicts.md");
    const front = await screen.findByTestId("adr-front");
    expect(
      within(front)
        .getAllByRole("term")
        .map((t) => t.textContent),
    ).toEqual(["Concerns", "Supersedes", "Added", "Measured against", "Sources"]);
    expect(within(front).getByText("cmd/taskflow/main.go").tagName).toBe("CODE");
    // Status and date are in the header once, not again as raw lines in the text.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const status = screen.getByTestId("adr-status");
    const article = screen.getByRole("article");
    expect(
      within(article)
        .queryAllByText(/Status:/)
        .filter((el) => !status.contains(el)),
    ).toEqual([]);
    expect(status).toHaveTextContent("Status:accepted");
    expect(within(status).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /status/ })).not.toBeInTheDocument();
  });

  it("folds a long decision's sections and opens the one the contents point at", async () => {
    mount("/p/adr/0002-sync-conflicts.md");
    await screen.findByTestId("adr-front");
    const folds = screen.getAllByTestId("md-fold") as HTMLDetailsElement[];
    // Precondition: the decision is over the threshold and has several sections.
    expect(BODY.split(/\s+/).length).toBeGreaterThan(500);
    expect(folds.length).toBeGreaterThan(3);
    expect(folds[0].open).toBe(true);
    const question = screen.getByRole("heading", { name: "2. The question" });
    const fold = question.closest("details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Contents" })).getByRole("link", {
        name: "2. The question",
      }),
    );
    expect(window.location.hash).toBe("#2-the-question");
    expect(window.location.pathname).toBe(`/p/adr/${PATH}`);
    expect(fold.open).toBe(true);
  });

  it("opens the section the address names on arrival", async () => {
    mount(`/p/adr/0002-sync-conflicts.md#3-what-the-rule-protects`);
    await screen.findByTestId("adr-front");
    const heading = screen.getByRole("heading", { name: "3. What the rule protects" });
    expect(heading).toHaveAttribute("id", "3-what-the-rule-protects");
    expect((heading.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(
      (
        screen
          .getByRole("heading", { name: "2. The question" })
          .closest("details") as HTMLDetailsElement
      ).open,
    ).toBe(false);
  });
});
