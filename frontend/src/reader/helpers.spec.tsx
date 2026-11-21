import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { derive } from "@/derive";
import { newConversation, type Conversation } from "@/ask/conversations";
import { STORAGE_KEY } from "@/state";
import {
  answerState,
  continuationOf,
  modelLabel,
  readSessions,
  sessionVM,
  turnVM,
  useChat,
  writeSessions,
} from "./chat";
import { makeSlot } from "./context";
import { domainViews } from "./derive-reader";
import { NO_HOST, useHostInfo, type HostInfo } from "./host";
import { commandsFor, Palette, paletteGroups, resolvePick } from "./palette";
import { atlasT, uiT } from "./testing";
import { targetPath } from "./pages/frame";
import { adrCounts, adrItem } from "../../../plugins/adr/src/entry";
import {
  aiSettings,
  gitProviderSettings,
  isSection,
  pluginRows,
  searchSections,
  storageItems,
} from "./pages/settings";

const model = taskflowModel();
const domains = domainViews(model);

const agent: AgentState = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [
    { id: "", label: "Default" },
    { id: "haiku", label: "Haiku" },
  ],
  model: "",
};

describe("relative page targets", () => {
  const store: Record<string, object> = {};
  const slot = makeSlot(store, (fn) => Object.assign(store, fn(store)));

  it("leads Overview and overview targets to their places", () => {
    expect(targetPath("product", { slot })).toBe("/product");
    expect(targetPath("domain/tasks", { slot })).toBe("/domain/tasks");
    expect(targetPath("domain/tasks/create", { slot })).toBe("/domain/tasks/create");
    expect(targetPath("drift", { slot })).toBe("/contents/drift");
    expect(targetPath("adr/0001-x.md", { slot })).toBe("/p/adr/0001-x.md");
    expect(targetPath("glossary", { slot })).toBe("/glossary");
    expect(targetPath("ask", { slot })).toBe("/ask");
    expect(targetPath("irgendwas", { slot })).toBe("/irgendwas");
  });

  it("carries a records filter through the container's slot", () => {
    expect(targetPath("records?lifecycle=planned", { slot })).toBe("/records");
    expect((store.records as { filters: object }).filters).toEqual({ lifecycle: "planned" });
  });
});

describe("chat view model", () => {
  const turn = {
    q: "Q",
    steps: [{ kind: "Read", target: "a.go" }],
    answer: "A",
    cites: [{ label: "x", fid: "a/b/x" }],
    running: false,
    note: "",
  };

  it("reads each answer state from the stored turn", () => {
    expect(answerState({ ...turn, running: true })).toBe("streaming");
    expect(answerState({ ...turn, interrupted: true })).toBe("cut");
    expect(answerState({ ...turn, note: "aborted" })).toBe("stopped");
    expect(answerState({ ...turn, finished: true })).toBe("done");
    expect(answerState({ ...turn, answer: "" })).toBe("failed");
  });

  it("maps steps and sources", () => {
    const vm = turnVM(3, { ...turn, running: true }, 0);
    expect(vm.id).toBe("3-0");
    expect(vm.answer!.steps[0]).toMatchObject({ label: "Read", detail: "a.go", state: "running" });
    expect(vm.answer!.sources[0]).toEqual({ kind: "record", ref: "a/b/x", title: "x" });
  });

  it("names the continuation only when it was measured", () => {
    const s: Conversation = { ...newConversation(1), turns: [turn], agent: "x" };
    expect(continuationOf(s)).toBeUndefined();
    expect(continuationOf({ ...s, continuation: "open" })).toBe("open");
    expect(continuationOf({ ...s, continuation: "restarted" })).toBe("restarted");
    expect(continuationOf({ ...s, continuation: "fresh" })).toBeUndefined();
    expect(continuationOf({ ...s, continuation: "fresh", turns: [turn, turn] })).toBe("continued");
    expect(continuationOf(newConversation(2))).toBeUndefined();
    expect(sessionVM(s, atlasT("en"))).toMatchObject({
      id: "1",
      rounds: 1,
      continuation: undefined,
    });
  });

  it("labels the host's default model", () => {
    // The host sends "Default"; the reader names it in its own language (German here).
    expect(modelLabel(agent)).toBe("Default");
    expect(modelLabel({ ...agent, model: "haiku" })).toBe("Haiku");
    expect(modelLabel(null)).toBe("—");
  });
});

describe("conversation store", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps the stored reader state and leaves its other fields alone", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: "eng" }));
    const sessions = [{ ...newConversation(4), name: "Hallo" }];
    expect(writeSessions(sessions)).toBe(true);
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(raw.role).toBe("eng");
    expect(readSessions()[0]).toMatchObject({ id: 4, name: "Hallo" });
  });

  it("starts with one empty conversation when nothing is stored", () => {
    expect(readSessions()).toEqual([newConversation(1)]);
    expect(readSessions({ getItem: () => "{not json" })).toEqual([newConversation(1)]);
    expect(writeSessions([], null)).toBe(false);
  });

  it("starts, renames, stops and removes conversations", () => {
    const closed: string[] = [];
    const open = (url: string) => ({
      addEventListener: () => undefined,
      close: () => closed.push(url),
    });
    const derived = derive(model);
    const { result } = renderHook(() => useChat({ derived, agent, open }));
    act(() => result.current.ask("First question"));
    expect(result.current.current.busy).toBe(true);
    expect(result.current.size).toBe("dock");
    act(() => result.current.stop());
    expect(result.current.current.busy).toBe(false);
    expect(result.current.current.turns[0].note).toBe("aborted");
    act(() => result.current.rename(result.current.current.id, "New"));
    expect(result.current.current.name).toBe("New");
    act(() => result.current.newSession());
    expect(result.current.sessions).toHaveLength(2);
    act(() => result.current.remove(result.current.current.id));
    expect(result.current.sessions).toHaveLength(1);
    act(() => result.current.remove(result.current.current.id));
    expect(result.current.sessions).toHaveLength(1);
    expect(closed.length).toBeGreaterThan(0);
  });
});

describe("palette", () => {
  it("finds records, areas, places, roles and commands", () => {
    const { groups } = paletteGroups("", model, domains, [], atlasT("en"), uiT("en"));
    expect(groups.map((g) => g.key)).toEqual(["records", "areas", "places", "roles", "commands"]);
    expect(groups[0].total).toBe(model.features.length + model.assumptions.length);
    const q = paletteGroups(
      "quick",
      model,
      domains,
      [{ path: "/", label: "Overview", kind: "overviewPage", at: 1 }],
      atlasT("en"),
      uiT("en"),
    );
    expect(q.groups[0].items[0].key).toBe("rec:tasks/create/quick-add");
  });

  it("narrows by prefix", () => {
    expect(
      paletteGroups("/", model, domains, [], atlasT("en"), uiT("en")).groups.map((g) => g.key),
    ).toEqual(["commands"]);
    expect(
      paletteGroups("#sync", model, domains, [], atlasT("en"), uiT("en")).groups.map((g) => g.key),
    ).toEqual(["records"]);
    expect(paletteGroups("?wer", model, domains, [], atlasT("en"), uiT("en")).groups).toEqual([]);
    expect(
      paletteGroups(
        "",
        model,
        domains,
        [{ path: "/", label: "Overview", kind: "overviewPage", at: 1 }],
        atlasT("en"),
        uiT("en"),
      ).groups.at(-1)!.key,
    ).toBe("recent");
  });

  it("resolves picks to places, roles and commands", () => {
    expect(resolvePick("rec:a/b/c")).toEqual({ go: "/record/a/b/c" });
    expect(resolvePick("dom:tasks")).toEqual({ go: "/domain/tasks" });
    expect(resolvePick("cap:tasks/create")).toEqual({ go: "/domain/tasks/create" });
    expect(resolvePick("go:/records")).toEqual({ go: "/records" });
    expect(resolvePick("role:leadership")).toEqual({ role: "leadership" });
    expect(resolvePick(`cmd:${commandsFor(atlasT("en"))[0].key}`)).toEqual({ command: "theme" });
    expect(resolvePick("x:y")).toBeNull();
  });

  it("moves with the arrow keys and asks with a question mark", async () => {
    const onPick = jest.fn();
    const onAsk = jest.fn();
    render(
      <Palette
        open
        model={model}
        domains={domains}
        recent={[]}
        mobile={false}
        onPick={onPick}
        onAsk={onAsk}
        onShowAll={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(onPick).toHaveBeenCalledWith(expect.stringMatching(/^rec:/));
    const input = screen.getByRole("combobox");
    act(() => {
      (input as HTMLInputElement).focus();
    });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "?What is missing" } });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
    expect(onAsk).toHaveBeenCalledWith("What is missing");
  });
});

describe("settings helpers", () => {
  it("knows its sections and searches them", () => {
    expect(isSection("ai")).toBe(true);
    expect(isSection("nope")).toBe(false);
    expect(isSection(undefined)).toBe(false);
    expect(searchSections("", uiT("en"))).toBeNull();
    expect(searchSections("provider", uiT("en"))).toEqual(["git-provider"]);
    expect(searchSections("zzz", uiT("en"))).toEqual([]);
  });

  it("measures this reader's keys in browser storage", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "facet.atlas.history",
      JSON.stringify({ places: [1, 2, 3], cursor: 2 }),
    );
    window.localStorage.setItem("other", "x");
    window.localStorage.setItem("facet.atlas.state", "plain");
    const items = storageItems(window.localStorage);
    expect(items.map((i) => i.key).sort()).toEqual(["facet.atlas.history", "facet.atlas.state"]);
    expect(items.find((i) => i.key === "facet.atlas.history")!.entries).toBe(3);
    expect(storageItems(null)).toEqual([]);
  });

  it("names a known key by what it holds and counts it", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "facet.atlas.history",
      JSON.stringify({ places: [1, 2, 3], cursor: 2 }),
    );
    window.localStorage.setItem(
      "facet.atlas.theme",
      JSON.stringify({ theme: "facet", mode: "light" }),
    );
    window.localStorage.setItem("facet.unknown", "x");
    const items = storageItems(window.localStorage, atlasT("en"));
    const byKey = (k: string) => items.find((i) => i.key === k)!;
    expect(byKey("facet.atlas.history")).toMatchObject({
      label: "History of places",
      contents: "3 places",
    });
    expect(byKey("facet.atlas.theme")).toMatchObject({
      label: "Palette and mode",
      contents: "facet · light",
    });
    // An unknown key keeps its own name and no invented contents.
    expect(byKey("facet.unknown").label).toBe("facet.unknown");
    expect(byKey("facet.unknown").contents).toBeUndefined();
  });

  it("shows the companion and the repository as the host reports them", () => {
    const host: HostInfo = {
      ...NO_HOST,
      agent: { ...agent, allowedTools: ["Read"], blockedTools: ["Bash"] } as AgentState,
      agentCheckedAt: "2026-11-13T10:11:00Z",
      repo: {
        repository: true,
        dirty: false,

        branch: "main",
        remote: "git@github.com:x/y",
        forge: "github",
      },
    };
    expect(aiSettings(host, "read")).toMatchObject({
      state: "ready",
      account: "a@b.c",
      model: "Default",
      tools: [
        { name: "Read", allowed: true },
        { name: "Bash", allowed: false },
      ],
      lastCheck: "10:11",
    });
    // The host names the tools its build fixes; anything else is changeable.
    const fixedHost: HostInfo = {
      ...host,
      agent: {
        ...agent,
        allowedTools: ["Read", "mcp__facet__notes_find"],
        blockedTools: ["Bash"],
        fixedTools: ["Read", "Bash"],
      } as AgentState,
    };
    expect(aiSettings(fixedHost, "read").tools).toEqual([
      { name: "Read", allowed: true, fixed: true },
      { name: "mcp__facet__notes_find", allowed: true, fixed: false },
      { name: "Bash", allowed: false, fixed: true },
    ]);
    // An older host that does not say leaves it unmeasured, not "changeable".
    expect(aiSettings(host, "read").tools.every((t) => t.fixed === undefined)).toBe(true);
    expect(aiSettings(NO_HOST, "read")).toMatchObject({
      state: "signed-out",
      lastCheck: "—",
    });
    expect(gitProviderSettings(host)).toMatchObject({
      state: "ok",
      provider: "github",
      branch: "main",
    });
    // Without an answer nothing is claimed about the repository; an answer without a remote is one.
    expect(gitProviderSettings(NO_HOST)).toMatchObject({
      state: "unanswered",
      provider: "other",
      branch: "—",
    });
    expect(
      gitProviderSettings({ ...NO_HOST, repo: { ...host.repo!, remote: undefined } }),
    ).toMatchObject({ state: "no-remote" });
  });

  it("lists the bundled and installed plugins", () => {
    const rows = pluginRows(
      {
        ...NO_HOST,
        installed: [
          {
            id: "x",
            name: "X",
            version: "1",
            api: 0,
            entry: "",
            areas: [],
            slots: [],
            dev: false,
            verification: "checksum-mismatch",
          },
          {
            id: "y",
            name: "Y",
            version: "2",
            api: 0,
            entry: "",
            areas: [],
            slots: [],
            dev: true,
            verification: "ok",
          },
          {
            id: "z",
            name: "Z",
            version: "3",
            api: 0,
            entry: "",
            areas: [],
            slots: [],
            dev: false,
            verification: "invalid",
          },
        ],
      },
      ["adr"],
      uiT("en"),
    );
    expect(rows.map((r) => r.id)).toEqual(["adr", "bpmn", "dmn", "wiki", "x", "y", "z"]);
    expect(rows[0].enabled).toBe(false);
    expect(rows.slice(4).map((r) => r.verification)).toEqual(["mismatch", "ok", "missing"]);
    expect(rows[5].source).toBe("development");
  });
});

describe("decision records", () => {
  it("maps decision records without inventing authors", () => {
    const item = adrItem(
      {
        path: "docs/adr/0002-x.md",
        number: "0002",
        slug: "x",
        body: "",
        errorState: null,
        title: "X",
        status: "accepted",
        date: "2026-01-01",
      },
      3,
    );
    expect(item).toMatchObject({
      number: 2,
      status: "accepted",
      date: "2026-01-01",
      // The ADR head names no authors: unknown (null), not "none" ([]).
      authors: null,
      refs: 3,
    });
    expect(
      adrItem({ path: "p", number: "x", slug: "s", body: "", errorState: null }, 0),
    ).toMatchObject({
      number: 0,
      title: "s",
      status: "unknown",
      date: "—",
    });
    expect(adrCounts([item]).accepted).toBe(1);
  });
});

describe("host info", () => {
  it("collects what each reader answers and leaves the rest null", async () => {
    const readers = {
      repo: jest.fn(async () => ({
        repository: true,
        dirty: false,

        branch: "main",
      })),
      agent: jest.fn(async () => agent),
      tools: jest.fn(async () => {
        throw new Error("no");
      }),
      installed: jest.fn(async () => []),
    };
    const { result } = renderHook(() => useHostInfo(readers));
    await waitFor(() => expect(result.current.info.repo?.branch).toBe("main"));
    await waitFor(() => expect(result.current.info.agent).toBe(agent));
    // A refused request is not "no tools": the reader keeps the server's reason.
    expect(result.current.info.tools).toEqual({ available: false, reason: "no", tools: [] });
    expect(result.current.info.installed).toEqual([]);
    act(() => result.current.recheck());
    await waitFor(() => expect(readers.agent).toHaveBeenCalledTimes(2));
  });

  it("records a repository error as the host's own text", async () => {
    const readers = {
      repo: jest.fn(async () => {
        throw new Error("no git");
      }),
      agent: jest.fn(async () => {
        throw new Error("x");
      }),
      tools: jest.fn(async () => ({ available: true, tools: ["a"] })),
      installed: jest.fn(async () => {
        throw new Error("x");
      }),
    };
    const { result } = renderHook(() => useHostInfo(readers));
    await waitFor(() => expect(result.current.info.repoError).toBe("no git"));
    await waitFor(() => expect(result.current.info.agentCheckedAt).not.toBeNull());
    expect(result.current.info.agent).toBeNull();
  });
});
