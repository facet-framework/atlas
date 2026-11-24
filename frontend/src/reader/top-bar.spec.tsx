/** The top bar of the running reader and the run facts the Overview states
 * beside it: the mark leads to the Overview from anywhere, the doors open
 * where they say without leaving the place, the role button carries the
 * role's name once, the bar carries the three figures and no scan line, and
 * the Overview's meta line names what this run read — a dash where nothing was
 * supplied. Every case reads the rendered shell. */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { runTime } from "@/time";
import Atlas from "./Atlas";
import { commitViews } from "./derive-reader";
import type { HostReaders } from "./host";
import { uiT } from "./testing";

const tt = uiT("en");
const where = () => decodeURIComponent(window.location.pathname);
const head = () => document.querySelector<HTMLElement>(".t-shell__head")!;
const bar = () => head().querySelector("header") as HTMLElement;

/** A host that answers only the repository state, on the given branch. */
function onBranch(branch: string): HostReaders {
  return {
    repo: async () => ({ repository: true, branch, dirty: false }),
    agent: async () => null,
    tools: async () => ({ available: false, tools: [] }),
    installed: async () => [],
  };
}

function onRepo(repo: Awaited<ReturnType<HostReaders["repo"]>>): HostReaders {
  return {
    repo: async () => repo,
    agent: async () => null,
    tools: async () => ({ available: false, tools: [] }),
    installed: async () => [],
  };
}

async function mount(
  path: string,
  model: AtlasModel = taskflowModel(),
  readers: HostReaders | null = null,
) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={readers} />);
  await act(async () => undefined);
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the mark", () => {
  it.each(["/record/tasks/create/quick-add", "/contents/cycles", "/settings/language"])(
    "leads from %s back to the Overview",
    async (from) => {
      await mount(from);
      expect(screen.queryByTestId("overview")).toBeNull();
      await userEvent.click(
        within(head()).getByRole("button", { name: "FACET Atlas, to the overview" }),
      );
      expect(where()).toBe("/");
      expect(screen.getByTestId("overview")).toBeInTheDocument();
    },
  );
});

describe("the doors in the top bar", () => {
  const RECORD = "/record/tasks/create/quick-add";

  it("opens the palette, the role menu and the other scheme without leaving the record, and settings at its page", async () => {
    await mount(RECORD);
    await userEvent.click(within(bar()).getByRole("button", { name: /^Go to/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(where()).toBe(RECORD);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    const role = within(bar()).getByRole("button", { name: tt("shell.role.dev.name") });
    await userEvent.click(role);
    expect(screen.getByRole("menu", { name: tt("shell.role.label") })).toBeInTheDocument();
    expect(where()).toBe(RECORD);
    await userEvent.keyboard("{Escape}");

    const shell = screen.getByTestId("app-shell");
    const before = shell.getAttribute("data-t-mode");
    const scheme = within(bar()).getByRole("button", {
      name: before === "light" ? tt("shell.theme.dark") : tt("shell.theme.light"),
    });
    await userEvent.click(scheme);
    expect(shell.getAttribute("data-t-mode")).not.toBe(before);
    expect(where()).toBe(RECORD);

    await userEvent.click(within(bar()).getByRole("button", { name: tt("shell.top.settings") }));
    expect(where()).toBe("/settings");
  });

  it("names the active role once, on the button that opens the role menu", async () => {
    await mount("/");
    const name = tt("shell.role.dev.name");
    const role = within(bar()).getByRole("button", { name });
    expect(role).toHaveAttribute("aria-haspopup", "menu");
    expect(role).toHaveAttribute("aria-expanded", "false");
    expect(within(bar()).getAllByText(name)).toHaveLength(1);
    await userEvent.click(role);
    expect(role).toHaveAttribute("aria-expanded", "true");
    expect(
      within(screen.getByRole("menu", { name: tt("shell.role.label") })).getAllByRole(
        "menuitemradio",
      ).length,
    ).toBeGreaterThan(1);
  });

  it("carries the record count, the proven share and the drift, and none of files, lines or anchors", async () => {
    const model = taskflowModel();
    // The run counted files, lines and anchors.
    model.scan.files = 4711;
    model.scan.loc = 98765;
    expect(model.anchorPairs.length).toBeGreaterThan(0);
    await mount("/", model);
    const terms = within(bar())
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual([
      tt("shell.top.features"),
      tt("shell.top.proven"),
      tt("shell.top.drift"),
    ]);
    // Files, lines and anchors stand on the Overview, not in the bar.
    expect(within(screen.getByTestId("overview")).getByTestId("overview-loc")).toHaveTextContent(
      /98[.,\u202f\u00a0]?765/,
    );
    expect(bar()).not.toHaveTextContent(/98[.,\u202f\u00a0]?765|4[.,\u202f\u00a0]?711/);
    expect(bar()).not.toHaveTextContent(/Files|Lines|Anchors/);
  });

  it("renders 1287 of 1293 as 99 percent in the top bar", async () => {
    const model = taskflowModel();
    model.scnProven = 1287;
    model.scnTotal = 1293;
    await mount("/", model);
    const proven = within(bar()).getByText(tt("shell.top.proven")).parentElement!;
    expect(proven).toHaveTextContent("99%");
    expect(proven).not.toHaveTextContent("100%");
  });
});

describe("what the Overview says this run read", () => {
  it("shows the repository name, branch and abbreviated commit", async () => {
    await mount(
      "/",
      taskflowModel(),
      onRepo({
        repository: true,
        name: "Taskflow repository",
        branch: "feat/history",
        commit: "abcdef1234567890",
        dirty: false,
      }),
    );
    await userEvent.click(within(bar()).getByRole("button", { name: tt("shell.role.dev.name") }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /New here/ }));
    const overview = screen.getByTestId("overview");
    expect(overview).toHaveTextContent("Taskflow");
    expect(overview).toHaveTextContent("feat/history · abcdef12");
  });

  it("shows one read commit in Recently changed and the matching record History", async () => {
    const model = taskflowModel();
    const recordPath = model.features.find(
      (record) => record.id === "tasks/create/quick-add",
    )?.path;
    expect(recordPath).toBeDefined();
    const repo = onRepo({
      repository: true,
      branch: "history-fixture",
      dirty: false,
      historyWindow: 50,
      historyExhausted: false,
      history: [
        {
          date: "2026-11-20",
          sha: "1234567890abcdef",
          subject: "change quick add",
          files: [recordPath!],
        },
      ],
    });
    await expect(repo.repo()).resolves.toMatchObject({
      history: [{ subject: "change quick add" }],
    });
    expect(commitViews(model, (await repo.repo()).history)).toEqual([
      expect.objectContaining({ record: "tasks/create/quick-add", subject: "change quick add" }),
    ]);
    await mount("/", model, repo);
    await waitFor(() =>
      expect(screen.getByTestId("overview")).toHaveTextContent("history-fixture"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 2, name: "Recently changed" }).closest("section"),
      ).toHaveTextContent("change quick add"),
    );
    cleanup();
    await mount("/record/tasks/create/quick-add", model, repo);
    await waitFor(() =>
      expect(screen.getByTestId("section-history")).toHaveTextContent("change quick add"),
    );
  });
  it("names the branch the host reports, the time of the run and the facet version, and a dash for the commit nobody supplied", async () => {
    const model = taskflowModel();
    model.scan.scannedAt = "2026-11-16T10:20:00Z";
    await mount("/", model, onBranch("feat/x"));
    const overview = screen.getByTestId("overview");
    expect(overview).toHaveTextContent("feat/x · —");
    expect(overview).toHaveTextContent(
      tt("ui.screens-frame.overviewpage-time", {
        time: runTime(model.scan.scannedAt, "en") ?? "—",
      }),
    );
    expect(overview).toHaveTextContent(`schema ${String(model.rc.schema_version)}`);
  });

  it("says a dash for a run time and a branch nobody supplied, never a made-up value", async () => {
    const model = taskflowModel();
    delete model.scan.scannedAt;
    await mount("/", model);
    const overview = screen.getByTestId("overview");
    expect(overview).toHaveTextContent(tt("ui.screens-frame.overviewpage-time", { time: "—" }));
    expect(overview).toHaveTextContent("— · —");
  });

  it("names the project by the configuration's name rather than the scanned path", async () => {
    const model = taskflowModel();
    model.rc = { ...model.rc, name: "Taskflow" };
    model.scan.registry = "/tmp/x/docs/facets";
    await mount("/", model);
    await userEvent.click(within(bar()).getByRole("button", { name: tt("shell.role.dev.name") }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /New here/ }));
    const overview = screen.getByTestId("overview");
    expect(overview).toHaveTextContent(
      tt("ui.screens-frame.overviewpage-records-describe-what-project-can-do", {
        project: "Taskflow",
      }),
    );
    expect(overview).not.toHaveTextContent("/tmp/x");
    cleanup();
  });
});
