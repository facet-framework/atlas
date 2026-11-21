/** What a stored conversation loses on reading — and what it has to keep. */

import {
  CONTINUATION_RESTARTED,
  CONTINUATION_OPEN,
  forStorage,
  highestId,
  MAX_ANSWER,
  MAX_CONVERSATIONS,
  MAX_TURNS,
  MAX_STEPS,
  restoreConversations,
  afterRun,
  newConversation,
  INTERRUPTED,
  type Conversation,
} from "./conversations";

/** A conversation as the store holds it — as a raw object, not as a type. */
function storedValue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: "Where is it counted",
    busy: false,
    agent: "s1",
    turns: [
      {
        q: "Where is it counted",
        steps: [{ kind: "Read", target: "internal/ui/corpus.go" }],
        answer: "In `corpus.go`.",
        cites: [{ fid: "core/corpus/scan", label: "scan" }],
        running: false,
        note: "1 Steps · 1 matches",
      },
    ],
    ...over,
  };
}

describe("The running stream does not survive the restart", () => {
  it("does not take a stored running as running", () => {
    // The one line this is about. Without it, the conversation stands at
    // "Atlas is reading…" forever.
    const [g] = restoreConversations([
      storedValue({
        busy: true,
        turns: [
          {
            q: "Question",
            steps: [],
            answer: "half",
            cites: [],
            running: true,
            note: "Atlas is reading…",
          },
        ],
      }),
    ]);
    expect(g.busy).toBe(false);
    expect(g.turns[0].running).toBe(false);
  });

  it("replaces the sentence about the running stream instead of leaving it standing", () => {
    // `running: false` alone is not enough: the `note` would still carry
    // "Atlas is reading…", and the question line prints exactly that. The sentence
    // is transient and should not be restored.
    const [g] = restoreConversations([
      storedValue({
        turns: [
          {
            q: "Question",
            steps: [],
            answer: "half",
            cites: [],
            running: true,
            note: "Atlas is reading…",
          },
        ],
      }),
    ]);
    expect(g.turns[0].note).toBe(INTERRUPTED);
    expect(g.turns[0].note).not.toMatch(/reads|answers/i);
  });

  it("calls it interrupted and not cancelled", () => {
    // "cancelled" belongs in this build to a deliberate cancellation — the
    // reader asks a new question, closes the conversation. Here nobody ended
    // anything; the tab went away.
    expect(INTERRUPTED).not.toMatch(/aborted/);
    const [g] = restoreConversations([
      storedValue({
        turns: [{ q: "F", steps: [], answer: "half", cites: [], running: true, note: "x" }],
      }),
    ]);
    expect(g.turns[0].interrupted).toBe(true);
  });

  it("keeps the half answer — it is what arrived", () => {
    const [g] = restoreConversations([
      storedValue({
        turns: [
          { q: "F", steps: [], answer: "The scan counts the", cites: [], running: true, note: "x" },
        ],
      }),
    ]);
    expect(g.turns[0].answer).toBe("The scan counts the");
  });

  it("does not forget the interruption on the second reload either", () => {
    // The second time, `running` has long been false. If the note were
    // derived from `running` anew each time, the fact that this answer never
    // finished would be gone after a tab switch — and the half answer would
    // read as a whole one.
    const once = restoreConversations([
      storedValue({
        turns: [{ q: "F", steps: [], answer: "half", cites: [], running: true, note: "x" }],
      }),
    ]);
    const twice = restoreConversations(JSON.parse(JSON.stringify(forStorage(once))));
    expect(twice[0].turns[0].interrupted).toBe(true);
    expect(twice[0].turns[0].note).toBe(INTERRUPTED);
  });

  it("writes the runtime fields along instead of relying on leaving them out", () => {
    // Cutting happens on **reading** and only there. This assertion pins the
    // rule to its one place: a second place where the same rule held would be
    // the one where it is forgotten — and a record from a foreign version
    // would carry the fields anyway.
    const [g] = forStorage([{ ...newConversation(1), busy: true }]);
    expect(g.busy).toBe(true);
  });
});

describe("The continuation is measured, not claimed", () => {
  it("calls a restored conversation with a session unresolved", () => {
    const [g] = restoreConversations([storedValue({ agent: "s1" })]);
    expect(g.continuation).toBe("open");
  });

  it("says nothing about a conversation without a session — there never was one", () => {
    // A note on an unresolved continuation would speak here of a session
    // that never existed.
    const [g] = restoreConversations([storedValue({ agent: null })]);
    expect(g.continuation).toBe("fresh");
  });

  it("stays silent when the host reports the same session back", () => {
    expect(afterRun("s1", "s1")).toBe("fresh");
  });

  it("reports it when the host returns a different session", () => {
    expect(afterRun("s1", "s2")).toBe("restarted");
  });

  it("leaves the question open when the host names no session at all", () => {
    // Nothing measured does not mean answered. The open question does not
    // become an answer just because a run is over.
    expect(afterRun("s1", "")).toBe("open");
  });

  it("has nothing to report where there was nothing to continue", () => {
    expect(afterRun(null, "s9")).toBe("fresh");
  });

  it("does not believe a remembered fresh — after the restart nobody has been asked again", () => {
    const [g] = restoreConversations([storedValue({ agent: "s1", continuation: "fresh" })]);
    expect(g.continuation).toBe("open");
  });

  it("does not believe a remembered restarted either", () => {
    // It was a measurement about the previous call. Now it holds again: not
    // asked.
    const [g] = restoreConversations([storedValue({ agent: "s1", continuation: "restarted" })]);
    expect(g.continuation).toBe("open");
  });

  it("speaks in both sentences about asking and not about the host", () => {
    // "the host lost the session" would be a statement about a foreign
    // machine this surface only sees into through an answer. The open case
    // says that it was **not asked**.
    expect(CONTINUATION_OPEN).toMatch(/not asked/);
    expect(CONTINUATION_RESTARTED).toMatch(/started anew/);
  });
});

describe("A record from a foreign version", () => {
  it("gives out nothing at all for anything that is not a list", () => {
    for (const x of [null, undefined, 7, "conversations", {}]) {
      expect(restoreConversations(x)).toEqual([]);
    }
  });

  it("throws away a round without a question instead of inventing it", () => {
    const [g] = restoreConversations([
      storedValue({ turns: [{ answer: "without a question" }, null, 7] }),
    ]);
    expect(g.turns).toEqual([]);
  });

  it("fills in missing lists instead of letting the surface crash", () => {
    // A round without `steps` would turn `t.steps.length` into a crash, and
    // that would take the whole interface with it — not only the conversation.
    const [g] = restoreConversations([storedValue({ turns: [{ q: "F" }] })]);
    expect(g.turns[0].steps).toEqual([]);
    expect(g.turns[0].cites).toEqual([]);
    expect(g.turns[0].answer).toBe("");
    expect(typeof g.turns[0].note).toBe("string");
  });

  it("throws away a citation without an id — a button without a target is worse than none", () => {
    const [g] = restoreConversations([
      storedValue({
        turns: [
          { q: "F", steps: [], cites: [{ label: "scan" }, { fid: "a/b/c" }], answer: "", note: "" },
        ],
      }),
    ]);
    expect(g.turns[0].cites).toEqual([{ fid: "a/b/c", label: "a/b/c" }]);
  });

  it("throws away a step without a target", () => {
    const [g] = restoreConversations([
      storedValue({
        turns: [{ q: "F", steps: [{ kind: "Read" }, { target: "a.go" }], cites: [], note: "" }],
      }),
    ]);
    expect(g.turns[0].steps).toEqual([{ kind: "", target: "a.go" }]);
  });

  it("never hands out an id twice", () => {
    // Two conversations with the same id would be the same conversation for
    // `patchTurn`: the answer would land in both tabs.
    const gs = restoreConversations([
      storedValue({ id: 3 }),
      storedValue({ id: 3 }),
      storedValue({ id: "none" }),
    ]);
    expect(new Set(gs.map((g) => g.id)).size).toBe(3);
    expect(gs.every((g) => g.id >= 1)).toBe(true);
  });

  it("does not take a name that is none as a label", () => {
    const [g] = restoreConversations([storedValue({ name: 7 })]);
    expect(g.name).toBe("New conversation");
  });

  it("takes an empty session id as none", () => {
    // Passing `""` on to `--resume` would mean naming a session that does not
    // exist.
    const [g] = restoreConversations([storedValue({ agent: "" })]);
    expect(g.agent).toBeNull();
  });
});

describe("The cap", () => {
  const roundState = (q: string, over: Record<string, unknown> = {}) => ({
    q,
    steps: [],
    answer: "",
    cites: [],
    running: false,
    note: "",
    ...over,
  });

  it("keeps the newest conversations, not the oldest", () => {
    // Whoever reaches the cap has not looked at the oldest for the longest.
    const viele: Conversation[] = Array.from({ length: MAX_CONVERSATIONS + 3 }, (_, i) =>
      newConversation(i + 1),
    );
    const raus = forStorage(viele);
    expect(raus).toHaveLength(MAX_CONVERSATIONS);
    expect(raus[raus.length - 1].id).toBe(MAX_CONVERSATIONS + 3);
  });

  it("keeps the newest rounds of a conversation", () => {
    const g: Conversation = {
      ...newConversation(1),
      turns: Array.from({ length: MAX_TURNS + 2 }, (_, i) => roundState(`F${i}`)),
    };
    const [raus] = forStorage([g]);
    expect(raus.turns).toHaveLength(MAX_TURNS);
    expect(raus.turns[raus.turns.length - 1].q).toBe(`F${MAX_TURNS + 1}`);
  });

  it("shortens an oversized answer and says that it is shortened", () => {
    // Cut without a note, a sentence ending in the middle of a word would read
    // as what Atlas said.
    const g: Conversation = {
      ...newConversation(1),
      turns: [roundState("F", { answer: "x".repeat(MAX_ANSWER + 100) })],
    };
    const [raus] = forStorage([g]);
    expect(raus.turns[0].answer).toHaveLength(MAX_ANSWER);
    expect(raus.turns[0].truncated).toBe(true);
  });

  it("shortens the steps from the back and reports that too", () => {
    const g: Conversation = {
      ...newConversation(1),
      turns: [
        roundState("F", {
          steps: Array.from({ length: MAX_STEPS + 4 }, (_, i) => ({
            kind: "Read",
            target: `file-${i}.go`,
          })),
        }),
      ],
    };
    const [raus] = forStorage([g]);
    expect(raus.turns[0].steps).toHaveLength(MAX_STEPS);
    expect(raus.turns[0].steps[MAX_STEPS - 1].target).toBe(`file-${MAX_STEPS + 3}.go`);
    expect(raus.turns[0].truncated).toBe(true);
  });

  it("reports nothing where nothing was shortened", () => {
    const [raus] = forStorage([
      { ...newConversation(1), turns: [roundState("F", { answer: "short" })] },
    ]);
    expect(raus.turns[0].truncated).toBeUndefined();
  });

  it("does not forget an earlier shortening note on the next write", () => {
    // On the second write the answer is already short enough — the note would
    // otherwise be lost, and the cut answer would look whole.
    const once = forStorage([
      { ...newConversation(1), turns: [roundState("F", { answer: "x".repeat(MAX_ANSWER + 10) })] },
    ]);
    const twice = forStorage(once);
    expect(twice[0].turns[0].truncated).toBe(true);
  });
});

describe("The id keeps counting across the restart", () => {
  it("names the highest one handed out", () => {
    expect(highestId([newConversation(3), newConversation(7), newConversation(5)])).toBe(7);
  });

  it("names zero where none is handed out", () => {
    // The counter then starts at one, as on the surface's first call.
    expect(highestId([])).toBe(0);
  });
});
