import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildModel, type RawRecord, type RepoScan } from "@/model";
import { derive } from "../derive";
import { GeneratedTile, MeasuredTile } from "./Tile";
import { techStackTile } from "./measured";
import type { GeneratedGenTile } from "./tiles";
import { hashContext } from "./context";
import i18n from "@/i18n";
import { questionForTile } from "./run";
import { genTilesFor } from "./tiles";
import { ROLE_LIST } from "../roles";
import "./tiles/index";

const RAWS: RawRecord[] = [
  {
    path: "docs/facets/features/shop/cart/total.yaml",
    raw: "",
    doc: {
      id: "shop/cart/total",
      lifecycle: "active",
      intent: { summary: "Totals the shopping cart." },
      contract: {
        scenarios: [
          { id: "a", statement: "Given a\nWhen b\nThen c" },
          { id: "b", statement: "Given a\nWhen b\nThen c" },
        ],
      },
      verification: { unit_tests: [{ id: "total.test.ts", proves: ["a"] }] },
      lineage: { owner: { team: "shop" }, created_at: "2026-01-01", depends_on: ["shop/cart/x"] },
    },
  },
];

const EXTS = ["ts", "go", "py", "rs", "java", "rb", "php"];

function scanWith(anchorPaths: string[], loc: number | null = null): RepoScan {
  return {
    scannedAt: "2026-10-09T08:00:00Z",
    files: anchorPaths.length,
    ...(loc !== null
      ? { totalLoc: loc, anchoredFiles: anchorPaths.map((path) => ({ path, loc: 250 })) }
      : {}),
    anchors: {
      "shop/cart/total": anchorPaths.map((path, i) => ({ path, line: i + 1, role: "primary" })),
    },
  };
}

function model(scan: RepoScan) {
  return derive(buildModel({ name: "shop" }, [RAWS[0].path], RAWS, scan));
}

const TILE: GeneratedGenTile = {
  id: "core",
  kind: "generated",
  title: "What are the core features?",
  ctx: ["shop/cart/total"],
  request: "Describe this project in three sentences.",
};

describe("the question a generated tile sends", () => {
  it("names each record's file, its anchor files and its measured counts", () => {
    const v = model(scanWith(["src/cart/total.ts"]));
    const q = questionForTile(v, TILE);

    // Precondition: the record really has an anchor and an unproven promise.
    expect(v.byId["shop/cart/total"].anchors).toHaveLength(1);
    expect(v.byId["shop/cart/total"].open).toBe(1);

    expect(q).toContain("docs/facets/features/shop/cart/total.yaml");
    expect(q).toContain("anchors in: src/cart/total.ts");
    expect(q).toContain("acceptance criteria 2, of which with test link 1, without test link 1");
    expect(q).toContain("requires: shop/cart/x");
  });

  it("tells the agent to open the files and to answer in Markdown", () => {
    const q = questionForTile(model(scanWith([])), TILE);
    expect(q).toMatch(/Read the named record files/);
    expect(q).toMatch(/Answer in Markdown/);
  });

  it("asks every role's tile for the answer alone, in the project's vocabulary", async () => {
    const v = model(scanWith(["src/cart/total.ts"]));
    const before = i18n.language;
    try {
      // The German surface; built after the switch, because the task text is read at build time.
      await i18n.changeLanguage("de");
      const questions = ROLE_LIST.flatMap((role) =>
        genTilesFor(role.key, v, { open: () => {} })
          .filter((t): t is GeneratedGenTile => t.kind === "generated")
          .map((t) => questionForTile(v, t)),
      );

      // Precondition: every core role contributes its three generated tiles.
      expect(questions).toHaveLength(ROLE_LIST.length * 3);
      for (const q of questions) {
        expect(q).toContain(
          i18n.getFixedT("de")("ui.generative.run-read-named-record-files-anchor-files"),
        );
        expect(q).toContain(
          i18n.getFixedT("de")("ui.generative.run-acceptance-criteria-claims-which-test-link", {
            claims: 2,
            proven: 1,
            open: 1,
          }),
        );
        expect(q).not.toContain("Write only the answer itself");
      }

      // The English surface names the same thing SHALL, and keeps the same ban on remarks.
      await i18n.changeLanguage("en");
      const english = ROLE_LIST.flatMap((role) =>
        genTilesFor(role.key, v, { open: () => {} })
          .filter((t): t is GeneratedGenTile => t.kind === "generated")
          .map((t) => questionForTile(v, t)),
      );
      expect(english).toHaveLength(ROLE_LIST.length * 3);
      for (const q of english) {
        expect(q).toContain("Write only the answer itself");
        expect(q).toContain("not a word about which files you read or did not read");
        expect(q).toContain("how you proceeded");
        expect(q).toContain("called a requirement, acceptance criterion or SHALL");
        expect(q).not.toContain(
          i18n.getFixedT("de")("ui.generative.run-read-named-record-files-anchor-files"),
        );
      }
    } finally {
      await i18n.changeLanguage(before);
    }
  });

  it("asks the agent in the reader's language, so the tile answers in it", async () => {
    const v = model(scanWith(["src/cart/total.ts"]));
    const before = i18n.language;
    const question = async (lng: string) => {
      await i18n.changeLanguage(lng);
      // Built after the switch: the task text is read through tx() at build time.
      const tile = genTilesFor(ROLE_LIST[0].key, v, { open: () => {} }).find(
        (t): t is GeneratedGenTile => t.kind === "generated",
      )!;
      return { tile, text: questionForTile(v, tile) };
    };
    try {
      const en = await question("en");
      expect(en.tile.request).toMatch(/^(Name|Say|Describe) /);
      expect(en.text).toContain(en.tile.request);
      expect(en.text).toContain("Write only the answer itself");
      expect(en.text).not.toContain(
        i18n.getFixedT("de")("ui.generative.run-read-named-record-files-anchor-files"),
      );

      const de = await question("de");
      expect(de.tile.request).toBe(germanLabel(en.tile.request));
      expect(de.text).toContain(de.tile.request);
      expect(de.text).toContain(
        i18n.getFixedT("de")("ui.generative.run-read-named-record-files-anchor-files"),
      );
      expect(de.text).not.toContain("Write only the answer");
      expect(de.tile.request).not.toBe(en.tile.request);
    } finally {
      await i18n.changeLanguage(before);
    }
  });

  it("marks a text written in another language as stale, and one without a language too", async () => {
    const v = model(scanWith([]));
    const before = i18n.language;
    const entry = (lang?: string) => ({
      text: "A cached text.",
      at: Date.now(),
      model: "m",
      ctxN: 1,
      ofN: 1,
      hash: hashContext(v, TILE.ctx),
      ...(lang ? { lang } : {}),
    });
    type CachedEntry = ReturnType<typeof entry>;
    const draw = (entry: CachedEntry) => (
      <GeneratedTile
        tile={TILE}
        v={v}
        entry={entry}
        run={null}
        errorWithoutText={null}
        onRegen={() => {}}
      />
    );
    try {
      await i18n.changeLanguage("en");
      const view = render(draw(entry("en")));
      // Precondition: the same text in its own language is not stale.
      expect(within(view.container).queryByTestId("tile-stale")).toBeNull();

      await i18n.changeLanguage("de");
      view.rerender(draw(entry("en")));
      expect(within(view.container).queryByTestId("tile-stale")).not.toBeNull();

      view.rerender(draw(entry("de")));
      expect(within(view.container).queryByTestId("tile-stale")).toBeNull();

      view.rerender(draw(entry()));
      expect(within(view.container).queryByTestId("tile-stale")).not.toBeNull();
    } finally {
      await i18n.changeLanguage(before);
    }
  });
});

describe("a generated tile's text", () => {
  it("is read as Markdown, not drawn with its marks typed out", () => {
    const v = model(scanWith([]));
    render(
      <GeneratedTile
        tile={TILE}
        v={v}
        entry={{
          text: "The project **calculates**:\n\n- the `total`\n- the tax",
          at: Date.now(),
          model: "m",
          ctxN: 1,
          ofN: 1,
          hash: hashContext(v, TILE.ctx),
        }}
        run={null}
        errorWithoutText={null}
        onRegen={() => {}}
      />,
    );
    const body = screen.getByTestId("gen-text-core");
    expect(within(body).getAllByRole("listitem")).toHaveLength(2);
    expect(within(body).getByText("calculates").tagName).toBe("STRONG");
    expect(within(body).getByText("total").tagName).toBe("CODE");
    expect(body.textContent).not.toContain("**");
  });
});

describe("the tech-stack tile", () => {
  it("names the top five languages by row and folds the rest into one", () => {
    const v = model(scanWith(EXTS.map((e, i) => `src/f${i}.${e}`)));
    render(<MeasuredTile tile={techStackTile(v)} />);
    const rows = screen.getAllByTestId("gen-stack-row").map((r) => r.textContent);
    // Precondition: seven distinct languages, more than the five shown.
    expect(EXTS).toHaveLength(7);
    expect(rows).toHaveLength(6);
    expect(rows[5]).toMatch(/^2 more/);
  });

  it("states the anchored share of the code as a percentage", () => {
    const v = model(scanWith(["src/a.ts"], 1000));
    // Precondition: the scan supplied both numbers the share is made from.
    expect(v.scan.loc).toBe(1000);
    expect(v.scan.anchoredLoc).not.toBeNull();
    render(<MeasuredTile tile={techStackTile(v)} />);
    expect(screen.getByTestId("gen-stack-coverage").textContent).toMatch(
      /^25% of code \(250 of 1[ ,]000 lines\)/,
    );
  });

  it("reads a file without an extension by its name, not by its path", () => {
    const v = model(scanWith(["deploy/docker/Dockerfile"]));
    render(<MeasuredTile tile={techStackTile(v)} />);
    const rows = screen.getAllByTestId("gen-stack-row").map((r) => r.textContent);
    expect(rows[0]).toMatch(/^Dockerfile/);
    expect(rows.join(" ")).not.toContain("deploy/");
  });
});

it.each([null, "generation failed"])(
  "requests generation from an empty or failed tile (%s)",
  async (error) => {
    const onRegen = jest.fn();
    render(
      <GeneratedTile
        tile={TILE}
        v={model(scanWith([]))}
        entry={null}
        run={null}
        errorWithoutText={error}
        onRegen={onRegen}
      />,
    );
    const id = error ? "gen-retry-core" : "gen-generate-core";
    fireEvent.click(screen.getByTestId(id));
    expect(onRegen).toHaveBeenCalledTimes(1);
  },
);
