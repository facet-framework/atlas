import { useEffect, useState, type ReactNode } from "react";
import { Button, EmptyState } from "@facet-tools/ui";
import {
  PluginHead,
  useText,
} from "../../../../frontend/src/plugin/components";
import * as views from "../views/Processes";
import { tx } from "../../../../frontend/src/i18n";
import type { BusCallResult } from "../../../../frontend/src/plugin/api";
import type { BpmnDocument } from "../model";
import {
  describeUnreadable,
  fileStem,
  mapProcess,
  summarize,
  walkAt,
  walkPath,
  type MappedDiagram,
  type MappedProcess,
  type Unreadable,
} from "./model";

type Call = (tool: string, args?: unknown) => Promise<BusCallResult>;

/** One file as the host and the sidecar answered it. */
export type LoadedFile =
  | { path: string; ok: true; process: MappedProcess }
  | { path: string; ok: false; unreadable: Unreadable };

const reason = (r: Extract<BusCallResult, { ok: false }>) =>
  "denied" in r ? r.denied : r.error;

async function loadFile(call: Call, path: string): Promise<LoadedFile> {
  const read = await call("repo.read", { path });
  if (!read.ok)
    return {
      path,
      ok: false,
      unreadable: describeUnreadable(reason(read), null),
    };
  const xml = ((read.result as { body?: string } | undefined)?.body ??
    "") as string;
  const drawn = await call("bpmn.diagram", { path, xml });
  if (!drawn.ok)
    return {
      path,
      ok: false,
      unreadable: describeUnreadable(reason(drawn), xml),
    };
  return {
    path,
    ok: true,
    process: mapProcess(path, drawn.result as BpmnDocument),
  };
}

/** Lists the files, then reads and draws each. Rejects only when the listing itself fails. */
export async function loadProcesses(call: Call): Promise<LoadedFile[]> {
  const listed = await call("repo.list", {});
  if (!listed.ok) throw new Error(reason(listed));
  const files =
    (listed.result as { files?: { path: string }[] } | undefined)?.files ?? [];
  return Promise.all(files.map((f) => loadFile(call, f.path)));
}

type Load =
  | { state: "loading" }
  | { state: "error"; reason: string }
  | { state: "ready"; files: LoadedFile[] };

type PlaceState = {
  view: "gallery" | "table";
  query: string;
  page: number;
  diagram: string | null;
  selected: string | null;
  panel: "detail" | "walkthrough";
  zoom: number;
  outlineQuery: string;
  outline: boolean;
  findings: boolean;
  walk: number;
  choices: Record<string, string>;
};

const INITIAL: PlaceState = {
  view: "gallery",
  query: "",
  page: 1,
  diagram: null,
  selected: null,
  panel: "detail",
  zoom: 100,
  outlineQuery: "",
  outline: false,
  findings: false,
  walk: 0,
  choices: {},
};

/** Per-diagram state that must not leak from one diagram or file into the next. */
const FRESH_DIAGRAM: Partial<PlaceState> = {
  selected: null,
  walk: 0,
  choices: {},
  outlineQuery: "",
  outline: false,
};

function Plain({
  title,
  body,
  tone,
  action,
}: {
  title: string;
  body?: string;
  tone?: "error";
  action?: ReactNode;
}) {
  // Every state of the place carries the page head the gallery has.
  return (
    <div
      className="t-page t-stack"
      style={{ gap: 20 }}
      data-testid="process-note"
    >
      <ProcessHead />
      <EmptyState
        icon="flow"
        title={title}
        body={body}
        tone={tone}
        action={action}
      />
    </div>
  );
}

/** The page head of the processes place, on every state of it. */

function ProcessHead() {
  const { t: tt } = useText();
  return (
    <PluginHead
      icon="flow"
      title={tt("ui.bpmn-src-reader.processes-processes")}
    />
  );
}

/** What the host hands the place: where the reader is and the ways out of it. */
export type ProcessesHost = {
  mobile: boolean;
  /** Opens a file of the place, or its gallery for null. */
  open: (path: string | null) => void;
  openRecord: (id: string) => void;
};

/** The files read once per plugin load, so a visit back does not read them again. */
export class ProcessFiles {
  files: LoadedFile[] | null = null;

  /** Keeps what was read for the next visit. */
  keep(files: LoadedFile[] | null): void {
    this.files = files;
  }
}

// @facet: customization/documents/processes
// @facet-role: primary
export function ProcessesPlace({
  host,
  rest,
  call,
  state,
  setState,
  store,
}: {
  host: ProcessesHost;
  rest: string;
  /** The way to the host: the plugin's own `bus.call`. */
  call: Call;
  /** The area's state: the place's filters and view, kept by the host. */
  state: object;
  setState: (next: object) => void;
  store: ProcessFiles;
}) {
  const s: PlaceState = { ...INITIAL, ...(state as Partial<PlaceState>) };
  const set = (patch: Partial<PlaceState>) => setState({ ...s, ...patch });
  const [cached, setCachedState] = useState<{ files: LoadedFile[] | null }>({
    files: store.files,
  });
  const setCached = (next: { files: LoadedFile[] | null }) => {
    store.keep(next.files);
    setCachedState(next);
  };
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cached.files) return;
    let alive = true;
    loadProcesses(call).then(
      (files) => alive && setCached({ files }),
      (e: unknown) =>
        alive && setFailure(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
    // `call` is stable for the page's lifetime; a retry or a cleared cache reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, cached.files === null]);

  const load: Load = cached.files
    ? { state: "ready", files: cached.files }
    : failure !== null
      ? { state: "error", reason: failure }
      : { state: "loading" };

  const reread = () => {
    setCached({ files: null });
    setFailure(null);
    setAttempt((n) => n + 1);
  };
  if (load.state === "loading")
    return (
      <div
        className="t-page t-stack"
        style={{ gap: 20 }}
        data-testid="process-loading"
      >
        <ProcessHead />
        <EmptyState
          plain
          icon="flow"
          title={tx("ui.bpmn-src-reader.processes-reading-process-files")}
        />
      </div>
    );
  if (load.state === "error")
    return (
      <Plain
        tone="error"
        title={tx("ui.bpmn-src-reader.processes-process-files-cannot-read")}
        body={load.reason}
        action={
          <Button icon="refresh" onClick={reread}>
            {tx("ui.bpmn-src-reader.processes-read-again")}
          </Button>
        }
      />
    );

  const open = (path: string) => host.open(path);
  const files = load.files;

  if (!files.length)
    return (
      <Plain
        title={tx("ui.bpmn-src-reader.processes-no-process-file")}
        body={tx("ui.bpmn-src-reader.processes-there-no-bpmn-file-under-docs")}
      />
    );

  if (rest) {
    const file =
      files.find((f) => f.path === rest) ??
      // A shorter address names whole trailing path segments: "a.bpmn" is not "xa.bpmn".
      files.find((f) => f.path.endsWith(`/${rest}`));
    if (!file)
      return (
        <Plain
          title={tx("ui.bpmn-src-reader.processes-process-file-does-not-exist")}
          body={rest}
        />
      );
    if (!file.ok)
      return (
        <UnreadablePlace
          file={file}
          onBack={() => host.open(null)}
          onRetry={reread}
        />
      );
    return (
      <Workspace
        mobile={host.mobile}
        process={file.process}
        s={s}
        set={set}
        onBack={() => host.open(null)}
        onOpenRecord={host.openRecord}
      />
    );
  }

  const readable = files.filter(
    (f): f is Extract<LoadedFile, { ok: true }> => f.ok,
  );
  const broken = files.filter(
    (f): f is Extract<LoadedFile, { ok: false }> => !f.ok,
  );
  const q = s.query.trim().toLowerCase();
  const matching = readable
    .map((f) => summarize(f.process))
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.file.toLowerCase().includes(q),
    );
  const pageSize = host.mobile ? 6 : 12;
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(s.page, pages);
  return (
    <div data-testid="process-gallery">
      <views.ProcessCollection
        state={readable.length ? "ready" : "empty"}
        view={s.view}
        items={matching.slice((page - 1) * pageSize, page * pageSize)}
        total={matching.length}
        page={page}
        pageSize={pageSize}
        query={s.query}
        withWarnings={matching.filter((p) => p.warnings).length}
        mobile={host.mobile}
        onView={(view) => set({ view })}
        onQuery={(query) => set({ query, page: 1 })}
        onPage={(p) => set({ page: p })}
        onReset={() => set({ query: "", page: 1 })}
        onOpen={(path) => {
          set({
            ...FRESH_DIAGRAM,
            diagram: null,
            panel: "detail",
            zoom: 100,
            findings: false,
          });
          open(path);
        }}
      />
      {broken.length ? (
        <div
          className="t-page t-stack"
          data-testid="process-unreadable"
          role="status"
        >
          <span className="t-label">
            {tx("ui.bpmn-src-reader.processes-these-files-could-not-read")}
          </span>
          {broken.map((f) => (
            <Button
              key={f.path}
              variant="quiet"
              icon="warning"
              onClick={() => open(f.path)}
            >
              {f.path}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UnreadablePlace({
  file,
  onBack,
  onRetry,
}: {
  file: Extract<LoadedFile, { ok: false }>;
  onBack: () => void;
  onRetry: () => void;
}) {
  const u = file.unreadable;
  if (u.line === undefined)
    return (
      <div className="t-page" data-testid="process-unreadable-file">
        <EmptyState
          tone="error"
          title={tx("ui.bpmn-src-reader.processes-process-file-cannot-read")}
          body={`${file.path}: ${u.error}`}
          action={
            <Button icon="refresh" onClick={onRetry}>
              {tx("ui.bpmn-src-reader.processes-read-again")}
            </Button>
          }
        />
      </div>
    );
  return (
    <div data-testid="process-unreadable-file">
      <views.ProcessUnreadable
        file={file.path}
        error={u.error}
        line={u.line}
        excerpt={u.excerpt}
        onBack={onBack}
        onRetry={onRetry}
      />
    </div>
  );
}

function Workspace({
  mobile,
  process,
  s,
  set,
  onBack,
  onOpenRecord,
}: {
  mobile: boolean;
  process: MappedProcess;
  s: PlaceState;
  set: (patch: Partial<PlaceState>) => void;
  onBack: () => void;
  onOpenRecord: (id: string) => void;
}) {
  const current: MappedDiagram | undefined =
    process.diagrams.find((d) => d.id === s.diagram) ?? process.diagrams[0];
  if (!current)
    return (
      <Plain
        title={tx("ui.bpmn-src-reader.processes-file-draws-no-diagram")}
        body={process.warnings.join("\n") || process.file}
      />
    );
  const walk = walkAt(current, { step: s.walk, choices: s.choices });
  const path = walkPath(current, s.choices);
  return (
    <div data-testid="process-workspace">
      <views.ProcessWorkspace
        name={process.name}
        file={process.file}
        diagram={current.diagram}
        metrics={current.metrics}
        diagrams={process.diagrams.map((d) => ({
          id: d.id,
          name: d.name || fileStem(process.file),
          elements: d.elements,
        }))}
        activeDiagram={current.id}
        selected={walk ? null : s.selected}
        walk={walk}
        panel={s.panel}
        findings={current.findings}
        findingsOpen={s.findings}
        outlineQuery={s.outlineQuery}
        zoom={s.zoom}
        linked={{}}
        mobile={mobile}
        outlineOpen={s.outline}
        onDiagram={(id) => set({ ...FRESH_DIAGRAM, diagram: id })}
        onSelect={(id) =>
          set({ selected: id, panel: "detail", outline: false })
        }
        onPanel={(panel) => set({ panel })}
        onZoom={(dir) =>
          set({
            zoom:
              dir === "fit"
                ? 100
                : Math.max(
                    25,
                    Math.min(200, s.zoom + (dir === "in" ? 25 : -25)),
                  ),
          })
        }
        onOutlineQuery={(outlineQuery) => set({ outlineQuery })}
        onOutline={() => set({ outline: !s.outline })}
        onFindings={() => set({ findings: !s.findings })}
        onWalk={(action, edge) => {
          if (action === "start") {
            // Without a start event there is no walk to take.
            if (path.nodes.length)
              set({ walk: 1, panel: "walkthrough", choices: {} });
          } else if (action === "stop") set({ walk: 0, choices: {} });
          else if (action === "next") set({ walk: s.walk + 1 });
          else if (action === "back") set({ walk: Math.max(1, s.walk - 1) });
          else if (action === "choose" && walk?.current && edge)
            set({
              choices: { ...s.choices, [walk.current]: edge },
              walk: s.walk + 1,
            });
        }}
        onOpenRecord={onOpenRecord}
        onBack={onBack}
      />
    </div>
  );
}
