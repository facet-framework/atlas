/** The anchors and files out of step with the records, on the developer's
 * Overview of the real Atlas (the role a first visit reads under). TaskFlow sends one orphaned anchor and a
 * file list without line counts; each case changes the scan where it needs
 * something else and checks first that the change is there. */

import { render, screen, within } from "@testing-library/react";
import type { AtlasModel, RepoScan } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { anchorCoverage } from "./derive-roles";

function withScan(patch: Partial<RepoScan>): AtlasModel {
  const m = taskflowModel();
  return { ...m, scan: { ...m.scan, ...patch } };
}

function developerOverview(model: AtlasModel) {
  window.history.replaceState(null, "", "/");
  render(<Atlas model={model} readers={null} />);
  // Precondition: the Overview is read under the developer's role.
  expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "dev");
  return screen.getByTestId("overview-dev-coverage");
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("anchors and files on the developer's overview", () => {
  it("names an anchor pointing at no record with its file, line and the id it claims", () => {
    const model = taskflowModel();
    // Precondition: TaskFlow's scan carries one orphaned anchor.
    expect(anchorCoverage(model).orphans).toEqual([
      { path: "apps/web/src/tasks/inline_edit.tsx", line: 64, id: "tasks/edit/inline-edit" },
    ]);
    const sheet = developerOverview(model);
    const row = within(
      within(sheet).getByRole("list", { name: "Anchors without a record" }),
    ).getByRole("listitem");
    expect(row).toHaveTextContent("apps/web/src/tasks/inline_edit.tsx:64");
    // Split so the scanner does not read the expectation as an anchor of this file.
    expect(row).toHaveTextContent(`${"@"}facet: tasks/edit/inline-edit`);
  });

  it("counts files and says so where the run counted no lines", () => {
    const model = withScan({ totalLoc: undefined, anchoredLoc: undefined });
    const files = anchorCoverage(model).undescribed!;
    // Precondition: a file list without a line total.
    expect(files.length).toBeGreaterThan(0);
    expect(anchorCoverage(model).measure.unit).toBe("files");
    const sheet = developerOverview(model);
    expect(within(sheet).getByTestId("coverage-files-head")).toHaveTextContent(
      `${files.length} files · lines not counted`,
    );
    expect(
      within(within(sheet).getByRole("list", { name: "Files without an anchor" })).getAllByRole(
        "listitem",
      )[0],
    ).toHaveTextContent(files[0].path);
  });

  it("measures the undescribed part in lines against the lines read", () => {
    const model = withScan({ totalLoc: 12000, anchoredLoc: 9000 });
    const sheet = developerOverview(model);
    expect(within(sheet).getByTestId("coverage-files-head")).toHaveTextContent(
      "3,000 of 12,000 lines",
    );
  });

  it("tells a clean stock apart from a run that sent no file list", () => {
    const clean = developerOverview(withScan({ unanchoredFiles: [], totalLoc: undefined }));
    expect(within(clean).getByTestId("coverage-files-empty")).toHaveTextContent(
      "Every file read is described.",
    );
    expect(within(clean).getByTestId("coverage-files-head")).toHaveTextContent(
      "0 files · lines not counted",
    );
  });

  it("writes no count where the run sent no file list", () => {
    const model = withScan({ unanchoredFiles: undefined, totalLoc: undefined });
    expect(anchorCoverage(model)).toMatchObject({ undescribed: null, measure: { unit: "none" } });
    const sheet = developerOverview(model);
    expect(within(sheet).getByTestId("coverage-files-empty")).toHaveTextContent(
      "The scan sent no file list.",
    );
    expect(within(sheet).getByTestId("coverage-files-head")).toHaveTextContent(/^—$/);
  });
});
