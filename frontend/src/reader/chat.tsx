/** Ask Atlas: companion conversations, drawn as a pill, dock or full screen. */

import { useCallback, useEffect, useRef, useState } from "react";
import { askAgent, type AgentState, type AgentStream } from "@/model";
import { useSurfaceText as useText, type FacetText } from "@/screens/text";
import { plugins } from "@/screens";
import type { DerivedModel } from "@/derive";
import type { Route } from "./route";
import { useT, type T } from "./text";
import { answerMarkdown, citesFor } from "@/ask/cites";
import { filesRead, sourcesRead, writeIsBlocked } from "@/ask/readFooter";
import { hostText, keepingSignInCodes, type SignInCodes } from "@/ask/hostText";
import { tx } from "@/i18n";
import type { RegisteredCommand } from "@/plugin/commands";
import { ASK_MODE_ID, withDefaults, type RegisteredMode } from "@/plugin/chat-modes";
import {
  forStorage,
  highestId,
  restoreConversations,
  afterRun,
  newConversation,
  NEW_CONVERSATION,
  type Conversation,
  type ConversationTurn,
} from "@/ask/conversations";
import { STORAGE_KEY } from "@/state";
import { readPreferences, usePreferences } from "./preferences";
import type { Screen } from "./screen";
import { safeCall } from "./plugin-guard";

export type ChatSize = "pill" | "dock" | "full";

/** Marks a turn whose stream has not said anything yet. It is a marker, not a
 * text: the words for it are chosen when the pill is drawn, so a running turn
 * follows a language change. */

const READING = "\u0000reading";
/** The turn the reader ended on purpose. A marker, not a text. */
const ABORTED = "aborted";

/** Store ------------------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Restore conversations and clear activity interrupted by a reload. */
export function readSessions(store: Pick<Storage, "getItem"> | null = storage()): Conversation[] {
  try {
    const raw = JSON.parse(store?.getItem(STORAGE_KEY) || "{}");
    const list = raw.conversations === undefined ? [] : restoreConversations(raw.conversations);
    return list.length ? list : [newConversation(1)];
  } catch {
    return [newConversation(1)];
  }
}

/** Remove the stored conversations from the reader's stored state, every other field
 * stays. `false` when the browser refuses or the state is not an object. */

export function forgetSessions(
  store: Pick<Storage, "getItem" | "setItem"> | null = storage(),
): boolean {
  if (!store) return false;
  try {
    const raw: unknown = JSON.parse(store.getItem(STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const { conversations: _gone, ...rest } = raw as Record<string, unknown>;
    void _gone;
    store.setItem(STORAGE_KEY, JSON.stringify(rest));
    return true;
  } catch {
    return false;
  }
}

/** Write the conversations into the reader's stored state, leaving every other field alone. */
export function writeSessions(
  sessions: Conversation[],
  store: Pick<Storage, "getItem" | "setItem"> | null = storage(),
): boolean {
  if (!store) return false;
  try {
    const raw = JSON.parse(store.getItem(STORAGE_KEY) || "{}") as Record<string, unknown>;
    store.setItem(STORAGE_KEY, JSON.stringify({ ...raw, conversations: forStorage(sessions) }));
    return true;
  } catch {
    return false;
  }
}

/** View model ------------------------------------------------------------------------- */

export function answerState(t: ConversationTurn): plugins.AnswerState {
  if (t.running) return "streaming";
  if (t.interrupted) return "cut";
  if (t.note === ABORTED) return "stopped";
  if (t.finished) return "done";
  return t.answer ? "done" : "failed";
}

/** What a finished answer read: the distinct files the agent opened, each
 * opened location with the line range the Read call carried, and "nothing
 * written" as it was true when the turn finished. Only a turn that ended
 * through done and opened a file has one; a search is not a file. */

export function readOf(t: ConversationTurn): plugins.ChatAnswerVM["read"] {
  if (t.finished !== true || answerState(t) !== "done") return undefined;
  const count = filesRead(t.steps);
  if (!count) return undefined;
  return {
    count,
    files: sourcesRead(t.steps).map((s) => s.label),
    nothingWritten: t.nothingWritten === true,
  };
}

export function turnVM(sessionId: number, t: ConversationTurn, i: number): plugins.ChatTurnVM {
  const state = answerState(t);
  return {
    id: `${sessionId}-${i}`,
    question: t.q,
    at: "",
    answer: {
      markdown: t.answer,
      state,
      steps: t.steps.map((s, k) => ({
        label: s.kind,
        detail: s.target,
        lines: s.lines,
        state: t.running && k === t.steps.length - 1 ? "running" : "done",
      })),
      sources: t.cites.map((c) => ({ kind: "record", ref: c.fid, title: c.label })),
      error: state === "failed" ? t.note : undefined,
      read: readOf(t),
    },
  };
}

export function continuationOf(s: Conversation): plugins.Continuation | undefined {
  if (s.continuation === "fresh") return s.turns.length > 1 ? "continued" : undefined;
  if (s.continuation === "open") return "open";
  if (s.continuation === "restarted") return "restarted";
  return undefined;
}

/** A session's name; the stored placeholder for an unnamed one is worded in the active language. */
export function sessionName(name: string, t: T): string {
  return name === NEW_CONVERSATION ? t("ui.reader.chat-new-conversation") : name;
}

export function sessionVM(s: Conversation, t: T): plugins.ChatSessionVM {
  // A conversation stores no time, and its continuation is unknown until the host was asked:
  // both stay absent, and the session line leaves them out instead of guessing.
  return {
    id: String(s.id),
    title: sessionName(s.name, t),
    rounds: s.turns.length,
    mode: "Ask",
    pinned: s.pinned === true,
    continuation: continuationOf(s),
    running: s.busy,
    unread: s.unread === true,
  };
}

/** A model's name in the reader's language. The empty id is the host's default,
 * whose label the host sends in English; the other labels are product names. */

export function modelName(m: AgentState["models"][number]): string {
  return m.id === "" ? tx("ui.reader.chat-default") : m.label;
}

/** The chosen model by its name; the empty id is the host's default. `id` is
 * the reader's choice; without one, the host's configured model counts. */

export function modelLabel(agent: AgentState | null, id: string | null = null): string {
  if (!agent) return "—";
  const wanted = id ?? agent.model;
  const chosen = agent.models.find((m) => m.id === wanted);
  return chosen ? modelName(chosen) : wanted || "—";
}

/** Why the companion is unavailable, in the reader's language when the host
 * sent a code this reader knows, otherwise in the host's own words. The code
 * is not part of the library's `AgentState`, so it is read off the raw answer. */

export function hostErrorOf(agent: AgentState | null): string | null {
  if (!agent || agent.auth.available || !agent.auth.reason) return null;
  const raw = agent.auth as { reasonCode?: unknown; hintCode?: unknown };
  const reason = hostText(
    typeof raw.reasonCode === "string" ? raw.reasonCode : undefined,
    agent.auth.reason,
  );
  if (!agent.auth.hint) return reason;
  const hint = hostText(
    typeof raw.hintCode === "string" ? raw.hintCode : undefined,
    agent.auth.hint,
  );
  return `${reason} ${hint}`;
}

/** Logic ------------------------------------------------------------------------------ */

/** The library hands `onRead` only the target and the tool. The host also
 * sends `lines`, the Read call's own range; it is read off the same event just
 * before the library's listener runs, which calls `onRead` synchronously. */

export function keepingReadLines(base: AgentStream): {
  stream: AgentStream;
  lines: () => string;
} {
  let pending = "";
  return {
    lines: () => pending,
    stream: {
      addEventListener(type, listener) {
        if (type !== "read") return base.addEventListener(type, listener);
        base.addEventListener(type, (event) => {
          try {
            const lines = (JSON.parse(event.data) as { lines?: unknown }).lines;
            pending = typeof lines === "string" ? lines : "";
          } catch {
            pending = "";
          }
          listener(event);
          pending = "";
        });
      },
      close: () => base.close(),
    },
  };
}

/** Whether the host's tool lists back "nothing written". The lists are newer
 * than the library's `AgentState` and are read off the raw reply. */

export function nothingWrittenBy(agent: AgentState | null): boolean {
  const raw = agent as { blockedTools?: unknown; allowedTools?: unknown } | null;
  return writeIsBlocked(raw?.blockedTools, raw?.allowedTools);
}

/** The conversation mode: "ask", the core's plain question, or the id of a
 * mode a plugin contributed (`atlas.chat.mode`). */

export type ChatMode = string;

/** The core's own mode, always first in the picker; a plugin may not take its id. */

export const ASK_MODE = ASK_MODE_ID;

export type ChatOptions = {
  derived: DerivedModel;
  agent: AgentState | null;
  /** Tests pass a fake stream; the reader uses `EventSource`. */
  open?: (url: string) => AgentStream;
  /** What the reader has open, as the host's `kind:value` entries — exactly
   * the chips the composer shows. Sent with every question; empty sends none. */

  context?: readonly string[];
  /** What the page shows when a question is sent; null or empty sends none.
   * Read at send time, so it is the page as the reader sees it then. */

  screen?: () => Screen | null;
  /** Hands the screen to the host and returns the id the question carries; null without. */
  postScreen?: (shot: Screen) => Promise<string | null>;
  /** The modes plugins contributed. A chosen one folds its guidance into the
   * question sent to the agent; the reader's own words stay as they were typed. */

  modes?: readonly RegisteredMode[];
};

/** The conversations and the running answers. An answer that finishes in a
 * conversation the reader is not looking at — another one, or any while the
 * chat is the pill — marks it unread until it is on screen; the mark is
 * stored with the conversation and survives a reload. A write the browser
 * refuses is reported, not hidden. */

// @facet: assistance/conversations/conversation-persistence
// @facet-role: primary
// @facet: assistance/conversations/unread-answer-glow
// @facet-role: primary
export function useChat({
  derived,
  agent,
  open,
  context = [],
  screen,
  postScreen,
  modes = [],
}: ChatOptions) {
  // With "keep chat sessions" off, a page starts with a fresh conversation and stores none.
  const [sessions, setSessionsState] = useState<Conversation[]>(() =>
    readPreferences().keepChat ? readSessions() : [newConversation(1)],
  );
  const [currentId, setCurrentId] = useState<number>(() => sessions[sessions.length - 1].id);
  const [size, setSize] = useState<ChatSize>("pill");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ChatMode>(ASK_MODE);
  // A mode whose plugin is unavailable is the plain question again.
  const pluginMode = modes.find((m) => m.id === mode) ?? null;
  // The reader's model; null leaves the host's configured one in charge.
  const [model, setModel] = useState<string | null>(null);
  const contextKey = context.join("\n");
  const stops = useRef(new Map<number, () => void>());
  // Whether the last write held the conversations. A refused one drops them
  // from storage, so a reload does not bring back an older set as if current.
  const stored = useRef(true);
  const [storeFailed, setStoreFailed] = useState(false);

  const setSessions = useCallback((fn: (prev: Conversation[]) => Conversation[]) => {
    setSessionsState((prev) => {
      const next = fn(prev);
      if (readPreferences().keepChat) {
        stored.current = writeSessions(next);
        if (!stored.current) forgetSessions();
      } else stored.current = true;
      return next;
    });
  }, []);

  useEffect(() => {
    setStoreFailed(!stored.current);
  }, [sessions]);

  // The conversation on screen: none while the chat is the pill. An answer
  // finishing anywhere else is unread until the reader looks at it.
  const seenId = size === "pill" ? null : currentId;
  const seen = useRef<number | null>(seenId);
  useEffect(() => {
    seen.current = seenId;
  }, [seenId]);
  const seenUnread = sessions.some((s) => s.id === seenId && s.unread === true);
  useEffect(() => {
    if (!seenUnread || seenId === null) return;
    setSessions((prev) => prev.map((s) => (s.id === seenId ? { ...s, unread: false } : s)));
  }, [seenUnread, seenId, setSessions]);

  useEffect(() => {
    const running = stops.current;
    return () => {
      for (const close of running.values()) close();
      running.clear();
    };
  }, []);

  const patchLast = useCallback(
    (id: number, fn: (t: ConversationTurn) => ConversationTurn) =>
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id && s.turns.length
            ? { ...s, turns: [...s.turns.slice(0, -1), fn(s.turns[s.turns.length - 1])] }
            : s,
        ),
      ),
    [setSessions],
  );

  const stop = useCallback(
    (id: number = currentId) => {
      const close = stops.current.get(id);
      if (!close) return;
      close();
      stops.current.delete(id);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, busy: false } : s)));
      patchLast(id, (t) => (t.running ? { ...t, running: false, note: ABORTED } : t));
    },
    [currentId, patchLast, setSessions],
  );

  const ask = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      const session = sessions.find((s) => s.id === currentId) ?? sessions[0];
      const id = session.id;
      stop(id);
      setSize((s) => (s === "pill" ? "dock" : s));
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                name: s.turns.length ? s.name : q.length > 30 ? `${q.slice(0, 30)}…` : q,
                busy: true,
                turns: [
                  ...s.turns,
                  { q, steps: [], answer: "", cites: [], running: true, note: READING },
                ],
              }
            : s,
        ),
      );
      setDraft("");
      // The sign-in step's codes are read off the event the library is about
      // to handle, as defined in hostText.ts.
      let signInCodes: () => SignInCodes = () => ({});
      let readLines: () => string = () => "";
      const openCoded = (url: string): AgentStream => {
        const kept = keepingSignInCodes(open ? open(url) : new EventSource(url));
        signInCodes = kept.codes;
        const read = keepingReadLines(kept.stream);
        readLines = read.lines;
        return read.stream;
      };
      const askQuestion = (screenId: string | null) => {
        const withScreen = (url: string) =>
          screenId ? `${url}&screen=${encodeURIComponent(screenId)}` : url;
        return askAgent(
          withDefaults(q, pluginMode),
          {
            onStatus: (text) => patchLast(id, (t) => ({ ...t, note: text || READING })),
            onRead: (target, tool) => {
              const lines = readLines();
              patchLast(id, (t) => ({
                ...t,
                steps: [...t.steps, { kind: tool, target, ...(lines ? { lines } : {}) }],
              }));
            },
            onText: (text) => patchLast(id, (t) => ({ ...t, answer: t.answer + text })),
            onSignIn: (reason, hint) => {
              stops.current.delete(id);
              setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, busy: false } : s)));
              // A coded host sentence in the reader's language; without a code
              // the host's own words.
              const codes = signInCodes();
              const said = hostText(codes.textCode, reason);
              const note = hostText(codes.hintCode, hint);
              patchLast(id, (t) => ({
                ...t,
                running: false,
                note: note || said,
                answer: t.answer || said,
              }));
            },
            onError: (error) => {
              stops.current.delete(id);
              setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, busy: false } : s)));
              patchLast(id, (t) => ({ ...t, running: false, note: error.message }));
            },
            onDone: (agentSession) => {
              stops.current.delete(id);
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === id
                    ? {
                        ...s,
                        busy: false,
                        agent: agentSession || s.agent,
                        continuation: afterRun(session.agent, agentSession),
                        unread: seen.current !== id,
                      }
                    : s,
                ),
              );
              patchLast(id, (t) => ({
                ...t,
                running: false,
                finished: true,
                cites: citesFor(derived, t.steps),
                nothingWritten: nothingWrittenBy(agent),
                note: "",
              }));
            },
          },
          {
            open: (url) => openCoded(withScreen(url)),
            session: session.agent,
            model: (model ?? agent?.model) || null,
            context: contextKey ? contextKey.split("\n") : [],
            mode: null,
          },
        );
      };
      // The page's content goes first, as its own POST; the stream then names
      // it by id. A failed post still asks, without it. Stopping before the
      // post returns means the stream is never opened.
      let stopped = false;
      let closeStream = () => {};
      const start = (screenId: string | null) => {
        if (stopped) return;
        closeStream = askQuestion(screenId);
      };
      stops.current.set(id, () => {
        stopped = true;
        closeStream();
      });
      const shot = postScreen ? (screen?.() ?? null) : null;
      if (shot?.markdown && postScreen) {
        void postScreen(shot).then(start, () => start(null));
      } else {
        start(null);
      }
    },
    [
      agent,
      contextKey,
      currentId,
      pluginMode,
      model,
      open,
      patchLast,
      postScreen,
      screen,
      sessions,
      setSessions,
      stop,
      derived,
    ],
  );

  const newSession = useCallback(() => {
    const id = highestId(sessions) + 1;
    setSessions((prev) => [...prev, newConversation(id)]);
    setCurrentId(id);
  }, [sessions, setSessions]);

  const remove = useCallback(
    (id: number) => {
      stop(id);
      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== id);
        const next = rest.length ? rest : [newConversation(highestId(prev) + 1)];
        if (id === currentId) setCurrentId(next[next.length - 1].id);
        return next;
      });
    },
    [currentId, setSessions, stop],
  );

  const rename = useCallback(
    (id: number, name: string) =>
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name: name.trim() || NEW_CONVERSATION } : s)),
      ),
    [setSessions],
  );

  const togglePin = useCallback(
    (id: number) =>
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned: s.pinned ? undefined : true } : s)),
      ),
    [setSessions],
  );

  const current = sessions.find((s) => s.id === currentId) ?? sessions[0];
  return {
    sessions,
    current,
    /** The browser refused the last write of the conversations. */
    storeFailed,
    size,
    setSize,
    draft,
    setDraft,
    mode,
    setMode,
    model,
    setModel,
    togglePin,
    ask,
    stop,
    newSession,
    remove,
    rename,
    pick: (id: number) => setCurrentId(id),
  };
}

export type Chat = ReturnType<typeof useChat>;

/** Place ------------------------------------------------------------------------------ */

/** A chip in the composer: `key` is the entry the host receives, `label` what the reader reads. */
export type ChatContextChip = {
  key: string;
  label: string;
  icon: plugins.ComposerProps["context"][number]["icon"];
};

/** The page types that offer starters of their own; everything else offers the general ones. */
export type StarterSet =
  | "general"
  | "overview"
  | "product"
  | "domain"
  | "capability"
  | "records"
  | "record"
  | "contents"
  | "promises"
  | "calibration"
  | "drift"
  | "tests"
  | "glossary";

/** The content kinds by their address, with the host's page key and the hub's name for them. */
const CONTENT_KINDS: Record<string, { page: string; label: string }> = {
  promises: { page: "promises", label: "ui.reader.chat-promises" },
  knowledge: { page: "knowledge", label: "ui.reader.chat-knowledge" },
  operations: { page: "operations", label: "ui.reader.chat-operations" },
  provenance: { page: "provenance", label: "ui.reader.chat-origin" },
  taxonomy: { page: "taxonomy", label: "ui.reader.chat-taxonomy" },
  calibration: { page: "calibration", label: "ui.reader.chat-calibration" },
  tests: { page: "tests", label: "ui.reader.chat-tests" },
  deviations: { page: "deviations", label: "ui.reader.chat-deviations" },
  drift: { page: "drift", label: "ui.reader.chat-drift" },
  fixed: { page: "fixed", label: "ui.reader.chat-fixed" },
  anchor: { page: "anchors", label: "ui.reader.chat-anchors" },
  files: { page: "files", label: "ui.reader.chat-files" },
  rules: { page: "rules", label: "ui.reader.chat-rules" },
};

const KIND_STARTERS: Record<string, StarterSet> = {
  promises: "promises",
  calibration: "calibration",
  drift: "drift",
  tests: "tests",
};

/** What the chat tells the agent the reader has open, and which starters fit
 * the page. The chip is the whole promise: what it shows is what is sent. */

export function chatPlaceOf(
  route: Route,
  tt: FacetText["t"],
): { context: ChatContextChip[]; starters: StarterSet } {
  const page = (key: string, label: string, icon: ChatContextChip["icon"]) => [
    { key: `page:${key}`, label, icon },
  ];
  switch (route.area) {
    case "overview":
      return {
        context: page("overview", tt("shell.nav.item.overview"), "home"),
        starters: "overview",
      };
    case "product":
      return {
        context: page("product", tt("shell.nav.item.product"), "buildings"),
        starters: "product",
      };
    case "records":
      return {
        context: page("records", tt("shell.nav.item.records"), "document"),
        starters: "records",
      };
    case "record":
      return {
        context: [{ key: `record:${route.id}`, label: route.id, icon: "document" }],
        starters: "record",
      };
    case "domain":
      return {
        context: [{ key: `domain:${route.domain}`, label: route.domain, icon: "buildings" }],
        starters: "domain",
      };
    case "capability": {
      const id = `${route.domain}/${route.capability}`;
      return {
        context: [{ key: `capability:${id}`, label: id, icon: "buildings" }],
        starters: "capability",
      };
    }
    case "contents": {
      const kind = route.kind ? CONTENT_KINDS[route.kind] : undefined;
      if (!kind)
        return {
          context: page("contents", tt("shell.nav.item.contents"), "contents"),
          starters: "contents",
        };
      return {
        context: page(`contents/${kind.page}`, tt(kind.label as never), "contents"),
        starters: KIND_STARTERS[route.kind ?? ""] ?? "contents",
      };
    }
    case "glossary":
      return {
        context: page("glossary", tt("shell.nav.item.glossary"), "book"),
        starters: "glossary",
      };
    case "settings":
      return {
        context: page("settings", tt("shell.top.settings"), "settings"),
        starters: "general",
      };
    case "plugin":
      return {
        context: page(`plugin/${route.plugin}`, route.plugin, "plug"),
        starters: "general",
      };
    default:
      return { context: [], starters: "general" };
  }
}

/** The questions offered in an empty conversation on a page type, in the active language. */
export function suggestionsFor(t: T, set: StarterSet = "general"): string[] {
  const here = t("ui.reader.chat-what-am-i-looking-here");
  const untested = t("ui.reader.chat-which-promises-does-no-test-carry");
  const drifted = t("ui.reader.chat-where-has-code-moved-away-its");
  const built = t("ui.reader.chat-how-product-built");
  switch (set) {
    case "overview":
      return [here, t("ui.reader.chat-what-needs-attention-first"), drifted];
    case "product":
      return [here, built, t("ui.reader.chat-which-domains-hold-most-records")];
    case "domain":
      return [
        t("ui.reader.chat-what-does-domain-do"),
        t("ui.reader.chat-which-capabilities-belong"),
        t("ui.reader.chat-where-domain-weakest"),
      ];
    case "capability":
      return [
        t("ui.reader.chat-what-does-capability-do"),
        t("ui.reader.chat-which-promises-does-no-test-name"),
        here,
      ];
    case "records":
      return [
        here,
        t("ui.reader.chat-which-records-have-no-anchor"),
        t("ui.reader.chat-which-records-planned-not-built"),
      ];
    case "record":
      return [
        t("ui.reader.chat-what-does-record-promise"),
        t("ui.reader.chat-where-implemented"),
        t("ui.reader.chat-which-its-promises-has-no-test"),
      ];
    case "contents":
      return [here, untested, drifted];
    case "promises":
      return [here, t("ui.reader.chat-what-promise"), untested];
    case "calibration":
      return [here, t("ui.reader.chat-what-band"), t("ui.reader.chat-what-outlier")];
    case "drift":
      return [
        here,
        t("ui.reader.chat-what-drift"),
        t("ui.reader.chat-which-drift-should-i-fix-first"),
      ];
    case "tests":
      return [here, untested, t("ui.reader.chat-what-must-test-name-cover-promise")];
    case "glossary":
      return [here, t("ui.reader.chat-how-glossary-kept")];
    default:
      return [untested, drifted, built];
  }
}

/** Surface ---------------------------------------------------------------------------- */

type SlashEntry = plugins.SlashCommand & { run: () => void };

/** The commands and modes plugins contributed, as the chat offers them. */
export type ChatPlugins = {
  commands: readonly RegisteredCommand[];
  modes: readonly RegisteredMode[];
};

/** A plugin's command in the slash list, beside the chat's own: picked from
 * the list it runs without an argument. */

function pluginCommand(c: RegisteredCommand): SlashEntry {
  return {
    cmd: c.command,
    label: c.purpose,
    hint: c.argument ?? "",
    run: () => safeCall(() => c.run(""), undefined),
  };
}

/** The plugin commands left once the chat's own have taken their names. */
export function pluginCommandsBeside(
  own: readonly SlashEntry[],
  commands: readonly RegisteredCommand[],
): RegisteredCommand[] {
  const taken = new Set(own.map((c) => c.cmd.toLowerCase()));
  return commands.filter((c) => !taken.has(c.command.toLowerCase()));
}

/** A typed `/command argument` a plugin answers to, or null. */
export function pluginCommandCall(
  draft: string,
  commands: readonly RegisteredCommand[],
): { command: RegisteredCommand; argument: string } | null {
  const m = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(draft.trim());
  if (!m) return null;
  const command = commands.find((c) => c.command.toLowerCase() === m[1].toLowerCase());
  return command ? { command, argument: m[2] ?? "" } : null;
}

/** The chat's own commands, by the word the reader types in the active language. */
function commandsFor(t: T, chat: Chat, openModels: () => void): SlashEntry[] {
  return [
    {
      cmd: t("ui.reader.chat-new"),
      label: t("ui.reader.chat-start-new-conversation"),
      hint: "",
      run: chat.newSession,
    },
    {
      cmd: t("ui.reader.chat-ask"),
      label: t("ui.reader.chat-ask-question"),
      hint: "",
      run: () => chat.setMode(ASK_MODE),
    },
    {
      cmd: t("ui.reader.chat-model"),
      label: t("ui.reader.chat-choose-model"),
      hint: "",
      run: openModels,
    },
  ];
}

/** What a copy action puts on the clipboard: the question as typed, the answer
 * as written, the answer as Markdown (question as a quote, the answer, the
 * jump targets as a list), or the jump targets alone. */

// @facet: assistance/conversations/conversation-copy
// @facet-role: primary
export function copyText(turn: ConversationTurn, what: plugins.CopyWhat): string {
  switch (what) {
    case "question":
      return turn.q;
    case "text":
      return turn.answer;
    case "markdown":
      return answerMarkdown(turn);
    case "sources":
      return turn.cites.map((c) => `- ${c.fid}`).join("\n");
  }
}

/** How long a copy's outcome stands on its button before the label returns. */
export const COPY_FEEDBACK_MS = 1400;

/** Writes to the clipboard and keeps the outcome — taken or refused — on the
 * button for a moment. A refusal is reported, never shown as "copied". */

function useCopy() {
  const [result, setResult] = useState<({ turn: string } & plugins.CopyResult) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = (next: { turn: string } & plugins.CopyResult) => {
    setResult(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), COPY_FEEDBACK_MS);
  };
  const run = (turn: string, what: plugins.CopyWhat, text: string) => {
    let pending: Promise<void> | undefined;
    try {
      pending = navigator.clipboard?.writeText(text);
    } catch {
      pending = undefined;
    }
    if (!pending) return show({ turn, what, failed: true });
    pending.then(
      () => show({ turn, what }),
      () => show({ turn, what, failed: true }),
    );
  };
  return { result, run };
}

/** A command word being typed: a slash at the start and nothing after the word yet. */
export function slashQueryOf(draft: string): string | null {
  return /^\/\S*$/.test(draft) ? draft.toLowerCase() : null;
}

/** The chat as pill, dock or full screen. The conversation box pins the
 * reader's question to the top while the answer grows, or follows the bottom
 * when the reader chose that in the settings. */

// @facet: assistance/conversations/chat
// @facet-role: primary
// @facet: assistance/conversations/chat-scrolling
// @facet-role: primary
// @facet: workspace/controls/dropdown
// @facet-role: primary
export function ChatSurface({
  chat,
  agent,
  mobile,
  roleName,
  context,
  starters = "general",
  onRemoveContext,
  onSource,
  plugins: contributed = { commands: [], modes: [] },
}: {
  /** What plugins added to the slash list and the mode picker. */
  plugins?: ChatPlugins;
  chat: Chat;
  agent: AgentState | null;
  mobile: boolean;
  roleName: string;
  context: ChatContextChip[];
  starters?: StarterSet;
  onRemoveContext?: (key: string) => void;
  onSource: (s: plugins.ChatSourceVM) => void;
}) {
  const { t } = useT();
  const { t: tt } = useText();
  const [trail, setTrail] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);
  // The text at which Esc closed the command list; typing on opens it again.
  const [slashClosedAt, setSlashClosedAt] = useState<string | null>(null);
  // On a phone the session list is a sheet; without this state it never opens.
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const { followAnswer } = usePreferences();
  const copy = useCopy();
  const { current } = chat;
  const running = current.busy;
  const othersUnread = chat.sessions.some((s) => s.id !== current.id && s.unread === true);

  // Esc closes the model menu, a session's menu and the session sheet; a click
  // outside closes the model menu. The menus give the focus back to their button
  // themselves (facet-ui useMenuKeyboard).

  const anyMenu = modelsOpen || menuFor !== null || sessionsOpen;
  useEffect(() => {
    if (!anyMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setModelsOpen(false);
      setMenuFor(null);
      setSessionsOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('[role="menu"], [aria-haspopup="menu"]')) setModelsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [anyMenu]);

  if (chat.size === "pill") {
    const last = current.turns[current.turns.length - 1];
    return (
      <plugins.ChatPill
        running={running}
        unread={chat.sessions.some((s) => s.unread === true)}
        label={running ? sessionName(current.name, t) : t("ui.reader.chat-ask-atlas")}
        step={
          running
            ? last?.note === READING
              ? t("ui.reader.chat-atlas-reading")
              : last?.note
            : undefined
        }
        mobile={mobile}
        onOpen={() => chat.setSize("dock")}
      />
    );
  }

  const own = commandsFor(t, chat, () => setModelsOpen(true));
  // A chat command keeps its name: a plugin command with the same one is left out.
  const pluginCommands = pluginCommandsBeside(own, contributed.commands);
  const commands = [...own, ...pluginCommands.map(pluginCommand)];
  const slashQuery = slashQueryOf(chat.draft);
  const slashItems =
    slashQuery !== null && slashClosedAt !== chat.draft
      ? commands.filter((c) => c.cmd.toLowerCase().startsWith(slashQuery))
      : [];
  const runCommand = (cmd: string) => {
    const entry = commands.find((c) => c.cmd === cmd);
    chat.setDraft("");
    setSlashActive(0);
    entry?.run();
  };

  const signedIn = agent ? agent.auth.loggedIn : undefined;
  const hostError = hostErrorOf(agent);
  const common = {
    title: sessionName(current.name, t),
    continuation: continuationOf(current),
    turns: current.turns.map((t, i) => turnVM(current.id, t, i)),
    composer: {
      value: chat.draft,
      mode: contributed.modes.some((m) => m.id === chat.mode) ? chat.mode : ASK_MODE,
      modes: [
        { key: ASK_MODE, label: tt("ui.reader.chat-ask-name"), icon: "chat" as const },
        ...contributed.modes.map((m) => ({ key: m.id, label: m.label, icon: "edit" as const })),
      ],
      model: modelLabel(agent, chat.model),
      models: agent?.models.map(modelName),
      modelsOpen,
      context,
      running,
      compact: mobile,
      enterSends: !mobile,
      slash: slashItems.length
        ? { items: slashItems, active: Math.min(slashActive, slashItems.length - 1) }
        : null,
      onChange: (value: string) => {
        if (slashQueryOf(value) !== slashQuery) setSlashActive(0);
        chat.setDraft(value);
      },
      onSend: () => {
        // A typed plugin command with its argument runs instead of being asked.
        const call = pluginCommandCall(chat.draft, pluginCommands);
        if (!call) return chat.ask(chat.draft);
        chat.setDraft("");
        safeCall(() => call.command.run(call.argument), undefined);
      },
      onStop: () => chat.stop(),
      onMode: (m: string) => chat.setMode(m),
      onModel: () => setModelsOpen((o) => !o),
      onPickModel: (i: number) => {
        const picked = agent?.models[i];
        if (picked) chat.setModel(picked.id);
        setModelsOpen(false);
      },
      onRemoveContext,
      onSlash: runCommand,
      onSlashActive: setSlashActive,
      onSlashClose: () => setSlashClosedAt(chat.draft),
    },
    suggestions: suggestionsFor(t, starters),
    roleName,
    signedIn,
    hostError,
    mobile,
    trailOpen: trail,
    copied: copy.result,
    follow: followAnswer,
    notice: chat.storeFailed
      ? t("ui.reader.chat-conversations-not-stored-browser-storage-refused")
      : null,
    onClose: () => chat.setSize("pill"),
    onNew: () => {
      setSessionsOpen(false);
      chat.newSession();
    },
    onSuggestion: (q: string) => chat.ask(q),
    onToggleTrail: (id: string) => setTrail((t) => ({ ...t, [id]: !t[id] })),
    onCopy: (id: string, what: plugins.CopyWhat) => {
      const turn = current.turns[Number(id.split("-")[1])];
      if (turn) copy.run(id, what, copyText(turn, what));
    },
    onRetry: (id: string) => {
      const t = current.turns[Number(id.split("-")[1])];
      if (t) chat.ask(t.q);
    },
    onContinue: (id: string) => {
      const t = current.turns[Number(id.split("-")[1])];
      if (t) chat.ask(t.q);
    },
    onSource,
  };

  if (chat.size === "dock")
    return (
      <plugins.ChatDock
        {...common}
        othersUnread={othersUnread}
        onExpand={() => chat.setSize("full")}
      />
    );

  const q = query.trim().toLowerCase();
  return (
    <plugins.ChatFull
      {...common}
      sessions={chat.sessions
        .filter((s) => !q || sessionName(s.name, t).toLowerCase().includes(q))
        .map((x) => sessionVM(x, t))
        .reverse()}
      currentId={String(current.id)}
      query={query}
      renaming={renaming}
      menuFor={menuFor}
      onQuery={setQuery}
      sessionsOpen={sessionsOpen}
      onSessions={() => setSessionsOpen((o) => !o)}
      onPick={(id) => {
        setSessionsOpen(false);
        chat.pick(Number(id));
      }}
      onMenu={setMenuFor}
      onPin={(id) => {
        setMenuFor(null);
        chat.togglePin(Number(id));
      }}
      onRename={(id) => {
        setMenuFor(null);
        setRenaming({
          id,
          value: sessionName(chat.sessions.find((s) => String(s.id) === id)?.name ?? "", t),
        });
      }}
      onRenameValue={(value) => setRenaming((r) => (r ? { ...r, value } : r))}
      onRenameSave={() => {
        if (renaming) chat.rename(Number(renaming.id), renaming.value);
        setRenaming(null);
      }}
      onRenameCancel={() => setRenaming(null)}
      onDelete={(id) => {
        setMenuFor(null);
        chat.remove(Number(id));
      }}
      onShrink={() => chat.setSize("dock")}
    />
  );
}
