import { useMenuTrigger } from "@facet-tools/ui";
import { useId, type KeyboardEvent, type ReactNode, type Ref, type SyntheticEvent } from "react";
import {
  Icon,
  type IconName,
  Badge,
  Button,
  Chip,
  IconButton,
  Kbd,
  SearchField,
  EmptyState,
  Menu,
  Sheet,
} from "@facet-tools/ui";

import type { TextKey } from "../text";
import { useText } from "../text";
import { Inline, Markdown, noop } from "./shared";
import { useConversationScroll } from "./chatScroll";

/** View model -------------------------------------------------------------------- */

export type ChatStepVM = {
  label: string;
  detail?: string;
  lines?: string;
  state: "done" | "running" | "failed";
  ms?: number;
};
export type ChatSourceVM = {
  kind: "record" | "file" | "adr";
  ref: string;
  line?: number;
  title?: string;
  excerpt?: string;
};
export type AnswerState = "streaming" | "done" | "stopped" | "failed" | "cut";

export type ChatAnswerVM = {
  markdown: string;
  state: AnswerState;
  steps: ChatStepVM[];
  sources: ChatSourceVM[];
  model?: string;
  seconds?: number;
  error?: string;
  /** What the run read, for a finished answer: how many distinct files were
   * opened, each opened location (a path, with its line range where the read
   * carried one), and whether the host's tool lists back "nothing written".
   * Absent when nothing was read or the run did not finish. */

  read?: { count: number; files: string[]; nothingWritten?: boolean };
};

export type ChatTurnVM = {
  id: string;
  question: string;
  at: string;
  context?: string[];
  answer?: ChatAnswerVM;
};
export type ChatMode = "Ask";

/** The composer's text field, for a host that hands it the focus (the reader's "/"
 * shortcut). An attribute rather than a class: a class is how it looks and may
 * be renamed, this is what it is. */

export const COMPOSER_FIELD_SELECTOR = "textarea[data-composer-field]";
export type Continuation = "continued" | "restarted" | "open";

const SOURCE_ICON: Record<ChatSourceVM["kind"], IconName> = {
  record: "document",
  file: "code",
  adr: "scales",
};
/** Source kind labels; Record reads the same in both languages. */
const SOURCE_KIND: Record<ChatSourceVM["kind"], TextKey | { fixed: string }> = {
  record: { fixed: "Record" },
  file: "ui.screens-plugins.chat-file",
  adr: "ui.screens-plugins.chat-decision",
};

function useSourceKind() {
  const { t } = useText();
  return (kind: ChatSourceVM["kind"]) => {
    const k = SOURCE_KIND[kind];
    return typeof k === "string" ? t(k) : k.fixed;
  };
}

const MODE_KEY: Record<ChatMode, TextKey> = {
  Ask: "ui.screens-plugins.chat-ask",
};
const CONT_KEY: Record<Continuation, TextKey> = {
  continued: "ui.screens-plugins.chat-continued",
  restarted: "ui.screens-plugins.chat-started-anew",
  open: "ui.screens-plugins.chat-open",
};

/** Pieces -------------------------------------------------------------------------- */

export type ReadingTrailProps = {
  steps: ChatStepVM[];
  open: boolean;
  live?: boolean;
  onToggle?: () => void;
};

/** The live reading trail: what Atlas read and searched, as it happens. */
export function ReadingTrail({ steps, open, live, onToggle = noop }: ReadingTrailProps) {
  const { t, plural } = useText();
  const done = steps.filter((s) => s.state === "done").length;
  const running = steps.find((s) => s.state === "running");
  return (
    <div className="t-d-trail" data-live={live || undefined}>
      <button type="button" className="t-d-trail__head" aria-expanded={open} onClick={onToggle}>
        <span className="t-d-trail__pulse" aria-hidden="true" />
        <span>
          {live && running
            ? `${running.label} …`
            : plural("ui.screens-plugins.chat-reading-trail-count-steps", done)}
        </span>
        <span className="t-spacer" />
        <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
      </button>
      {open ? (
        <ol
          className="t-d-trail__list t-stagger"
          aria-label={t("ui.screens-plugins.chat-reading-trail")}
        >
          {steps.map((s, i) => (
            <li key={i} data-state={s.state}>
              <span className="t-d-trail__mark" aria-hidden="true">
                <Icon
                  name={s.state === "done" ? "check" : s.state === "failed" ? "close" : "search"}
                  size={11}
                />
              </span>
              <span className="t-d-trail__label">{s.label}</span>
              {s.detail ? (
                <span className="t-mono t-d-trail__detail t-ellipsis">{s.detail}</span>
              ) : null}
              {s.lines ? <span className="t-mono t-meta">{s.lines}</span> : null}
              <span className="t-spacer" />
              {s.ms != null ? (
                <span className="t-mono t-meta">
                  {s.ms} {t("ui.screens-plugins.chat-ms")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function SourceCards({
  sources,
  onOpen = noop,
}: {
  sources: ChatSourceVM[];
  onOpen?: (s: ChatSourceVM) => void;
}) {
  const { t } = useText();
  const sourceKind = useSourceKind();
  return (
    <div className="t-d-sources" aria-label={t("ui.screens-plugins.chat-sources")}>
      {sources.map((s, i) => (
        <button
          key={`${s.ref}${i}`}
          type="button"
          className="t-d-source"
          data-kind={s.kind}
          onClick={() => onOpen(s)}
        >
          <span className="t-d-source__n t-mono">{i + 1}</span>
          <Icon name={SOURCE_ICON[s.kind]} size={14} />
          <span className="t-stack" style={{ gap: 0, minWidth: 0 }}>
            <span className="t-mono t-wrap">
              {s.ref}
              {s.line ? <span className="t-muted">:{s.line}</span> : null}
            </span>
            <span className="t-meta t-wrap">{s.title ?? sourceKind(s.kind)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** What a copy action copies: the question, or the answer as text, as Markdown or its sources. */
export type CopyWhat = "question" | "text" | "markdown" | "sources";
/** The outcome of the last copy: which action, and whether the clipboard took it. */
export type CopyResult = { what: CopyWhat; failed?: boolean };

export type AnswerActionsProps = {
  copied?: CopyResult | null;
  onCopy?: (what: CopyWhat) => void;
  onRetry?: () => void;
};

function AnswerActions({ copied, onCopy = noop, onRetry = noop }: AnswerActionsProps) {
  const { t } = useText();
  const copy = (what: CopyWhat, label: string) => {
    const result = copied?.what === what ? copied : null;
    return (
      <Button
        size="small"
        variant="quiet"
        icon={result ? (result.failed ? "error" : "check") : "copy"}
        data-copy={result ? (result.failed ? "failed" : "done") : undefined}
        onClick={() => onCopy(what)}
      >
        {result
          ? result.failed
            ? t("ui.screens-plugins.chat-not-copied")
            : t("ui.screens-plugins.chat-copied")
          : label}
      </Button>
    );
  };
  return (
    <div
      className="t-d-answer__actions"
      role="toolbar"
      aria-label={t("ui.screens-plugins.chat-answer")}
    >
      {copy("text", t("ui.screens-plugins.chat-copy"))}
      {copy("markdown", "Markdown")}
      {copy("sources", t("ui.screens-plugins.chat-sources"))}
      <Button size="small" variant="quiet" icon="refresh" onClick={onRetry}>
        {t("ui.screens-plugins.chat-ask-again")}
      </Button>
    </div>
  );
}

/** Under a finished answer: how many files were read, and which, with ranges where read. */
function ReadFooter({ read }: { read: NonNullable<ChatAnswerVM["read"]> }) {
  const { t, plural } = useText();
  return (
    <div className="t-d-answer__read" data-testid="answer-read">
      <span className="t-meta">
        {plural("ui.screens-plugins.chat-count-files-read", read.count)}
        {read.nothingWritten ? ` · ${t("ui.screens-plugins.chat-nothing-written")}` : ""}
      </span>
      <ul className="t-d-answer__files" aria-label={t("ui.screens-plugins.chat-read")}>
        {read.files.map((f) => (
          <li key={f} className="t-mono">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type ChatTurnProps = {
  turn: ChatTurnVM;
  trailOpen?: boolean;
  copied?: AnswerActionsProps["copied"];
  copiedCode?: number | null;
  compact?: boolean;
  onToggleTrail?: () => void;
  onCopy?: AnswerActionsProps["onCopy"];
  onCopyCode?: (code: string) => void;
  onRetry?: () => void;
  onContinue?: () => void;
  onSource?: (s: ChatSourceVM) => void;
};

export function ChatTurn({
  turn,
  trailOpen,
  copied,
  copiedCode,
  compact,
  onToggleTrail = noop,
  onCopy,
  onCopyCode,
  onRetry = noop,
  onContinue = noop,
  onSource,
}: ChatTurnProps) {
  const { t, plural } = useText();
  const a = turn.answer;
  const live = a?.state === "streaming";
  const questionCopy = copied?.what === "question" ? copied : null;
  const now = a?.steps.find((s) => s.state === "running");
  return (
    <article
      className="t-d-turn t-anim-rise"
      data-compact={compact || undefined}
      aria-label={turn.question}
    >
      <div className="t-d-question">
        <span className="t-d-question__text">{turn.question}</span>
        <span className="t-meta">{turn.at}</span>
        {onCopy ? (
          <IconButton
            icon={questionCopy ? (questionCopy.failed ? "error" : "check") : "copy"}
            label={
              questionCopy
                ? t(
                    questionCopy.failed
                      ? "ui.screens-plugins.chat-not-copied"
                      : "ui.screens-plugins.chat-copied",
                  )
                : t("ui.screens-plugins.chat-copy-question")
            }
            size="small"
            data-copy={questionCopy ? (questionCopy.failed ? "failed" : "done") : undefined}
            onClick={() => onCopy("question")}
          />
        ) : null}
        {turn.context?.length ? (
          <span className="t-row t-row--wrap" style={{ gap: 4 }}>
            {turn.context.map((c) => (
              <Badge key={c} plain>
                {c}
              </Badge>
            ))}
          </span>
        ) : null}
      </div>
      {a ? (
        <div className="t-d-answer" data-state={a.state}>
          <div className="t-d-answer__mark" aria-hidden="true">
            <Icon name="spark" size={14} />
          </div>
          <div className="t-stack" style={{ gap: 12, minWidth: 0 }}>
            {live ? (
              <div className="t-d-livebar" role="status" data-testid="answer-live">
                <span className="t-d-trail__pulse" aria-hidden="true" />
                <strong>{t("ui.screens-plugins.chat-atlas-answering")}</strong>
                <span className="t-mono t-meta">
                  {a.seconds ?? 0} {t("ui.screens-plugins.chat-s")}
                </span>
                {now ? (
                  <span className="t-meta t-ellipsis">
                    · {now.label}
                    {now.detail ? <span className="t-mono"> {now.detail}</span> : null}
                  </span>
                ) : null}
              </div>
            ) : null}
            {a.steps.length ? (
              <ReadingTrail
                steps={a.steps}
                open={trailOpen ?? live}
                live={live}
                onToggle={onToggleTrail}
              />
            ) : null}
            {a.markdown ? (
              <div className="t-d-answer__body" data-live={live || undefined}>
                <Markdown source={a.markdown} onCopyCode={onCopyCode} copiedCode={copiedCode} />
              </div>
            ) : null}
            {a.state === "cut" ? (
              <div className="t-d-banner" data-tone="warn" role="status">
                <Icon name="pause" size={16} />
                <div className="t-stack" style={{ gap: 2 }}>
                  <strong>{t("ui.screens-plugins.chat-interrupted-not-finished")}</strong>
                  <span className="t-meta">
                    {t("ui.screens-plugins.chat-tab-was-gone-while-answer-ran")}
                  </span>
                </div>
                <span className="t-spacer" />
                <Button size="small" variant="primary" icon="play" onClick={onContinue}>
                  {t("ui.screens-plugins.chat-continue")}
                </Button>
              </div>
            ) : null}
            {a.state === "stopped" ? (
              <div className="t-d-banner" data-tone="neutral" role="status">
                <Icon name="stop" size={16} />
                <span>
                  {t("ui.screens-plugins.chat-stopped-after-seconds-s", {
                    seconds: a.seconds ?? "—",
                  })}
                </span>
                <span className="t-spacer" />
                <Button size="small" icon="refresh" onClick={onRetry}>
                  {t("ui.screens-plugins.chat-ask-again")}
                </Button>
              </div>
            ) : null}
            {a.state === "failed" ? (
              <div className="t-d-banner" data-tone="bad" role="alert">
                <Icon name="error" size={16} />
                <div className="t-stack" style={{ gap: 2 }}>
                  <strong>{t("ui.screens-plugins.chat-no-answer")}</strong>
                  <span className="t-meta">
                    {a.error ?? t("ui.screens-plugins.chat-host-closed-connection")}
                  </span>
                </div>
                <span className="t-spacer" />
                <Button size="small" icon="refresh" onClick={onRetry}>
                  {t("ui.screens-plugins.chat-again")}
                </Button>
              </div>
            ) : null}
            {a.sources.length && !live ? (
              <SourceCards sources={a.sources} onOpen={onSource} />
            ) : null}
            {a.state === "done" ? (
              <>
                <AnswerActions copied={copied} onCopy={onCopy} onRetry={onRetry} />
                {a.read && a.read.files.length ? <ReadFooter read={a.read} /> : null}
                <span className="t-meta t-d-answer__foot">
                  {a.model ? <span className="t-mono">{a.model}</span> : null}
                  {[
                    a.model ? "" : null,
                    a.seconds != null ? `${a.seconds} s` : null,
                    plural("ui.screens-plugins.chat-count-sources", a.sources.length),
                    plural("ui.screens-plugins.chat-count-steps", a.steps.length),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/** Composer ---------------------------------------------------------------------- */

export type SlashCommand = { cmd: string; label: string; hint: string };

/** A conversation mode the composer offers; `key` is what `onMode` reports. */
export type ComposerMode = { key: string; label: string; icon?: IconName };

export type ComposerProps = {
  value: string;
  /** The key of the chosen mode: one of `modes`, or a `ChatMode` without them. */
  mode: ChatMode | (string & {});
  /** The modes to choose from; left out, "Ask". */
  modes?: readonly ComposerMode[];
  model: string;
  models?: string[];
  context: { key: string; label: string; icon: IconName }[];
  running?: boolean;
  disabled?: boolean;
  slash?: { items: SlashCommand[]; active: number } | null;
  compact?: boolean;
  /** Whether Enter sends. True on a desktop, where Shift+Enter and Alt+Enter
   * break the line; false on a phone, whose Enter key is the line break. */

  enterSends?: boolean;
  /** Whether the model menu is open; `models` are its entries. */
  modelsOpen?: boolean;
  onChange?: (v: string) => void;
  onSend?: () => void;
  onStop?: () => void;
  onMode?: (m: string) => void;
  /** Opens or closes the model menu. */
  onModel?: () => void;
  /** A model chosen from the menu, by its index in `models`. */
  onPickModel?: (index: number) => void;
  onRemoveContext?: (key: string) => void;
  onSlash?: (cmd: string) => void;
  /** Arrow keys move the highlighted command. */
  onSlashActive?: (index: number) => void;
  /** Esc closes the command list without changing the text. */
  onSlashClose?: () => void;
};

export function Composer({
  value,
  mode,
  modes,
  model,
  models,
  context,
  running,
  disabled,
  slash,
  compact,
  enterSends = true,
  modelsOpen,
  onChange = noop,
  onSend = noop,
  onStop = noop,
  onMode = noop,
  onModel = noop,
  onPickModel = noop,
  onRemoveContext = noop,
  onSlash = noop,
  onSlashActive = noop,
  onSlashClose = noop,
}: ComposerProps) {
  const { t } = useText();
  const modelKeys = useMenuTrigger(!!modelsOpen && !!models?.length, onModel);
  const offered: readonly ComposerMode[] = modes ?? [
    { key: "Ask", label: t(MODE_KEY.Ask), icon: "chat" },
  ];
  const slashOpen = !!slash && slash.items.length > 0;
  const walkTo = (e: SyntheticEvent<HTMLDivElement>) => {
    const row = (e.target as Element).closest('[role="menuitem"]');
    if (!row || !slash) return;
    const i = [...e.currentTarget.querySelectorAll('[role="menuitem"]')].indexOf(row);
    if (i >= 0 && i !== slash.active) onSlashActive(i);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME composition owns Enter until it is committed.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (slashOpen) {
      const n = slash.items.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        onSlashActive((slash.active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSlash(slash.items[Math.min(slash.active, n - 1)].cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onSlashClose();
        return;
      }
    }
    if (e.key !== "Enter" || !enterSends || e.shiftKey) return;
    e.preventDefault();
    if (e.altKey) {
      // Alt+Enter breaks the line like Shift+Enter; a textarea does not do that by
      // itself. Written at the caret, which then stands after the break, and
      // reported through the field's own input event, so typing on continues there.
      const el = e.currentTarget;
      el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (!running && !disabled && value.trim()) onSend();
  };
  return (
    <div className="t-d-composer" data-compact={compact || undefined} data-mode={mode}>
      {slashOpen ? (
        // The pointer (or focus) walks the list like the arrow keys: the row
        // under it is the one Enter takes. Delegated here, so the list keeps
        // the shared Menu.
        <div style={{ display: "contents" }} onMouseOver={walkTo} onFocus={walkTo}>
          <Menu
            label={t("ui.screens-plugins.chat-commands")}
            className="t-d-slash"
            header={<span className="t-menu-label">{t("ui.screens-plugins.chat-commands")}</span>}
            groups={[
              {
                items: slash.items.map((s, i) => ({
                  key: s.cmd,
                  label: <span className="t-mono">{s.cmd}</span>,
                  sub: s.label,
                  meta: s.hint,
                  active: i === slash.active,
                  current: i === slash.active,
                  onSelect: () => onSlash(s.cmd),
                })),
              },
            ]}
          />
        </div>
      ) : null}
      {context.length ? (
        <div
          className="t-row t-row--wrap"
          style={{ gap: 6 }}
          aria-label={t("ui.screens-plugins.chat-context")}
        >
          {context.map((c) => (
            <Chip key={c.key} icon={c.icon} mono onRemove={() => onRemoveContext(c.key)}>
              {c.label}
            </Chip>
          ))}
        </div>
      ) : null}
      <textarea
        className="t-d-composer__input"
        data-composer-field=""
        aria-label={t("ui.screens-plugins.chat-question-atlas")}
        rows={compact ? 2 : 3}
        placeholder={t("ui.screens-plugins.chat-ask-atlas-commands")}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="t-d-composer__bar">
        <div className="t-d-modes" role="radiogroup" aria-label={t("ui.screens-plugins.chat-mode")}>
          {offered.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              className="t-d-mode"
              disabled={disabled}
              onClick={() => onMode(m.key)}
            >
              <Icon name={m.icon ?? "chat"} size={12} />
              {m.label}
            </button>
          ))}
        </div>
        <span className="t-d-model__wrap">
          <button
            type="button"
            className="t-d-model"
            onClick={modelKeys.onClick}
            onKeyDown={modelKeys.onKeyDown}
            disabled={disabled}
            aria-label={t("ui.screens-plugins.chat-model-model", { model })}
            aria-haspopup="menu"
            aria-expanded={!!modelsOpen}
          >
            <span className="t-mono">{model}</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {modelsOpen && models?.length ? (
            <Menu
              label={t("ui.screens-plugins.chat-models")}
              className="t-d-model__menu"
              openFocus={modelKeys.focus}
              groups={[
                {
                  items: models.map((m, i) => ({
                    key: `${i}-${m}`,
                    label: <span className="t-mono">{m}</span>,
                    current: m === model,
                    icon: m === model ? "check" : undefined,
                    onSelect: () => onPickModel(i),
                  })),
                },
              ]}
            />
          ) : null}
        </span>
        <span className="t-spacer" />
        {compact || !enterSends ? null : (
          <span className="t-meta t-hide-mobile">
            <Kbd>↵</Kbd> {t("ui.screens-plugins.chat-send")} · <Kbd>⇧↵</Kbd>{" "}
            {t("ui.screens-plugins.chat-line")}
          </span>
        )}
        {running ? (
          <Button
            variant="danger"
            icon="stop"
            onClick={onStop}
            aria-label={t("ui.screens-plugins.chat-stop")}
          />
        ) : (
          <Button
            variant="primary"
            icon="send"
            disabled={disabled || !value.trim()}
            onClick={onSend}
            aria-label={t("ui.screens-plugins.chat-send-composer")}
          />
        )}
      </div>
    </div>
  );
}

/** Not signed in -------------------------------------------------------------- */

export function ChatSignIn({
  command = "claude login",
  onCheck = noop,
  onCopy = noop,
}: {
  command?: string;
  onCheck?: () => void;
  onCopy?: () => void;
}) {
  const { t } = useText();
  return (
    <div className="t-d-signin" role="status">
      <span className="t-d-signin__art" aria-hidden="true">
        <Icon name="lock" size={28} />
      </span>
      <strong className="t-h3">{t("ui.screens-plugins.chat-atlas-not-signed")}</strong>
      <p className="t-ink2">
        {t("ui.screens-plugins.chat-claude-code-machine-answers-questions-sign")}
      </p>
      <div className="t-d-cmd">
        <span className="t-mono">$ {command}</span>
        <span className="t-spacer" />
        <IconButton
          icon="copy"
          label={t("ui.screens-plugins.chat-copy-command")}
          size="small"
          onClick={onCopy}
        />
      </div>
      <Button variant="primary" icon="refresh" onClick={onCheck}>
        {t("ui.screens-plugins.chat-check-again")}
      </Button>
    </div>
  );
}

/** Pill --------------------------------------------------------------------------- */

/** The glow dot: an answer arrived that nobody has looked at yet. Its words describe the control it sits on. */
function Glow({ id }: { id: string }) {
  const { t } = useText();
  return (
    <span className="t-d-glow" data-testid="chat-glow">
      <span id={id} hidden>
        {t("ui.screens-plugins.chat-new-answer")}
      </span>
    </span>
  );
}

export function ChatPill({
  running,
  unread,
  label,
  step,
  mobile,
  onOpen = noop,
}: {
  running?: boolean;
  /** An answer finished that the reader has not looked at. */
  unread?: boolean;
  label?: string;
  step?: string;
  mobile?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useText();
  const glowId = useId();
  const glowing = unread && !running;
  return (
    <button
      type="button"
      className="t-d-pill t-anim-pop"
      data-running={running || undefined}
      data-mobile={mobile || undefined}
      aria-describedby={glowing ? glowId : undefined}
      onClick={onOpen}
    >
      {glowing ? <Glow id={glowId} /> : null}
      <span className="t-d-pill__orb" aria-hidden="true">
        <Icon name="spark" size={16} />
      </span>
      <span className="t-stack" style={{ gap: 0, minWidth: 0 }}>
        <span className="t-d-pill__label">
          {running
            ? t("ui.screens-plugins.chat-atlas-answering")
            : (label ?? t("ui.screens-plugins.chat-ask-atlas"))}
        </span>
        {running && step ? <span className="t-meta t-ellipsis">{step}</span> : null}
      </span>
      {running ? null : <Kbd>?</Kbd>}
    </button>
  );
}

/** Dock --------------------------------------------------------------------------- */

export type ChatDockProps = {
  title: string;
  continuation?: Continuation;
  turns: ChatTurnVM[];
  composer: ComposerProps;
  suggestions?: string[];
  roleName?: string;
  signedIn?: boolean;
  hostError?: string | null;
  mobile?: boolean;
  trailOpen?: Record<string, boolean>;
  copied?: ({ turn: string } & CopyResult) | null;
  /** The box follows the bottom instead of pinning the reader's question to the top. */
  follow?: boolean;
  /** Another conversation holds an answer the reader has not looked at. */
  othersUnread?: boolean;
  /** A state of the conversation itself, such as conversations the browser did not store. */
  notice?: string | null;
  onClose?: () => void;
  onExpand?: () => void;
  onNew?: () => void;
  onSuggestion?: (q: string) => void;
  onToggleTrail?: (turn: string) => void;
  onCopy?: (turn: string, what: CopyWhat) => void;
  onRetry?: (turn: string) => void;
  onContinue?: (turn: string) => void;
  onSource?: (s: ChatSourceVM) => void;
};

const CONT_TONE: Record<Continuation, "ok" | "plan" | "neutral"> = {
  continued: "ok",
  restarted: "plan",
  open: "neutral",
};

function Conversation({
  turns,
  suggestions,
  roleName,
  signedIn,
  hostError,
  trailOpen,
  copied,
  compact,
  onSuggestion = noop,
  onToggleTrail = noop,
  onCopy = noop,
  onRetry = noop,
  onContinue = noop,
  onSource,
}: Omit<ChatDockProps, "title" | "composer"> & { compact?: boolean }) {
  const { t } = useText();
  if (hostError) {
    return (
      <EmptyState
        tone="error"
        icon="error"
        title={t("ui.screens-plugins.chat-atlas-cannot-answer-right-now")}
        body={<Inline text={hostError} />}
        action={
          <Button icon="refresh" onClick={() => onRetry("")}>
            {t("ui.screens-plugins.chat-reconnect")}
          </Button>
        }
      />
    );
  }
  if (signedIn === false) return <ChatSignIn />;
  if (!turns.length) {
    return (
      <div className="t-d-welcome t-stagger">
        <span className="t-d-welcome__orb" aria-hidden="true">
          <Icon name="spark" size={22} />
        </span>
        <strong className="t-h2">{t("ui.screens-plugins.chat-what-do-you-want-know")}</strong>
        <span className="t-meta">
          {t("ui.screens-plugins.chat-atlas-reads-records-code")}
          {roleName ? t("ui.screens-plugins.chat-suggestions-role", { role: roleName }) : ""}
        </span>
        <div className="t-d-suggest">
          {(suggestions ?? []).map((q) => (
            <button
              key={q}
              type="button"
              className="t-d-suggest__item t-interactive"
              onClick={() => onSuggestion(q)}
            >
              <Icon name="chat" size={14} />
              <span>{q}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="t-d-turns">
      {turns.map((turn) => (
        <ChatTurn
          key={turn.id}
          turn={turn}
          compact={compact}
          trailOpen={trailOpen?.[turn.id]}
          copied={copied?.turn === turn.id ? copied : null}
          onToggleTrail={() => onToggleTrail(turn.id)}
          onCopy={(w) => onCopy(turn.id, w)}
          onRetry={() => onRetry(turn.id)}
          onContinue={() => onContinue(turn.id)}
          onSource={onSource}
        />
      ))}
    </div>
  );
}

/** What the conversation box scrolls by: the conversation shown, its turns and how far they have grown. */
function scrollKeys(turns: ChatTurnVM[], follow?: boolean) {
  return {
    // Turn ids carry their conversation; the first one changes with a switch.
    conversation: turns[0]?.id ?? "",
    turns: turns.length,
    content: turns
      .map((turn) =>
        [
          turn.id,
          turn.answer?.state,
          turn.answer?.steps.length,
          turn.answer?.markdown.length,
          turn.answer?.sources.length,
        ].join(":"),
      )
      .join("|"),
    follow,
  };
}

/** The empty space below the last turn that lets its question reach the top
 * edge. Its height is set by the scroll hook on the element itself. */

function Room({ roomRef }: { roomRef: Ref<HTMLDivElement> }) {
  return <div ref={roomRef} aria-hidden="true" data-testid="chat-room" className="t-d-room" />;
}

/** A state of the conversation itself, above the composer. */
function Notice({ text }: { text?: string | null }) {
  return text ? (
    <div className="t-d-banner t-d-notice" data-tone="warn" role="status" data-testid="chat-notice">
      <Icon name="warning" size={14} />
      <span className="t-meta">{text}</span>
    </div>
  ) : null;
}

export function ChatDock(props: ChatDockProps) {
  const {
    title,
    continuation,
    composer,
    mobile,
    signedIn,
    onClose = noop,
    onExpand = noop,
    onNew = noop,
  } = props;
  const { t } = useText();
  const glowId = useId();
  const live = props.turns.some((turn) => turn.answer?.state === "streaming");
  const { boxRef, roomRef, onScroll } = useConversationScroll(
    scrollKeys(props.turns, props.follow),
  );
  return (
    <aside
      className="t-d-dock"
      data-mobile={mobile || undefined}
      aria-label={t("ui.screens-plugins.chat-ask-atlas")}
    >
      {mobile ? <div className="t-sheet__grip" aria-hidden="true" /> : null}
      <header className="t-d-dock__head">
        <span className="t-d-dock__orb" aria-hidden="true">
          <Icon name="spark" size={14} />
        </span>
        <div className="t-stack" style={{ gap: 0, minWidth: 0, flex: 1 }}>
          <span className="t-h3 t-wrap">{title}</span>
          {continuation ? (
            <span className="t-meta t-row" style={{ gap: 6 }}>
              <span className={`t-dot t-dot--${CONT_TONE[continuation]}`} />{" "}
              {t(CONT_KEY[continuation])}
            </span>
          ) : null}
        </div>
        <IconButton
          icon="plus"
          label={t("ui.screens-plugins.chat-new-conversation")}
          size="small"
          onClick={onNew}
        />
        <span className="t-d-glow-anchor">
          <IconButton
            icon="expand"
            label={t("ui.screens-plugins.chat-full-screen")}
            size="small"
            aria-describedby={props.othersUnread ? glowId : undefined}
            onClick={onExpand}
          />
          {props.othersUnread ? <Glow id={glowId} /> : null}
        </span>
        <IconButton
          icon="close"
          label={t("ui.screens-plugins.chat-close")}
          size="small"
          onClick={onClose}
        />
      </header>
      <div
        className="t-d-dock__body"
        ref={boxRef}
        onScroll={onScroll}
        data-testid="chat-scroll"
        data-live={live || undefined}
      >
        <Conversation {...props} compact />
        <Room roomRef={roomRef} />
      </div>
      {signedIn === false || props.hostError ? null : (
        <div className="t-d-dock__foot">
          <Notice text={props.notice} />
          <Composer {...composer} compact />
        </div>
      )}
    </aside>
  );
}

/** Full screen with sessions ------------------------------------------------------- */

export type ChatSessionVM = {
  id: string;
  title: string;
  /** Absent when the time of the session is not known; the line then leaves it out. */
  when?: string;
  rounds: number;
  mode: ChatMode;
  pinned?: boolean;
  /** Absent when it was not determined how the session continues. */
  continuation?: Continuation;
  running?: boolean;
  /** Its last answer finished while the reader was not looking at it. */
  unread?: boolean;
};

export type ChatFullProps = Omit<ChatDockProps, "onExpand"> & {
  sessions: ChatSessionVM[];
  currentId: string;
  query: string;
  renaming?: { id: string; value: string; error?: string } | null;
  menuFor?: string | null;
  sessionsOpen?: boolean;
  onQuery?: (q: string) => void;
  onPick?: (id: string) => void;
  onMenu?: (id: string | null) => void;
  onPin?: (id: string) => void;
  onRename?: (id: string) => void;
  onRenameValue?: (v: string) => void;
  onRenameSave?: () => void;
  onRenameCancel?: () => void;
  onDelete?: (id: string) => void;
  onSessions?: () => void;
  onShrink?: () => void;
};

/** A conversation's "more" button and its menu, opened by pointer or keyboard. */
function SessionActions({
  session: s,
  open,
  onToggle,
  onPin,
  onRename,
  onDelete,
}: {
  session: ChatSessionVM;
  open: boolean;
  onToggle: () => void;
  onPin: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useText();
  const keys = useMenuTrigger(open, onToggle);
  return (
    <>
      <IconButton
        icon="more"
        label={t("ui.screens-plugins.chat-actions-title", { title: s.title })}
        size="small"
        variant="quiet"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={keys.onClick}
        onKeyDown={keys.onKeyDown}
      />
      {open ? (
        <Menu
          label={t("ui.screens-plugins.chat-session")}
          className="t-d-session__menu"
          openFocus={keys.focus}
          groups={[
            {
              items: [
                {
                  key: "pin",
                  label: s.pinned
                    ? t("ui.screens-plugins.chat-unpin")
                    : t("ui.screens-plugins.chat-pin"),
                  icon: "pin",
                  onSelect: () => onPin(s.id),
                },
                {
                  key: "rename",
                  label: t("ui.screens-plugins.chat-rename"),
                  icon: "edit",
                  onSelect: () => onRename(s.id),
                },
                {
                  key: "delete",
                  label: t("ui.screens-plugins.chat-delete"),
                  icon: "trash",
                  onSelect: () => onDelete(s.id),
                },
              ],
            },
          ]}
        />
      ) : null}
    </>
  );
}

function SessionList({
  sessions,
  currentId,
  query,
  renaming,
  menuFor,
  onQuery = noop,
  onPick = noop,
  onMenu = noop,
  onPin = noop,
  onRename = noop,
  onRenameValue = noop,
  onRenameSave = noop,
  onRenameCancel = noop,
  onDelete = noop,
  onNew = noop,
}: ChatFullProps) {
  const { t, plural } = useText();
  const glowBase = useId();
  const pinned = sessions.filter((s) => s.pinned);
  const rest = sessions.filter((s) => !s.pinned);
  const group = (label: string, list: ChatSessionVM[]): ReactNode =>
    list.length ? (
      <section key={label} className="t-stack" style={{ gap: 2 }}>
        <span className="t-menu-label">
          {label} · {list.length}
        </span>
        {list.map((s) =>
          renaming?.id === s.id ? (
            <form
              key={s.id}
              className="t-d-rename"
              aria-label={t("ui.screens-plugins.chat-rename-session")}
              onSubmit={(e) => {
                e.preventDefault();
                onRenameSave();
              }}
            >
              <input
                className="t-input"
                aria-label={t("ui.screens-plugins.chat-new-title")}
                aria-invalid={!!renaming.error}
                value={renaming.value}
                onChange={(e) => onRenameValue(e.target.value)}
              />
              {renaming.error ? <span className="t-field__error">{renaming.error}</span> : null}
              <div className="t-row" style={{ gap: 6 }}>
                <Button size="small" type="submit" variant="primary" disabled={!!renaming.error}>
                  {t("ui.screens-plugins.chat-save")}
                </Button>
                <Button size="small" variant="quiet" onClick={onRenameCancel}>
                  {t("ui.screens-plugins.chat-cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <div
              key={s.id}
              className="t-d-session"
              aria-current={s.id === currentId ? "true" : undefined}
              data-unread={(s.unread && !s.running) || undefined}
            >
              <button
                type="button"
                className="t-d-session__main"
                aria-describedby={s.unread && !s.running ? `${glowBase}-${s.id}` : undefined}
                onClick={() => onPick(s.id)}
              >
                <span className="t-row" style={{ gap: 6, minWidth: 0 }}>
                  {s.running ? (
                    <span
                      className="t-d-trail__pulse"
                      aria-label={t("ui.screens-plugins.chat-running")}
                    />
                  ) : s.unread ? (
                    <Glow id={`${glowBase}-${s.id}`} />
                  ) : null}
                  <span className="t-wrap">{s.title}</span>
                </span>
                <span className="t-meta">
                  {[
                    s.when,
                    plural("ui.screens-plugins.chat-count-rounds", s.rounds),
                    s.continuation ? t(CONT_KEY[s.continuation]) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              <SessionActions
                session={s}
                open={menuFor === s.id}
                onToggle={() => onMenu(menuFor === s.id ? null : s.id)}
                onPin={onPin}
                onRename={onRename}
                onDelete={onDelete}
              />
            </div>
          ),
        )}
      </section>
    ) : null;
  return (
    <nav className="t-d-sessions" aria-label={t("ui.screens-plugins.chat-sessions")}>
      <Button variant="primary" icon="plus" onClick={onNew}>
        {t("ui.screens-plugins.chat-new-conversation")}
      </Button>
      <SearchField
        label={t("ui.screens-plugins.chat-search-sessions")}
        value={query}
        placeholder={t("ui.screens-plugins.chat-sessions-sessionlist")}
        onChange={onQuery}
      />
      <div className="t-d-sessions__list">
        {group(t("ui.screens-plugins.chat-pinned"), pinned)}
        {group(t("ui.screens-plugins.chat-history"), rest)}
        {!sessions.length ? (
          <span className="t-meta">
            {t("ui.screens-plugins.chat-no-session-matches-query", { query })}
          </span>
        ) : null}
      </div>
    </nav>
  );
}

export function ChatFull(props: ChatFullProps) {
  const {
    title,
    continuation,
    composer,
    turns,
    mobile,
    sessionsOpen,
    signedIn,
    onSessions = noop,
    onShrink = noop,
    onClose = noop,
    onSource = noop,
  } = props;
  const { t, plural } = useText();
  const sourceKind = useSourceKind();
  const { boxRef, roomRef, onScroll } = useConversationScroll(scrollKeys(turns, props.follow));
  const allSources = turns
    .flatMap((turn) => turn.answer?.sources ?? [])
    .filter((s, i, all) => all.findIndex((o) => o.ref === s.ref && o.line === s.line) === i);
  const list = <SessionList {...props} />;
  return (
    <section
      className="t-d-full"
      data-mobile={mobile || undefined}
      aria-label={t("ui.screens-plugins.chat-ask-atlas")}
    >
      {mobile ? null : <aside className="t-d-full__left">{list}</aside>}
      <div className="t-d-full__main">
        <header className="t-d-full__head">
          {mobile ? (
            <IconButton
              icon="menu"
              label={t("ui.screens-plugins.chat-sessions")}
              onClick={onSessions}
            />
          ) : null}
          <span className="t-d-dock__orb" aria-hidden="true">
            <Icon name="spark" size={14} />
          </span>
          <div className="t-stack" style={{ gap: 0, minWidth: 0, flex: 1 }}>
            <span className="t-h3 t-wrap">{title}</span>
            {continuation ? (
              <span className="t-meta t-row" style={{ gap: 6 }}>
                <span className={`t-dot t-dot--${CONT_TONE[continuation]}`} />{" "}
                {t(CONT_KEY[continuation])} ·{" "}
                {plural("ui.screens-plugins.chat-count-rounds", turns.length)}
              </span>
            ) : null}
          </div>
          <IconButton
            icon="collapse"
            label={t("ui.screens-plugins.chat-dock")}
            onClick={onShrink}
          />
          <IconButton icon="close" label={t("ui.screens-plugins.chat-close")} onClick={onClose} />
        </header>
        <div
          className="t-d-full__scroll"
          ref={boxRef}
          onScroll={onScroll}
          data-testid="chat-scroll"
        >
          <div className="t-d-full__col">
            <Conversation {...props} />
          </div>
          <Room roomRef={roomRef} />
        </div>
        {signedIn === false ? null : (
          <div className="t-d-full__foot">
            <div className="t-d-full__col">
              <Notice text={props.notice} />
              <Composer {...composer} />
            </div>
          </div>
        )}
      </div>
      {mobile ? null : (
        <aside
          className="t-d-full__right"
          aria-label={t("ui.screens-plugins.chat-sources-session")}
        >
          <span className="t-label">
            {t("ui.screens-plugins.chat-sources-count", { count: allSources.length })}
          </span>
          {allSources.map((s, i) => (
            <button
              key={`${s.ref}${i}`}
              type="button"
              className="t-d-srccard"
              onClick={() => onSource(s)}
            >
              <span className="t-row" style={{ gap: 6 }}>
                <Icon name={SOURCE_ICON[s.kind]} size={14} />
                <span className="t-meta">{sourceKind(s.kind)}</span>
                <span className="t-spacer" />
                <span className="t-d-source__n t-mono">{i + 1}</span>
              </span>
              <span className="t-mono t-wrap">
                {s.ref}
                {/** i18n-spacing: joined */}
                {s.line ? `:${s.line}` : ""}
              </span>
              {s.excerpt ? <code className="t-d-srccard__excerpt">{s.excerpt}</code> : null}
            </button>
          ))}
          {!allSources.length ? (
            <span className="t-meta">{t("ui.screens-plugins.chat-no-source-yet")}</span>
          ) : null}
        </aside>
      )}
      {mobile ? (
        <Sheet
          open={!!sessionsOpen}
          side="bottom"
          title={t("ui.screens-plugins.chat-sessions")}
          onClose={onSessions}
        >
          {list}
        </Sheet>
      ) : null}
    </section>
  );
}
