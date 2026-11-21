/** The named source view in the Atlas settings, under the repository
 * section: what the reader shows was resolved through which checkouts. */

import { render, screen, within } from "@testing-library/react";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import type { SourceViewSummary } from "@/chrome/source-view";

const model = taskflowModel();

const view: SourceViewSummary = {
  name: "release-2026",
  registryRepository: "github.com/acme/taskflow-records",
  registryRevision: "4f2a9c1",
  recordContentHash: "sha256:rec0ff",
  sources: [
    {
      repository: "github.com/acme/taskflow-app",
      revision: "b81d002",
      contentHash: "sha256:app111",
      dirty: true,
    },
    {
      repository: "github.com/acme/taskflow-sync",
      revision: "c0ffee9",
      contentHash: "sha256:sync22",
      dirty: false,
    },
  ],
};

function mount(sourceView?: SourceViewSummary) {
  window.history.replaceState(null, "", "/settings/git-provider");
  return render(<Atlas model={model} readers={null} sourceView={sourceView} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the source view in the Atlas settings", () => {
  it("names the record repository and every selected source with revision, hash and local changes", () => {
    mount(view);
    const card = screen.getByTestId("source-view");
    expect(within(card).getByRole("heading", { name: "Source view: release-2026" })).toBeVisible();
    expect(within(card).getByTestId("source-view-registry")).toHaveTextContent(
      "github.com/acme/taskflow-records",
    );
    expect(card).toHaveTextContent("4f2a9c1");
    expect(card).toHaveTextContent("sha256:rec0ff");
    const [app, sync] = within(card).getAllByTestId("source-view-source");
    expect(app).toHaveTextContent("github.com/acme/taskflow-app");
    expect(app).toHaveTextContent("b81d002");
    expect(app).toHaveTextContent("sha256:app111");
    expect(within(app).getByTestId("source-view-dirty")).toHaveTextContent("Has local changes");
    expect(sync).toHaveTextContent("c0ffee9");
    expect(sync).toHaveTextContent("sha256:sync22");
    expect(within(sync).getByTestId("source-view-dirty")).toHaveTextContent("No local changes");
  });

  it("says so when the record repository's identity was not declared", () => {
    mount({ ...view, registryRepository: undefined, registryRevision: undefined });
    const card = screen.getByTestId("source-view");
    expect(within(card).getByTestId("source-view-registry")).toHaveTextContent(
      "Repository identity not declared",
    );
    expect(card).not.toHaveTextContent("4f2a9c1");
  });

  it("shows no view where the project has none", () => {
    mount(undefined);
    // The repository section is there; only the view is absent.
    expect(
      screen.getByRole("heading", { level: 2, name: /Git provider|Repository/ }),
    ).toBeVisible();
    expect(screen.queryByTestId("source-view")).not.toBeInTheDocument();
  });
});
