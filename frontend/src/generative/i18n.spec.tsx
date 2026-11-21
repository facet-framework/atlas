import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { buildModel, type AgentStream, type RawRecord } from "@/model";
import i18n from "../i18n";
import { derive } from "../derive";
import { NavContext, type Nav } from "../nav";
import GenerativeSection from "./GenerativeSection";
import { relativeTime } from "./origin";
import { genTilesFor } from "./tiles";
import { hashContext } from "./context";

const record: RawRecord = {
  path: "docs/facets/features/demo/tasks/create.yaml",
  raw: "",
  doc: {
    id: "demo/tasks/create",
    lifecycle: "active",
    intent: { summary: "Original document text" },
    lineage: { owner: { team: "demo" }, created_at: "2026-10-20" },
  },
};
const model = derive(
  buildModel({ name: "demo" }, [record.path], [record], {
    scannedAt: "2026-10-29T12:00:00Z",
    anchors: { "demo/tasks/create": [{ path: "src/task.ts", line: 1, role: "primary" }] },
  }),
);
const nav = { open: jest.fn() } as unknown as Nav;

afterEach(async () => {
  jest.restoreAllMocks();
  await i18n.changeLanguage("en");
});

it("updates built-in tile titles and relative time without restarting model requests", async () => {
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ auth: { loggedIn: true }, models: [], model: "test" }),
  })) as unknown as typeof fetch;
  const stream: AgentStream = { addEventListener: jest.fn(), close: jest.fn() };
  const open = jest.fn(() => stream);
  render(
    <NavContext.Provider value={nav}>
      <GenerativeSection readerRole="newcomer" v={model} model="test" openStream={open} />
    </NavContext.Provider>,
  );
  await waitFor(() => expect(open).toHaveBeenCalledTimes(3));
  expect(screen.getByText("What is the technology stack?")).toBeInTheDocument();
  expect(relativeTime(0, 90_000)).toBe("2 min ago");
  await act(async () => {
    await i18n.changeLanguage("de");
  });
  expect(screen.getByText(germanLabel("What is the technology stack?"))).toBeInTheDocument();
  expect(screen.getByText(germanLabel("What are the core features?"))).toBeInTheDocument();
  expect(relativeTime(0, 90_000)).toBe(
    i18n.getFixedT("de")("ui.generative.origin-count-min-ago", { count: 2 }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  expect(open).toHaveBeenCalledTimes(3);
});

it("updates rendered cached tile and section timestamps when the language changes", async () => {
  const now = Date.UTC(2026, 9, 31, 12);
  jest.spyOn(Date, "now").mockReturnValue(now);
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ auth: { loggedIn: true }, models: [], model: "test" }),
  })) as unknown as typeof fetch;
  const generated = genTilesFor("newcomer", model, nav).filter((t) => t.kind === "generated");
  const entries = Object.fromEntries(
    generated.map((t) => [
      t.id,
      {
        text: "Saved host answer",
        ctxN: t.ctx.length,
        ofN: model.M.length,
        model: "test",
        at: now - 90_000,
        hash: hashContext(model, t.ctx),
      },
    ]),
  );
  const open = jest.fn();
  render(
    <NavContext.Provider value={nav}>
      <GenerativeSection
        readerRole="newcomer"
        v={model}
        model="test"
        openStream={open}
        storage={{ getItem: () => JSON.stringify(entries), setItem: jest.fn() }}
      />
    </NavContext.Provider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("gen-live-newcomer")).toHaveTextContent("3 texts · 2 min ago"),
  );
  for (const tile of generated)
    expect(
      within(screen.getByTestId(`gen-tile-${tile.id}`)).getByText("2 min ago", { exact: true }),
    ).toBeInTheDocument();
  await act(async () => {
    await i18n.changeLanguage("de");
  });
  expect(screen.getByTestId("gen-live-newcomer")).toHaveTextContent(
    `3 ${germanLabel("texts")} · ${i18n.getFixedT("de")("ui.generative.origin-count-min-ago", { count: 2 })}`,
  );
  for (const tile of generated) {
    const article = within(screen.getByTestId(`gen-tile-${tile.id}`));
    expect(
      article.getByText(i18n.getFixedT("de")("ui.generative.origin-count-min-ago", { count: 2 }), {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(article.queryByText("2 min ago")).not.toBeInTheDocument();
  }
  expect(open).not.toHaveBeenCalled();
});
