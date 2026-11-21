import i18n from "../../frontend/src/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectorySettings } from "./DirectorySettings";
import { inEnglish, inGerman } from "./language.spec-support";

inEnglish();

type Kind = "adr" | "bpmn";
type Location = { file: string; line: number; key: string; directory: string };

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

/** Stands in for the server's answer to the first `/api/settings/directory`
 * request — the location of the key. The route itself is driven in
 * internal/ui/directory_settings_test.go; what is checked here is what the
 * component makes of the answer. */

function setup(kind: Kind, location: Partial<Location> = {}) {
  const fetcher = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      file: ".facetrc.yaml",
      line: 12,
      key: `${kind}.directory`,
      directory: "diagrams",
      ...location,
    }),
  });
  global.fetch = fetcher;
  render(<DirectorySettings kind={kind} />);
  return fetcher;
}

/** Opens the editor, picks the worktree mode and saves against `answer`. */
async function saveAsWorktree(
  fetcher: jest.Mock,
  user: ReturnType<typeof userEvent.setup>,
  answer: { file: string; dirty: boolean; worktree: string; branch: string },
) {
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("ui.shared.directorysettings-change-through-atlas"),
    }),
  );
  await user.click(
    screen.getByRole("radio", { name: /Create a separate worktree/ }),
  );
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => answer });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(answer.branch),
  );
  return screen.getByRole("status");
}

describe("the configuration source", () => {
  it("names .facetrc.yaml, bpmn.directory and its line before opening the optional editor", async () => {
    setup("bpmn");
    expect(await screen.findByText(".facetrc.yaml:12")).toBeVisible();
    expect(screen.getByText("bpmn.directory")).toBeVisible();
    expect(screen.getByText(/directory: diagrams/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("names .facetrc.yaml, adr.directory and its line for the ADR page", async () => {
    setup("adr", { line: 3, directory: "docs/decisions" });
    expect(await screen.findByText(".facetrc.yaml:3")).toBeVisible();
    expect(screen.getByText("adr.directory")).toBeVisible();
    expect(screen.getByText(/directory: docs\/decisions/)).toBeVisible();
    expect(screen.queryByText("bpmn.directory")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // The server reports an absent key as line 0 with the built-in default
  // (TestDirectorySettingsReportsAnAbsentKey). Mutation: drop the
  // `location && !location.line` branch in DirectorySettings.tsx → red.
  async function expectAbsentKey(kind: Kind) {
    setup(kind, { line: 0, directory: `docs/${kind}` });
    expect(
      await screen.findByText(/is not set yet\. Add the following entry/),
    ).toBeVisible();
    expect(screen.getByText(`${kind}.directory`)).toBeVisible();
    // No ":0" — a line that does not exist is not pointed at.
    expect(screen.getByText(".facetrc.yaml")).toBeVisible();
    expect(screen.queryByText(/\.facetrc\.yaml:/)).not.toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`^${kind}:\\s+directory: docs/${kind}$`)),
    ).toBeVisible();
  }

  // eslint-disable-next-line jest/expect-expect -- asserts in expectAbsentKey()
  it("identifies an absent bpmn key and shows the entry to add", async () => {
    await expectAbsentKey("bpmn");
  });

  // eslint-disable-next-line jest/expect-expect -- asserts in expectAbsentKey()
  it("identifies an absent adr key and shows the entry to add", async () => {
    await expectAbsentKey("adr");
  });

  it("says a present key sets the directory rather than asking to add it", async () => {
    setup("adr", { line: 3, directory: "docs/decisions" });
    expect(await screen.findByText(/sets the directory/)).toBeVisible();
    expect(screen.queryByText(/not set yet/)).not.toBeInTheDocument();
  });
});

describe("saving in the main checkout", () => {
  it("requires a choice and reports a dirty main checkout", async () => {
    const fetcher = setup("bpmn");
    const user = userEvent.setup();
    await screen.findByText(".facetrc.yaml:12");
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("ui.shared.directorysettings-change-through-atlas"),
      }),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(
      screen.getByRole("radio", { name: /Change it in the main checkout/ }),
    );
    fetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: "/repo/.facetrc.yaml",
        dirty: true,
        worktree: "/repo",
        branch: "",
      }),
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(/uncommitted changes \(dirty\)/),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("/repo/.facetrc.yaml");
    expect(screen.getByRole("status")).not.toHaveTextContent("Branch:");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      kind: "bpmn",
      directory: "diagrams",
      mode: "checkout",
    });
  });

  it("sends the ADR kind and shows a clean checkout without the dirty note", async () => {
    const fetcher = setup("adr", { line: 3, directory: "docs/decisions" });
    const user = userEvent.setup();
    await screen.findByText(".facetrc.yaml:3");
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("ui.shared.directorysettings-change-through-atlas"),
      }),
    );
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "docs/main");
    await user.click(
      screen.getByRole("radio", { name: /Change it in the main checkout/ }),
    );
    fetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: "/repo/.facetrc.yaml",
        dirty: false,
        worktree: "/repo",
        branch: "",
      }),
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "/repo/.facetrc.yaml",
      ),
    );
    expect(screen.queryByText(/\(dirty\)/)).not.toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      kind: "adr",
      directory: "docs/main",
      mode: "checkout",
    });
  });

  it("shows a refused write as an alert and no saved state", async () => {
    const fetcher = setup("adr", { line: 3, directory: "docs/decisions" });
    const user = userEvent.setup();
    await screen.findByText(".facetrc.yaml:3");
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("ui.shared.directorysettings-change-through-atlas"),
      }),
    );
    await user.click(
      screen.getByRole("radio", { name: /Change it in the main checkout/ }),
    );
    fetcher.mockResolvedValueOnce({
      ok: false,
      text: async () => "directory must be relative and inside the repository",
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "directory must be relative and inside the repository",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("saving in a new worktree", () => {
  it("shows the worktree, branch and PR instructions only after a successful save", async () => {
    const fetcher = setup("bpmn");
    const user = userEvent.setup();
    await screen.findByText(".facetrc.yaml:12");
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("ui.shared.directorysettings-change-through-atlas"),
      }),
    );
    await user.click(
      screen.getByRole("radio", { name: /Create a separate worktree/ }),
    );
    fetcher.mockResolvedValueOnce({
      ok: false,
      text: async () => "write refused",
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("write refused");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: "/tmp/branch/.facetrc.yaml",
        dirty: true,
        worktree: "/tmp/branch",
        branch: "atlas/bpmn-directory-123",
      }),
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "atlas/bpmn-directory-123",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("PR/MR");
    expect(screen.getByRole("status")).toHaveTextContent("git push -u origin");
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      kind: "bpmn",
      directory: "diagrams",
      mode: "worktree",
    });
  });

  it("names the BPMN worktree path and the commit, push and PR steps", async () => {
    const fetcher = setup("bpmn");
    const user = userEvent.setup();
    await screen.findByText(".facetrc.yaml:12");
    const status = await saveAsWorktree(fetcher, user, {
      file: "/tmp/branch/.facetrc.yaml",
      dirty: true,
      worktree: "/tmp/branch",
      branch: "atlas/bpmn-directory-123",
    });
    expect(status).toHaveTextContent("Worktree: /tmp/branch");
    expect(status).toHaveTextContent("Branch: atlas/bpmn-directory-123");
    expect(status).toHaveTextContent("cd '/tmp/branch'");
    expect(status).toHaveTextContent("git add .facetrc.yaml");
    expect(status).toHaveTextContent(
      'git commit -m "Configure bpmn directory"',
    );
    expect(status).toHaveTextContent(
      "git push -u origin atlas/bpmn-directory-123",
    );
    expect(status).toHaveTextContent("PR/MR");
  });

  it("names the ADR worktree path and the commit, push and PR steps", async () => {
    const fetcher = setup("adr", { line: 3, directory: "docs/decisions" });
    const user = userEvent.setup();
    await screen.findByText(".facetrc.yaml:3");
    const status = await saveAsWorktree(fetcher, user, {
      file: "/work/adr-tree/.facetrc.yaml",
      dirty: true,
      worktree: "/work/adr-tree",
      branch: "atlas/adr-directory-7",
    });
    expect(status).toHaveTextContent("Worktree: /work/adr-tree");
    expect(status).toHaveTextContent("Branch: atlas/adr-directory-7");
    expect(status).toHaveTextContent("cd '/work/adr-tree'");
    expect(status).toHaveTextContent('git commit -m "Configure adr directory"');
    expect(status).toHaveTextContent(
      "git push -u origin atlas/adr-directory-7",
    );
    expect(status).toHaveTextContent("PR/MR");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      kind: "adr",
      directory: "docs/decisions",
      mode: "worktree",
    });
  });
});

describe("the German locale", () => {
  it("still draws the German labels", async () => {
    await inGerman(async () => {
      setup("bpmn", { line: 0, directory: "docs/bpmn" });
      expect(
        await screen.findByText(
          i18n.getFixedT("de")(
            "ui.shared.directorysettings-not-set-yet-add-following-entry",
          ),
          { exact: false },
        ),
      ).toBeVisible();
      expect(
        screen.getByRole("button", {
          name: i18n.t("ui.shared.directorysettings-change-through-atlas"),
        }),
      ).toBeVisible();
    });
  });
});
