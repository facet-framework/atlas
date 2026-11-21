/** Conversations, as browser storage may hold them — and what has to be left
 * of them after reading. */

/** A read or search step of the agent. */
export type ConversationStep = {
  kind: string;
  target: string;
  /** "from-to", only when the Read call itself carried offset and limit. */
  lines?: string;
};

/** A jump target, as `citesFor` derived it from the steps. */
export type ConversationCitation = { label: string; fid: string };

/** A turn: a question and what happened in response to it. */
export type ConversationTurn = {
  q: string;
  steps: ConversationStep[];
  answer: string;
  cites: ConversationCitation[];
  /** Whether a stream is running right now. Does **not** survive a restart —
   * see the head of this file. */

  running: boolean;
  note: string;
  /** The answer was still running when the tab went. */

  interrupted?: boolean;
  /** Something in this turn was shortened for storage — the answer, the steps
   * or both. */

  truncated?: boolean;
  /** The turn ended through the host's `done`. Failed, signed-out and aborted
   * turns never set it, so the read footer is not drawn for them. */

  finished?: boolean;
  /** Whether the host's lists backed "nothing written" at the moment this turn
   * finished. Stored with the turn: a restored conversation keeps what was true
   * then and is not re-judged by today's host. */

  nothingWritten?: boolean;
};

/** What is known about the continuation at the host — three states, because
 * there are three and not two. */

export type Continuation = "fresh" | "open" | "restarted";

/** A conversation — one tab above the question line. */
export type Conversation = {
  id: number;
  name: string;
  turns: ConversationTurn[];
  /** Whether a stream is running right now. Does **not** survive a restart. */
  busy: boolean;
  /** The id of the host session a follow-up would attach to. */
  agent: string | null;

  unread?: boolean;
  /** Pinned by the reader in the reader's session list. Kept through a reload, and
   * kept when the cap drops conversations: the unpinned go first. */

  pinned?: boolean;
  /** What is known about the continuation at the host. */

  continuation?: Continuation;
};

/** The name a conversation carries as long as nobody has asked anything. */

export const NEW_CONVERSATION = "New conversation";

/** What takes the place of the running stream. */

export const INTERRUPTED = "interrupted · not finished";

/** The limits beyond which storage matters more than completeness. */

export const MAX_CONVERSATIONS = 8;
/** How many turns per conversation are remembered — the most recent. */
export const MAX_TURNS = 16;
/** How many characters of an answer are remembered. */
export const MAX_ANSWER = 4000;
/** How many steps per turn are remembered — the most recent. */
export const MAX_STEPS = 30;

/** What the surface says about an open continuation. */

export const CONTINUATION_OPEN = "from storage · continuation not asked";

/** What the surface says when the host cannot resume the session. */

export const CONTINUATION_RESTARTED = "host could not resume the conversation · started anew";

/** An empty conversation with the given id. */
export function newConversation(id: number): Conversation {
  return { id, name: NEW_CONVERSATION, turns: [], busy: false, agent: null, continuation: "fresh" };
}

/** What a returned session key says about the continuation. */

export function afterRun(requested: string | null, reported: string): Continuation {
  if (!requested) return "fresh";
  if (!reported) return "open";
  return reported === requested ? "fresh" : "restarted";
}

/** The highest id assigned. */

export function highestId(conversations: readonly Conversation[]): number {
  return conversations.reduce((max, g) => (g.id > max ? g.id : max), 0);
}

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function asStep(v: unknown): ConversationStep | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.target !== "string") return null;
  const lines = typeof s.lines === "string" && s.lines ? { lines: s.lines } : {};
  return { kind: text(s.kind), target: s.target, ...lines };
}

function asCitation(v: unknown): ConversationCitation | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  // Without `fid` there is no jump target, and a button without a target is
  // worse than no button — the same rule by which `citesFor` discards
  // ambiguous hits.
  if (typeof c.fid !== "string" || !c.fid) return null;
  return { fid: c.fid, label: text(c.label, c.fid) };
}

function asTurn(v: unknown): ConversationTurn | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (typeof t.q !== "string") return null;
  // This is where the running stream is cut off. This one line is the
  // difference between a conversation found again and a surface that says
  // "Atlas is reading…" forever.
  const interrupted = t.running === true || t.interrupted === true;
  const steps = Array.isArray(t.steps)
    ? t.steps.map(asStep).filter((s): s is ConversationStep => s !== null)
    : [];
  const cites = Array.isArray(t.cites)
    ? t.cites.map(asCitation).filter((c): c is ConversationCitation => c !== null)
    : [];
  return {
    q: t.q,
    steps,
    answer: text(t.answer),
    cites,
    running: false,
    // The note says what really applies, and overwrites a stored "Atlas
    // is reading…" — the sentence describes the active stream rather than a conversation that is
    // it is read.
    note: interrupted ? INTERRUPTED : text(t.note),
    ...(interrupted ? { interrupted: true } : {}),
    ...(t.truncated === true ? { truncated: true } : {}),
    ...(t.finished === true && !interrupted ? { finished: true } : {}),
    ...(t.nothingWritten === true ? { nothingWritten: true } : {}),
  };
}

function asConversation(v: unknown, fallbackId: number): Conversation | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  const turns = Array.isArray(g.turns)
    ? g.turns.map(asTurn).filter((t): t is ConversationTurn => t !== null)
    : [];
  const agent = typeof g.agent === "string" && g.agent ? g.agent : null;
  return {
    id: typeof g.id === "number" && Number.isFinite(g.id) ? g.id : fallbackId,
    name: text(g.name, NEW_CONVERSATION),
    turns,
    // Like `running`: nothing runs any more.
    busy: false,
    agent,
    unread: g.unread === true,
    ...(g.pinned === true ? { pinned: true } : {}),
    // From storage — and thus a conversation about whose continuation nothing
    // was asked at the host.

    continuation: agent ? "open" : "fresh",
  };
}

/** Remembered conversations, validated and reset after a reload. */

export function restoreConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  const out: Conversation[] = [];
  const assigned = new Set<number>();
  for (const raw of value) {
    const g = asConversation(raw, 0);
    if (!g) continue;
    // Two conversations with the same id would be the same conversation to
    // `patchTurn`: the answer would land in both tabs.
    let id = g.id;
    while (id < 1 || assigned.has(id)) id = Math.max(id, 0) + 1;
    assigned.add(id);
    out.push({ ...g, id });
  }
  return out;
}

function turnForStorage(t: ConversationTurn): ConversationTurn {
  const answer = t.answer.length > MAX_ANSWER ? t.answer.slice(0, MAX_ANSWER) : t.answer;
  // The **most recent** steps: they are closest to the answer, and whoever
  // reads a turn found again is looking for the places it came from.
  const steps = t.steps.length > MAX_STEPS ? t.steps.slice(-MAX_STEPS) : t.steps;
  const truncated =
    t.truncated === true || answer.length !== t.answer.length || steps.length !== t.steps.length;
  return { ...t, answer, steps, ...(truncated ? { truncated: true } : {}) };
}

/** The conversations, as they go into storage. */

export function forStorage(conversations: readonly Conversation[]): Conversation[] {
  let drop = Math.max(0, conversations.length - MAX_CONVERSATIONS);
  const cappedValue = conversations
    .filter((g) => {
      if (drop > 0 && !g.pinned) {
        drop -= 1;
        return false;
      }
      return true;
    })
    .slice(-MAX_CONVERSATIONS);
  return cappedValue.map((g) => ({
    ...g,
    turns: (g.turns.length > MAX_TURNS ? g.turns.slice(-MAX_TURNS) : g.turns).map(turnForStorage),
  }));
}
