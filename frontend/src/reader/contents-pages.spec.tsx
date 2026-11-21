/** The Contents pages of Atlas as the reader meets them, mounted as the app
 * over a TaskFlow corpus: a share stands only over a denominator, a size the
 * scan did not measure says so, a knowledge row counts what the record
 * answered of what it declares, and a promise is read and followed back to its
 * record from the promise list, on a desktop and on a phone. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadCorpus, type AtlasModel } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";

const where = () => window.location.pathname;
const realMatchMedia = window.matchMedia;

/** The TaskFlow corpus with its scan and records changed. */
function corpus({
  scan = {},
  edit = {},
}: {
  scan?: Record<string, unknown>;
  edit?: Record<string, (yaml: string) => string>;
} = {}): AtlasModel {
  const records = { ...RECORDS };
  for (const [file, fn] of Object.entries(edit)) records[file] = fn(records[file]);
  return loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: { ...SCAN, ...scan } });
}

let mounted: ReturnType<typeof render> | null = null;
function mount(path: string, model: AtlasModel = taskflowModel()) {
  mounted?.unmount();
  window.history.replaceState(null, "", path);
  mounted = render(<Atlas model={model} readers={null} />);
  return mounted;
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  window.matchMedia = realMatchMedia;
});

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

const QUICK_ADD = "docs/facets/features/tasks/create/quick-add.yaml";

/** Every `verification:` block of the corpus emptied: no promise has a declared test. */
function withoutTests(): AtlasModel {
  const edit: Record<string, (yaml: string) => string> = {};
  for (const file of Object.keys(RECORDS))
    edit[file] = (yaml) => yaml.replace(/^verification:\n(?:[ ].*\n)*/m, "");
  return corpus({ edit });
}

/** Every `knowledge:` block of the corpus removed. */
function withoutKnowledge(): AtlasModel {
  const edit: Record<string, (yaml: string) => string> = {};
  for (const file of Object.keys(RECORDS))
    edit[file] = (yaml) => yaml.replace(/^knowledge:\n(?:[ ].*\n)*/m, "");
  return corpus({ edit });
}

describe("a share on a contents page", () => {
  it("is left out of the Tests page where no test is declared, rather than reading 0 %", () => {
    const model = withoutTests();
    // Precondition: the corpus really declares no test.
    expect(model.recs.every((r) => r.tests.length === 0)).toBe(true);
    mount("/contents/tests", model);
    const page = screen.getByTestId("tests-page");
    expect(page).not.toHaveTextContent(/%/);
    expect(page).not.toHaveTextContent("unit tests.");
  });

  it("stands on the Tests page over the declared tests", () => {
    mount("/contents/tests");
    expect(screen.getByTestId("tests-page")).toHaveTextContent(/\d+% of them are unit tests\./);
  });

  it("is left out of the Knowledge page where no active record carries knowledge", () => {
    const model = withoutKnowledge();
    expect(model.recs.some((r) => r.present.knowledge)).toBe(false);
    mount("/contents/knowledge", model);
    const page = screen.getByTestId("knowledge-page");
    expect(page).not.toHaveTextContent(/%/);
  });

  it("measures the files tile in anchored of scanned files and the promises tile in named of all promises", () => {
    const anchored = SCAN.anchoredFiles!.length;
    const scanned = anchored + SCAN.unanchoredFiles!.length + 5;
    const model = corpus({ scan: { files: scanned } });
    mount("/contents", model);
    const files = screen.getByTestId("kind-files");
    // Anchored files over the files the scan counted, both in files.
    expect(within(files).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      String(Math.round((anchored / scanned) * 100)),
    );
    const promises = screen.getByTestId("kind-promises");
    const named = model.allScn.filter((s) => s.proven).length;
    expect(within(promises).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      String(Math.round((named / model.allScn.length) * 100)),
    );
  });
});

describe("a size the scan did not measure", () => {
  it("reads as not measured and ranks last among the largest gaps, never as zero lines", async () => {
    const model = corpus({
      scan: {
        unanchoredFiles: [
          { path: "src/small.ts", loc: 12 },
          { path: "src/unknown.ts" },
          { path: "src/big.ts", loc: 400 },
        ],
      },
    });
    mount("/contents/files", model);
    await userEvent.click(screen.getByRole("radio", { name: "Largest gaps" }));
    const gaps = within(screen.getByTestId("files-gaps")).getAllByRole("listitem");
    const order = ["big.ts", "small.ts", "unknown.ts"];
    expect(gaps.map((g) => order.find((name) => g.textContent?.includes(name)))).toEqual(order);
    expect(within(gaps[2]).getByTestId("file-gap-loc-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
    expect(screen.getByTestId("files-page")).not.toHaveTextContent(/\b0 Lines/);
  });

  it("names the host's line total in the head, and a dash where the scan reports none", () => {
    mount("/contents/files");
    expect(screen.getByTestId("files-page")).toHaveTextContent(/84,200 lines read/);
    mount("/contents/files", corpus({ scan: { totalLoc: undefined } }));
    expect(screen.getByTestId("files-page")).toHaveTextContent("— lines read");
  });
});

describe("a knowledge row", () => {
  it("counts what the record answered in words of what its block declares", async () => {
    // quick-add with its pitfalls declared and left open: five slots, three
    // answered in words, one derived from anchors and tests.
    const model = corpus({
      edit: {
        [QUICK_ADD]: (yaml) =>
          yaml.replace("lineage:\n", "  common_pitfalls:\n    question: q\nlineage:\n"),
      },
    });
    const rec = model.byId["tasks/create/quick-add"];
    expect(rec.knowledge).toHaveLength(5);
    expect(rec.knowledge.filter((k) => k.answer?.trim())).toHaveLength(3);
    mount("/contents/knowledge", model);
    await userEvent.click(screen.getByRole("radio", { name: "Open questions" }));
    await userEvent.click(screen.getByRole("tab", { name: /^Pitfalls/ }));
    const open = screen.getByRole("list", { name: "Open: Pitfalls" });
    const row = within(open)
      .getByRole("button", { name: /quick-add$/ })
      .closest("li")!;
    // The derived slot is not open, and not an answer either.
    expect(within(row).getByLabelText("3 of 5 answered")).toBeInTheDocument();
    expect(within(row).queryByLabelText("4 of 5 answered")).toBeNull();
  });
});

describe("a promise on the Promises page", () => {
  it("opens into its Given/When/Then reader and leads to its record", async () => {
    mount("/contents/promises");
    await userEvent.click(screen.getByRole("radio", { name: "List" }));
    const list = screen.getByRole("list", { name: "Promises" });
    const row = within(list)
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("task-added"))!;
    await userEvent.click(row);
    const detail = screen.getByTestId("promise-detail");
    expect(within(detail).getByText("Then")).toBeInTheDocument();
    expect(where()).toBe("/contents/promises");
    await userEvent.click(within(detail).getByRole("button", { name: /^Record quick-add/ }));
    expect(where()).toBe("/record/tasks/create/quick-add");
    expect(screen.getByTestId("record")).toBeInTheDocument();
  });

  it("opens as a sheet over the list on a phone, and closing it leaves the list", async () => {
    phone();
    mount("/contents/promises");
    await userEvent.click(screen.getByRole("radio", { name: "List" }));
    const row = within(screen.getByRole("list", { name: "Promises" }))
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("task-added"))!;
    await userEvent.click(row);
    const sheet = screen.getByRole("dialog", { name: "Promise" });
    expect(within(sheet).getByTestId("promise-detail")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Promise" })).toBeNull();
    expect(screen.getByRole("list", { name: "Promises" })).toBeInTheDocument();
    expect(where()).toBe("/contents/promises");
  });
});

describe("the Deviations page", () => {
  it("lists declared deviations apart from the promises, with their reason and confirmation", () => {
    const model = corpus({
      edit: {
        [QUICK_ADD]: (yaml) =>
          yaml
            .replace(
              "Then no task is created and the field shows a hint\n",
              "Then no task is created and the field shows a hint\n" +
                "      deviation:\n" +
                "        reason: the hint uses alert()\n" +
                "        confirmed_by: code-review\n",
            )
            .replace(
              "Then it lands in the local queue and syncs exactly once on reconnect\n",
              "Then it lands in the local queue and syncs exactly once on reconnect\n" +
                "      deviation:\n" +
                "        reason: a second reconnect syncs twice\n",
            ),
      },
    });
    // Precondition: both deviations reached the parsed record.
    expect(model.byId["tasks/create/quick-add"].scenarios.filter((s) => s.deviation)).toHaveLength(
      2,
    );
    mount("/contents/deviations", model);
    const list = screen.getByRole("list", { name: "Deviations" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const confirmed = items.find((i) => i.textContent?.includes("the hint uses alert()"))!;
    expect(confirmed).toHaveTextContent("code-review");
    const open = items.find((i) => i.textContent?.includes("a second reconnect syncs twice"))!;
    expect(open).toHaveTextContent("not confirmed");
  });

  it("says when no promise deviates", () => {
    mount("/contents/deviations");
    expect(screen.getByTestId("deviations-page")).toHaveTextContent("No promise deviates.");
    expect(screen.queryByRole("list", { name: "Deviations" })).toBeNull();
  });
});
