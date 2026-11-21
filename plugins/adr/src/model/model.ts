/** The ADR model — one entry per file `repo.list` named, its header lines
 * read out of the body `repo.read` answered. */

import type { AdrFileEntry } from "../host";
import { parseHead, type AdrHead, type AdrStatus } from "./headers";

export type AdrEntry = AdrHead & {
  path: string;
  number: string;
  slug: string;
  /** The raw markdown body, unparsed beyond the header lines above. */
  body: string;
  /** The host's refusal when this one file could not be read, or `null`.
   * One unreadable file is shown on its own entry, never as a failure of the
   * whole area: the list already names only what the host would read
   * (`ListRepoFiles`), so a refusal here is the rare case — a file grown past
   * the size limit, removed between list and read — and it is that file's. */

  errorState: string | null;
};

export type AdrModel = {
  directory?: string;
  entries: AdrEntry[];
};

/** Builds the model from the host's raw list and each file's raw body; a file
 * named in `errors` instead of `bodies` becomes an entry carrying that text. */

export function buildAdr(
  files: AdrFileEntry[],
  bodies: Record<string, string>,
  errorState: Record<string, string> = {},
): AdrModel {
  const entries = files.map((file) => {
    const body = bodies[file.path] ?? "";
    return {
      ...parseHead(body),
      path: file.path,
      number: file.number,
      slug: file.slug,
      body,
      errorState: errorState[file.path] ?? null,
    };
  });
  return { entries };
}

/** The directory as a repository path: no leading `./`, no trailing `/`. */
function directoryOf(model: AdrModel): string {
  return (model.directory ?? "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/^\.$/, "");
}

/** An entry's address in the repository: the directory `repo.list` read joined
 * with the entry's path, the form a record writes when it names a decision
 * (`docs/adr/0001-offline-first-storage.md`). Without a known directory it is
 * the entry's own path. */

export function entryAddress(model: AdrModel, entry: AdrEntry): string {
  const dir = directoryOf(model);
  return dir ? `${dir}/${entry.path}` : entry.path;
}

/** Every entry an address could name. `repo.list` answers paths relative to the
 * decision directory, while a record names a decision by its repository path,
 * so both are matched: the repository path (also a tail of it, such as
 * `adr/0001-x.md`), the path in the directory, and — what `/adr` and records
 * that cite by name offer — the number (leading zeros and an `ADR-` prefix
 * optional) or the slug. Several entries can share a number or a slug; they
 * are all answered, so a caller never picks one of them by list order. A path
 * with a directory that is not the decision directory names nothing. */

export function matchEntries(model: AdrModel, address: string): AdrEntry[] {
  const raw = address.trim().replace(/^\.\//, "");
  if (!raw) return [];
  const byPath = model.entries.filter((e) => {
    const full = entryAddress(model, e);
    return e.path === raw || full === raw || full.endsWith(`/${raw}`);
  });
  if (byPath.length || raw.includes("/")) return byPath;
  const wanted = raw.toLowerCase().replace(/\.md$/, "");
  const numbered = /^(?:adr[-_ ]?)?(\d+)$/.exec(wanted);
  if (numbered) {
    const n = Number(numbered[1]);
    return model.entries.filter(
      (e) => e.number !== "" && Number(e.number) === n,
    );
  }
  return model.entries.filter(
    (e) => e.slug === wanted || `${e.number}-${e.slug}` === wanted,
  );
}

/** The one entry an address names, or `undefined` when it names none or more
 * than one (two decisions numbered 0007): the area then shows the front page
 * rather than an empty reader or the wrong decision. */

export function findEntry(
  model: AdrModel,
  address: string,
): AdrEntry | undefined {
  const found = matchEntries(model, address);
  return found.length === 1 ? found[0] : undefined;
}

/** Counts entries per known status, in the fixed order the rail shows them. */
export const KNOWN_STATUSES: readonly AdrStatus[] = [
  "proposed",
  "accepted",
  "superseded",
  "rejected",
];

export function countByStatus(model: AdrModel): Record<AdrStatus, number> {
  const counts = {
    proposed: 0,
    accepted: 0,
    superseded: 0,
    rejected: 0,
  } as Record<AdrStatus, number>;
  for (const entry of model.entries) {
    if (entry.status) counts[entry.status] += 1;
  }
  return counts;
}
