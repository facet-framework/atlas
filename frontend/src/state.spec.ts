/** The remembered state — and above all what happens to it when the interface
 * changes under it. */

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import {
  parseAudience,
  parseFilter,
  readStored,
  writeState,
  STORAGE_KEY,
  usePager,
  type AtlasState,
  type Pager,
  parseAgent,
  initialState,
} from "./state";
import { MAX_ANSWER, newConversation, INTERRUPTED } from "./ask/conversations";

function stored(value: unknown): Partial<AtlasState> {
  return readStored({ getItem: () => JSON.stringify(value) });
}

describe("parseFilter", () => {
  it("leaves every value standing that the list carries today", () => {
    for (const value of ["all", "open", "unbacked", "proven", "dev"]) {
      expect(parseFilter(value)).toBe(value);
    }
  });

  it("drops what no button carries any more", () => {
    // A value no choice knows any more lets no row through — the surface
    // would look like a corpus without content. `undefined` means: the
    // default holds.
    expect(parseFilter("none-data")).toBeUndefined();
    expect(parseFilter(7)).toBeUndefined();
    expect(parseFilter(null)).toBeUndefined();
  });
});

describe("parseAudience", () => {
  it("leaves every audience standing that the row carries today", () => {
    for (const value of ["all", "product", "engineering"]) {
      expect(parseAudience(value)).toBe(value);
    }
  });

  it("drops what no button carries", () => {
    // Worse than with the proof filter: an unknown value would let no row
    // through, and the surface would show a registry in which nobody promises
    // anything — without a hint that this comes from yesterday's browser storage.
    expect(parseAudience("user-story")).toBeUndefined();
    expect(parseAudience("technical-function")).toBeUndefined();
    expect(parseAudience(null)).toBeUndefined();
  });
});

describe("readStored", () => {
  it("remembers the chosen audience across a restart", () => {
    // It belongs to the reader and not to the visit: whoever reads the
    // registry as a specification reads it that way again tomorrow.
    expect(stored({ aud: "product" }).aud).toBe("product");
  });

  it("does not even hand out an unknown audience", () => {
    const out = stored({ aud: "product-manager", mfilter: "proven" });
    expect(out).not.toHaveProperty("aud");
    expect(out.mfilter).toBe("proven");
  });

  it("does not even hand out an unknown filter", () => {
    const out = stored({ tfilter: "whatever", mfilter: "proven" });
    expect(out).not.toHaveProperty("tfilter");
    expect(out.mfilter).toBe("proven");
  });

  // Whoever switched a plugin off did not mean "until the next load".
  // The choice therefore stands in the same list as filters — and the
  // counter-check stands beside it: taking it out of the list turns exactly
  // this case red and no other.
  it("remembers a switched-off plugin across a restart", () => {
    expect(stored({ pluginsOff: ["notes"] }).pluginsOff).toEqual(["notes"]);
  });

  it("really writes the switched-off plugins into storage", () => {
    const written: Record<string, string> = {};
    writeState(
      { ...initialState, pluginsOff: ["notes"] },
      { setItem: (k, v) => void (written[k] = v) },
    );
    expect(JSON.parse(written[STORAGE_KEY])).toMatchObject({ pluginsOff: ["notes"] });
  });

  // The same promise as for pluginsOff, for the fourth choice from the
  // settings surface: whoever switched on a role's generative surface did not
  // mean "until the next load".
  it("remembers a switched-on generative role across a restart", () => {
    expect(stored({ generativeOn: ["newcomer"] }).generativeOn).toEqual(["newcomer"]);
  });

  it("really writes the switched-on generative roles into storage", () => {
    const written: Record<string, string> = {};
    writeState(
      { ...initialState, generativeOn: ["newcomer", "dev"] },
      { setItem: (k, v) => void (written[k] = v) },
    );
    expect(JSON.parse(written[STORAGE_KEY])).toMatchObject({
      generativeOn: ["newcomer", "dev"],
    });
  });

  it("takes only the fields that are meant to survive a restart", () => {
    // `depth`, `fid`, `sid` belong to the visit, not to the reader: whoever
    // opens Atlas starts at the overview and not in yesterday's detail.
    expect(stored({ tfilter: "all", depth: 2, fid: "a/b/c" })).toEqual({ tfilter: "all" });
  });

  it("hands out nothing when storage holds no object", () => {
    expect(readStored({ getItem: () => "kaputt" })).toEqual({});
    expect(readStored({ getItem: () => null })).toEqual({});
  });

  it("reads under the key the application writes under", () => {
    const keys: string[] = [];
    readStored({
      getItem: (key) => {
        keys.push(key);
        return null;
      },
    });
    expect(keys).toEqual([STORAGE_KEY]);
  });
});

describe("usePager — the gap of a short last page", () => {
  /** Holds the paging of a real hook, so that it can be turned. */
  function renderPager(): { current: Pager } {
    const halter = { current: null as Pager | null };
    function Harness() {
      halter.current = usePager();
      return null;
    }
    render(createElement(Harness));
    return halter as { current: Pager };
  }

  const numbers = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("reports no gap on a full page", () => {
    // Two pages of six each, we stand on the first: it is full, so nothing is
    // missing from its height.
    const pager = renderPager();
    const page = pager.current.paged("list", numbers(8), 6);
    expect(page.slice).toHaveLength(6);
    expect(page.fill).toBe(0);
  });

  it("reports no gap as long as everything fits on one page", () => {
    // A list without a second page cannot jump — there is nothing it would
    // have to stay as tall as. A gap would be empty space without cause here:
    // five rows of air under three rows of content.
    const pager = renderPager();
    expect(pager.current.paged("list", numbers(3), 8).fill).toBe(0);
    expect(pager.current.paged("empty", [], 8).fill).toBe(0);
  });

  it("names the number of missing rows on the short last page", () => {
    // Eight entries at six: page two shows two, four are missing. The number
    // arises here and not in the interface, because `per` leaves the paging
    // nowhere else — the surface does not even know how long a full page
    // would be.
    const pager = renderPager();
    act(() => pager.current.goto("list", 1));
    const page = pager.current.paged("list", numbers(8), 6);
    expect(page.slice).toHaveLength(2);
    expect(page.fill).toBe(4);
  });

  it("reports no gap when the last page happens to come out full", () => {
    // Twelve entries at six: page two is full itself.
    const pager = renderPager();
    act(() => pager.current.goto("list", 1));
    expect(pager.current.paged("list", numbers(12), 6).fill).toBe(0);
  });
});

describe("A remembered AI note from a foreign record", () => {
  // Mutation: carry the raw stored agent object through readStored rather than
  // validating each current text field -> the invalid values below survive.
  it("normalizes every current text field on the actual storage path", () => {
    for (const field of ["bin", "cwd", "model"] as const) {
      for (const invalid of [7, true, false, null, [], {}]) {
        const value = stored({ agent: { [field]: invalid } }).agent;
        expect(value?.[field]).toBe(field === "bin" ? "claude" : field === "model" ? "sonnet" : "");
      }
    }
  });
  it("does not take a number as the program name", () => {
    const a = parseAgent({ bin: 7 });
    expect(a.bin).toBe("claude");
    expect(typeof a.bin).toBe("string");
  });

  it("does not take a boolean as the program name either", () => {
    expect(parseAgent({ bin: true, model: false }).bin).toBe("claude");
    expect(parseAgent({ bin: true, model: false }).model).toBe("sonnet");
  });

  it("converts on the way out of storage too, not only on request", () => {
    const s = stored({ agent: { bin: 7 } });
    expect(typeof s.agent?.bin).toBe("string");
    expect(s.agent?.bin).toBe("claude");
  });

  it("fills what is missing and takes what fits", () => {
    const a = parseAgent({ bin: "claude-dev", model: "opus" });
    expect(a.bin).toBe("claude-dev");
    expect(a.model).toBe("opus");
    expect(a.cwd).toBe("");
  });

  it("takes the default for anything that is not a record", () => {
    for (const x of [null, undefined, 7, "agent", []]) {
      expect(parseAgent(x).bin).toBe("claude");
      expect(parseAgent(x).model).toBe("sonnet");
    }
  });

  it("returns only the declared agent fields", () => {
    const a = parseAgent({ bin: "claude", model: "opus", extra: true });
    expect(Object.keys(a).sort()).toEqual(["bin", "cwd", "model"]);
  });
});

describe("Conversations take the same way as filters", () => {
  const runningStep = {
    id: 1,
    name: "Where is it counted",
    busy: true,
    agent: "s1",
    turns: [
      {
        q: "Where is it counted",
        steps: [],
        answer: "half",
        cites: [],
        running: true,
        note: "Atlas is reading…",
      },
    ],
  };

  it("fetches them from storage", () => {
    const out = stored({ conversations: [runningStep], mfilter: "proven" });
    expect(out.conversations).toHaveLength(1);
    expect(out.conversations?.[0].turns[0].q).toBe("Where is it counted");
    // And the rest of the state stands beside them, not behind them.
    expect(out.mfilter).toBe("proven");
  });

  it("converts them on the way out of storage, not only on request", () => {
    // The same trap as with `parseAgent`: a conversion nobody calls is the
    // same as none. Otherwise the call could be replaced by a bare type
    // assertion without a test turning red — and the surface would then stand
    // at "Atlas is reading…" forever.
    const out = stored({ conversations: [runningStep] });
    expect(out.conversations?.[0].busy).toBe(false);
    expect(out.conversations?.[0].turns[0].running).toBe(false);
    expect(out.conversations?.[0].turns[0].note).toBe(INTERRUPTED);
  });

  it("hands out no conversations for a record that is not a list", () => {
    expect(stored({ conversations: "kaputt" }).conversations).toEqual([]);
  });

  it("stands in the list of fields that survive a restart", () => {
    // Without this entry `readStored` would not even look at the field, and
    // all conversions over it would run over something that never arrives.
    const written: Record<string, string> = {};
    writeState(
      { ...initialState, conversations: [newConversation(1)] },
      { setItem: (k, v) => void (written[k] = v) },
    );
    expect(JSON.parse(written[STORAGE_KEY])).toHaveProperty("conversations");
  });
});

describe("An overflowing storage does not take everything with it", () => {
  /** A storage that throws on the first attempt — the way a full one does. */
  function restrict(limit: number) {
    const seen: string[] = [];
    return {
      seen,
      store: {
        setItem: (_k: string, v: string) => {
          seen.push(v);
          if (v.length > limit) {
            // The same name as the browser: whoever looks for `name` here
            // has to find it.
            const e = new Error("quota");
            e.name = "QuotaExceededError";
            throw e;
          }
        },
      },
    };
  }

  const fullState: AtlasState = {
    ...initialState,
    mfilter: "proven",
    aud: "product",
    conversations: [
      {
        ...newConversation(1),
        turns: [
          {
            q: "A long question",
            steps: [],
            answer: "x".repeat(MAX_ANSWER),
            cites: [],
            running: false,
            note: "done",
          },
        ],
      },
    ],
  };

  it("leaves filters standing when the conversations break the limit", () => {
    // The case this is built against: `localStorage` writes **one** string.
    // If it breaks the limit, nothing is written — not even filters,
    // which together are a few hundred characters and have nothing to do with
    // the overflow.
    const { seen, store } = restrict(2000);
    expect(writeState(fullState, store)).toBe("without-conversations");

    const latest = JSON.parse(seen[seen.length - 1]);
    expect(latest.mfilter).toBe("proven");
    expect(latest.aud).toBe("product");
    expect(latest.mfilter).toBe("proven");
    // The conversations are the price — and only they.
    expect(latest.conversations).toBeUndefined();
  });

  it("reports completion when everything fits", () => {
    const { store } = restrict(1_000_000);
    expect(writeState(fullState, store)).toBe("complete");
  });

  it("reports when the second attempt writes nothing either", () => {
    // A private window throws on every write. Then nothing is saved, and the
    // surface must not report the opposite.
    const { store } = restrict(0);
    expect(writeState(fullState, store)).toBe("nothing");
  });

  it("shortens the conversations on the first attempt already", () => {
    // The cap takes hold on **writing** and not only on the next load: a
    // record that breaks the limit breaks it.
    const viele: AtlasState = {
      ...initialState,
      conversations: [
        {
          ...newConversation(1),
          turns: [
            {
              q: "F",
              steps: [],
              answer: "y".repeat(MAX_ANSWER * 3),
              cites: [],
              running: false,
              note: "",
            },
          ],
        },
      ],
    };
    const { seen, store } = restrict(1_000_000);
    writeState(viele, store);
    const firstItem = JSON.parse(seen[0]);
    expect(firstItem.conversations[0].turns[0].answer).toHaveLength(MAX_ANSWER);
    expect(firstItem.conversations[0].turns[0].truncated).toBe(true);
  });
});
