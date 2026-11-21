/**
 * The Confluence card on the settings: the state line (where the credential
 * comes from, which instance, when it was last reached), the check that asks
 * the host and the link to connection setup.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@facet-tools/ui";
import { SettingsSection } from "../../../../frontend/src/plugin/components";
import { tx } from "../../../../frontend/src/i18n";
import type { AtlasApi } from "../../../../frontend/src/plugin/host";
import { hostFinding } from "./checker";
import { whatText } from "./state";
import { help as helpTexts } from "./help";
import {
  NOT_REQUESTED,
  answeredText,
  succeeded,
  adopt,
  statusLine,
  type ConnectionState,
} from "./connection";
import { ConfluenceMark } from "./badge";
import "../wiki.css";

export function ConfluenceSide({ atlas }: { atlas: AtlasApi }) {
  const [conf, setConf] = useState<ConnectionState>(NOT_REQUESTED);
  const [checking, setChecking] = useState(false);
  const [unanswered, setUnanswered] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const z = statusLine(conf);
  // The lock lives in a ref and not in state: two clicks in the same batch
  // still see `checking` from before React redraws, and the promise
  // "exactly one request" would be broken before the button ever went
  // `disabled`.
  const runningState = useRef(false);
  // Guards a `check()` promise that resolves after the card has unmounted
  // — a `setState` call on a card the reader already left would not lose
  // anything the reader could see, but React would log the warning anyway.
  const aliveState = useRef(true);
  useEffect(
    () => () => {
      aliveState.current = false;
    },
    [],
  );

  async function check() {
    if (runningState.current) return;
    runningState.current = true;
    setChecking(true);
    try {
      const finding = await hostFinding();
      if (!aliveState.current) return;
      setConf((previous) => adopt(previous, finding));
      setUnanswered(null);
    } catch (caught: unknown) {
      if (!aliveState.current) return;
      // The host's own sentence, verbatim — inventing a status the reader's
      // own machine never measured is exactly what this record forbids.
      setUnanswered(caught instanceof Error ? caught.message : String(caught));
    } finally {
      runningState.current = false;
      if (aliveState.current) setChecking(false);
    }
  }

  const tone = z.latest
    ? succeeded(z.latest)
      ? "ok"
      : "warn"
    : z.withoutAnswer
      ? "warn"
      : "neutral";
  return (
    <SettingsSection
      title={tx("ui.wiki-src-confluence.side-confluence")}
      actions={
        <Button size="small" variant="quiet" onClick={() => setHelp(true)}>
          {tx("ui.wiki-src-confluence.side-how-does-work")}
        </Button>
      }
    >
      <div className="wiki-conf">
        <div className="wiki-conf__card">
          <span className="wiki-conf__icon">
            <ConfluenceMark />
          </span>
          <span className="wiki-conf__name">
            <span className="wiki-conf__title">
              {tx("ui.wiki-src-confluence.side-atlassian-confluence")}
            </span>
            <span className="wiki-conf__instance t-mono">
              {z.instance ??
                (z.requested
                  ? tx("ui.wiki-src-confluence.side-no-instance-environment")
                  : tx("ui.wiki-src-confluence.side-not-asked"))}
            </span>
          </span>
          <Badge tone={tone}>
            {z.withoutAnswer && !z.latest
              ? tx("ui.wiki-src-confluence.side-not-reached")
              : answeredText(z.latest)}
          </Badge>
        </div>

        <div className="wiki-conf__state t-mono" data-testid="conf-state">
          <span>{z.token}</span>
          {z.instance ? (
            <span>
              {tx("ui.wiki-src-confluence.side-instance")} <b>{z.instance}</b>
              {z.instanceSource ? (
                <span>
                  {" "}
                  {tx("ui.wiki-src-confluence.side-from")} {z.instanceSource}
                </span>
              ) : null}
            </span>
          ) : null}
          {z.withoutAnswer ? (
            <span>
              {tx("ui.wiki-src-confluence.side-not-reached")}{" "}
              <span className="t-bad">{z.withoutAnswer}</span>
            </span>
          ) : null}
          {z.latest ? (
            <span>
              {answeredText(z.latest)}{" "}
              <span className={succeeded(z.latest) ? "t-ok" : "t-bad"}>
                ({whatText(z.latest)}, {z.latest.code})
              </span>
            </span>
          ) : z.requested && !z.withoutAnswer ? (
            <span>{answeredText(null)}</span>
          ) : null}
          {z.previous ? (
            <span>
              {tx("ui.wiki-src-confluence.side-before")} {z.previous.t}{" "}
              <span className={succeeded(z.previous) ? "t-ok" : "t-bad"}>
                {whatText(z.previous)} · {z.previous.code}
              </span>
            </span>
          ) : null}
          {unanswered ? (
            <span>
              {tx("ui.wiki-src-confluence.side-reader-s-own-host-not-reached")}{" "}
              <span className="t-bad">{unanswered}</span>
            </span>
          ) : null}
          <Button
            size="small"
            className="wiki-conf__check"
            disabled={checking}
            onClick={() => void check()}
          >
            {checking
              ? tx("ui.wiki-src-confluence.side-checking")
              : tx("ui.wiki-src-confluence.side-check-now")}
          </Button>
        </div>

        <div className="t-row">
          <Button onClick={() => atlas.verbs.openArea("confluence-setup")}>
            {tx("ui.wiki-src-confluence.side-set-up-confluence")}
          </Button>
        </div>
      </div>

      {help ? <PluginHelp onDismiss={() => setHelp(false)} /> : null}
    </SettingsSection>
  );
}

function PluginHelp({ onDismiss }: { onDismiss: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="wiki-help"
      role="dialog"
      aria-modal="true"
      aria-label={tx("ui.wiki-src-confluence.side-how-does-work")}
      ref={box}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="wiki-help__box t-float">
        <header className="t-sheet__head">
          <span className="t-h3 wiki-help__title">
            {tx("ui.wiki-src-confluence.side-how-does-work")}
          </span>
          <Button size="small" onClick={onDismiss}>
            {tx("ui.wiki-src-confluence.side-close")}
          </Button>
        </header>
        <div className="t-sheet__body wiki-help__text">
          {helpTexts().map(([title, sentence]) => (
            <p key={title}>
              <b>{title}</b> {sentence}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
