/** The generative section, drawn: loading state → result, remembered (a second
 * render does not call `askAgent` again), the regenerate symbol, the failure
 * case. */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { buildModel, type AgentStream, type RawRecord } from "@/model";
import GenerativeSection from "./GenerativeSection";
import { derive } from "../derive";
import { NavContext, type Nav } from "../nav";
import { _resetGenSetsForTests, registerGenSet } from "./tiles";

const RAWS: RawRecord[] = [
  {
    path: "docs/facets/a/b/core.yaml",
    raw: "",
    doc: {
      id: "a/b/core",
      lifecycle: "active",
      intent: { summary: "A core record." },
      lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
    },
  },
];
const v = derive(
  buildModel(
    { name: "gen" },
    RAWS.map((r) => r.path),
    RAWS,
  ),
);

const nav: Nav = {
  go: jest.fn(),
  open: jest.fn(),
  openScenario: jest.fn(),
  openSheet: jest.fn(),
  closeSheet: jest.fn(),
  openArea: jest.fn(),
  closeArea: jest.fn(),
  openCatalogue: jest.fn(),
  closeCatalogue: jest.fn(),
  openSet: jest.fn(),
  closeSet: jest.fn(),
  openPalette: jest.fn(),
  ask: jest.fn(),
  setRole: jest.fn(),
};

/** A stream the test writes — the same pattern as `Ask.spec.tsx`. */
function scriptedStream() {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const closes: (() => void)[] = [];
  let closed = false;
  const stream: AgentStream = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close() {
      closed = true;
    },
  };
  return {
    open: () => {
      closes.push(stream.close);
      return stream;
    },
    closed: () => closed,
    emit(type: string, payload: Record<string, unknown>) {
      act(() => {
        for (const listener of listeners.get(type) ?? []) {
          listener({ data: JSON.stringify(payload) } as MessageEvent);
        }
      });
    },
  };
}

/** `agentState()` reads through `fetch` — set to "signed in" here. */
function signedInFetch() {
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ auth: { loggedIn: true }, models: [], model: "haiku" }),
  })) as unknown as typeof fetch;
}

function signedOutFetch() {
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ auth: { loggedIn: false }, models: [], model: "haiku" }),
  })) as unknown as typeof fetch;
}

/** Allows localStorage-like persistence per test case, without sharing the real browser storage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, derived: string) => {
      data.set(k, derived);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

/** Lets real time pass, inside `act` — this suite uses no fake timers. */
async function waitForDelay(ms: number) {
  await act(async () => {
    await new Promise((next) => setTimeout(next, ms));
  });
}

function draw(openStream: (url: string) => AgentStream, storage: Storage) {
  return render(
    <NavContext.Provider value={nav}>
      <GenerativeSection
        readerRole="newcomer"
        v={v}
        model="haiku"
        openStream={openStream}
        storage={storage}
      />
    </NavContext.Provider>,
  );
}

beforeEach(() => {
  registerGenSet("newcomer", () => [
    {
      id: "core",
      kind: "generated",
      title: "What are the core features?",
      ctx: ["a/b/core"],
      request: "Name the core features in two sentences.",
    },
    { id: "m:x", kind: "measured", title: "A fact", basis: "calculated · x", body: <p>42</p> },
  ]);
});

afterEach(() => {
  _resetGenSetsForTests();
  jest.restoreAllMocks();
});

describe("a generated tile: loading state → result", () => {
  it("shows the empty state until the run begins, then the loading state, then the text", async () => {
    signedInFetch();
    const feed = scriptedStream();
    draw(feed.open, memoryStorage());

    await waitFor(() => expect(screen.getByTestId("gen-tile-core")).toBeInTheDocument());

    // Mounting starts the run itself (no remembered text present) — so the
    // tile shows the loading state instead of the empty state.
    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Context"),
    );

    feed.emit("text", { text: "Three sentences." });

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Three sentences."),
    );
  });

  it("carries its origin as soon as the run is done", async () => {
    signedInFetch();
    const feed = scriptedStream();
    draw(feed.open, memoryStorage());

    // The run only starts after the mount effect has fired its `setTimeout`
    // — only then has `askAgent` registered its listeners on the scripted
    // stream, and an `emit` before that would go nowhere.
    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Context"),
    );
    feed.emit("text", { text: "Answer." });
    feed.emit("done", { session: "s1", cost: 0 });

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("from 1 of 1 records"),
    );
    expect(screen.getByTestId("gen-tile-core").textContent).toContain("haiku");
  });
});

describe("remembered: a second render does not call askAgent again", () => {
  it("shows the remembered text at once and starts no second run", async () => {
    signedInFetch();
    const storage = memoryStorage();
    const feed = scriptedStream();
    const { unmount } = draw(feed.open, storage);

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Context"),
    );
    feed.emit("text", { text: "Gemerkter Text." });
    feed.emit("done", { session: "s1", cost: 0 });
    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Gemerkter Text."),
    );
    unmount();

    const secondOpen = jest.fn(feed.open);
    draw(secondOpen, storage);

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Gemerkter Text."),
    );
    await waitFor(() => expect(screen.getByTestId("gen-all-newcomer")).toBeInTheDocument());
    await waitForDelay(50);
    // No second run: the text was already in the store, `mount()` only starts
    // tiles without remembered text.
    expect(secondOpen).not.toHaveBeenCalled();
  });
});

describe("the regenerate symbol", () => {
  it("starts a new run when a remembered tile is regenerated", async () => {
    signedInFetch();
    const storage = memoryStorage();
    const firstFeed = scriptedStream();
    const { unmount } = draw(firstFeed.open, storage);

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Context"),
    );
    firstFeed.emit("text", { text: "Alter Text." });
    firstFeed.emit("done", { session: "s1", cost: 0 });
    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Alter Text."),
    );
    unmount();

    const secondFeed = scriptedStream();
    draw(secondFeed.open, storage);
    await waitFor(() => expect(screen.getByTestId("gen-re-core")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("gen-re-core"));

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Context"),
    );

    secondFeed.emit("text", { text: "New Text." });
    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("New Text."),
    );
    expect(screen.getByTestId("gen-tile-core")).not.toHaveTextContent("Alter Text.");
  });
});

describe("the failure case", () => {
  it("shows an honest error text instead of invented content when the stream fails", async () => {
    signedInFetch();
    const feed = scriptedStream();
    draw(feed.open, memoryStorage());

    await waitFor(() =>
      expect(screen.getByTestId("gen-tile-core").textContent).toContain("Context"),
    );
    feed.emit("failed", { text: "Ratenbegrenzung (429)" });

    await waitFor(() => expect(screen.getByTestId("gen-tile-core").textContent).toContain("retry"));
    expect(screen.getByTestId("gen-tile-core").textContent).toContain("Ratenbegrenzung (429)");
    // No invented prose beside the error — the tile shows the reason, no
    // placeholder sentence.
    expect(screen.getByTestId("gen-tile-core").textContent).not.toContain("Three sentences");
  });

  it("shows a sign-in message instead of inventing an answer when nobody is signed in", async () => {
    signedOutFetch();
    const feed = scriptedStream();
    draw(feed.open, memoryStorage());

    await waitFor(() => expect(screen.getByTestId("gen-off-newcomer")).toBeInTheDocument());
    expect(screen.getByTestId("gen-off-newcomer").textContent).toContain("Not signed in");
    // The measured tile stands complete — the surface is complete without a model.
    expect(screen.getByTestId("gen-tile-m:x")).toBeInTheDocument();
    expect(screen.queryByTestId("gen-tile-core")).not.toBeInTheDocument();
  });
});

it("regenerates every generated tile from the section action", async () => {
  signedInFetch();
  const feed = scriptedStream(),
    open = jest.fn((_url: string) => feed.open());
  draw(open, memoryStorage());
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  feed.emit("text", { text: "first result" });
  feed.emit("done", { session: "first" });
  const button = screen.getByTestId("gen-all-newcomer");
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.setup().click(button);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
});

it("renders no section or invented tiles for a role with no registered set", async () => {
  _resetGenSetsForTests();
  signedOutFetch();
  let content: HTMLElement;
  await act(async () => {
    const view = render(
      <NavContext.Provider value={nav}>
        <GenerativeSection readerRole="owner" v={v} storage={memoryStorage()} />
      </NavContext.Provider>,
    );
    content = view.container;
  });
  expect(content!.innerHTML).toBe("");
});

it("preserves remembered prose and shows the failure reason after a failed regeneration", async () => {
  signedInFetch();
  const storage = memoryStorage(),
    first = scriptedStream();
  const { unmount } = draw(first.open, storage);
  await waitFor(() => expect(screen.getByTestId("gen-tile-core")).toHaveTextContent("Context"));
  first.emit("text", { text: "Remembered measured response." });
  first.emit("done", { session: "first", cost: 0 });
  await waitFor(() =>
    expect(screen.getByTestId("gen-tile-core")).toHaveTextContent("Remembered measured response."),
  );
  unmount();
  const second = scriptedStream();
  draw(second.open, storage);
  await userEvent.click(await screen.findByTestId("gen-re-core"));
  await waitFor(() => expect(screen.getByTestId("gen-tile-core")).toHaveTextContent("Context"));
  second.emit("failed", { text: "Ratenbegrenzung (429)" });
  await waitFor(() =>
    expect(screen.getByTestId("gen-tile-core")).toHaveTextContent("Ratenbegrenzung (429)"),
  );
  expect(screen.getByTestId("gen-tile-core")).toHaveTextContent("Remembered measured response.");
});
