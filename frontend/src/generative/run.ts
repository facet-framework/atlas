import i18n, { tx } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAgent, type AgentStream } from "@/model";
import type { DerivedModel } from "../derive";
import type { GeneratedGenTile } from "./tiles";
import { hashContext } from "./context";
import { hostText, keepingSignInCodes, type SignInCodes } from "../ask/hostText";
import type { GenEntry, GenStorage } from "./storage";

/** What a single running tile looks like while its stream is open. */
export type GenRunState = {
  phase: string;
  text: string;
  /** How many `read` steps have arrived, capped at the tile's own context size. */
  read: number;
};

export type GenRuns = Record<string, GenRunState>;

type Options = {
  v: DerivedModel;
  model?: string | null;
  openStream?: (url: string) => AgentStream;
  storageResult: GenStorage;
  onWrite: (id: string, entry: GenEntry) => void;
  onSignIn: (reason: string) => void;
};

/** How the answer is to be written — sent after the instruction. */

const spelling = (): string => tx("ui.generative.run-read-named-record-files-anchor-files");

/** One record as the agent sees it: where it lives and what Atlas measured about it. */
function recordZeile(f: DerivedModel["M"][number]): string {
  const parts = [
    `- ${f.id} (${f.rec.path}): ${f.summary || tx("ui.generative.run-without-summary")}`,
    tx("ui.generative.run-acceptance-criteria-claims-which-test-link", {
      claims: f.claims,
      proven: f.proven,
      open: f.open,
    }),
  ];
  if (f.deps.length) parts.push(tx("ui.generative.run-requires-ids", { ids: f.deps.join(", ") }));
  if (f.usedBy.length)
    parts.push(tx("ui.generative.run-required-n-records", { n: f.usedBy.length }));
  const files = [...new Set(f.anchors.map((a) => a.path))].slice(0, 4);
  if (files.length) parts.push(tx("ui.generative.run-anchors-files", { files: files.join(", ") }));
  return parts.join("\n");
}

/** The question sent to the agent: the instruction, how to answer, then the named records. */
export function questionForTile(v: DerivedModel, tile: GeneratedGenTile): string {
  const rows = tile.ctx
    .map((id) => v.byId[id])
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .map(recordZeile)
    .join("\n");
  return rows
    ? `${tile.request}\n\n${spelling()}\n\nRecords:\n${rows}`
    : `${tile.request}\n\n${spelling()}`;
}

export function useGenRuns({ v, model, openStream, storageResult, onWrite, onSignIn }: Options) {
  const [runs, setRuns] = useState<GenRuns>({});
  const [failedWithoutText, setFailedWithoutText] = useState<Record<string, string>>({});
  const closers = useRef<Map<string, () => void>>(new Map());
  const storageRef = useRef(storageResult);
  useEffect(() => {
    storageRef.current = storageResult;
  }, [storageResult]);

  const running = useCallback((id: string) => closers.current.has(id), []);

  const start = useCallback(
    (tile: GeneratedGenTile) => {
      if (closers.current.has(tile.id)) return;
      setRuns((prev) => ({
        ...prev,
        [tile.id]: {
          phase: tx("ui.generative.run-context-n-records", { n: tile.ctx.length }),
          text: "",
          read: 0,
        },
      }));
      setFailedWithoutText((prev) => {
        if (!(tile.id in prev)) return prev;
        const { [tile.id]: _removed, ...rest } = prev;
        return rest;
      });

      const finish = (mutate: (prev: GenRuns) => GenRuns) => {
        closers.current.delete(tile.id);
        setRuns(mutate);
      };

      // The sign-in step's codes are read off the event the library is about
      // to handle, so a coded host sentence reaches the tile in the reader's
      // language (see hostText.ts).
      let signInCodes: () => SignInCodes = () => ({});
      const open = (url: string): AgentStream => {
        const kept = keepingSignInCodes(openStream ? openStream(url) : new EventSource(url));
        signInCodes = kept.codes;
        return kept.stream;
      };

      const close = askAgent(
        questionForTile(v, tile),
        {
          onRead: (target) => {
            setRuns((prev) => {
              const cur = prev[tile.id];
              if (!cur) return prev;
              const read = Math.min(cur.read + 1, tile.ctx.length);
              return {
                ...prev,
                [tile.id]: {
                  ...cur,
                  read,
                  phase: read >= tile.ctx.length ? "writes" : `reads ${target}`,
                },
              };
            });
          },
          onText: (text) => {
            setRuns((prev) => {
              const cur = prev[tile.id];
              if (!cur) return prev;
              return { ...prev, [tile.id]: { ...cur, text: cur.text + text, phase: "writes" } };
            });
          },
          onSignIn: (reason) => {
            finish((prev) => {
              const { [tile.id]: _removed, ...rest } = prev;
              return rest;
            });
            onSignIn(hostText(signInCodes().textCode, reason));
          },
          onError: (error) => {
            const presentValue = storageRef.current[tile.id];
            if (presentValue) {
              onWrite(tile.id, { ...presentValue, err: error.message });
            } else {
              setFailedWithoutText((prev) => ({ ...prev, [tile.id]: error.message }));
            }
            finish((prev) => {
              const { [tile.id]: _removed, ...rest } = prev;
              return rest;
            });
          },
          onDone: () => {
            setRuns((prev) => {
              const cur = prev[tile.id];
              const text = cur?.text ?? "";
              if (text) {
                onWrite(tile.id, {
                  text,
                  ctxN: tile.ctx.length,
                  ofN: v.M.length,
                  model: model || "—",
                  at: Date.now(),
                  hash: hashContext(v, tile.ctx),
                  lang: i18n.resolvedLanguage ?? i18n.language,
                });
              }
              const { [tile.id]: _removed, ...rest } = prev;
              return rest;
            });
            closers.current.delete(tile.id);
          },
        },
        { model: model ?? null, open },
      );
      closers.current.set(tile.id, close);
    },
    [v, model, openStream, onWrite, onSignIn],
  );

  return { runs, start, running, failedWithoutText };
}
