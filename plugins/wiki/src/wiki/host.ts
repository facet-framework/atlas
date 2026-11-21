/**
 * Create and publish wiki pages through repository tools on the host bus.
 */
/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { tx } from "../../../../frontend/src/i18n";
import type { BusCallResult } from "../../../../frontend/src/plugin/host";
import type { RepoState as CheckoutState } from "../../../../frontend/src/plugin/components";
export type RepoState = CheckoutState & { wiki?: boolean; wikiDir?: string };

const STATE_TOOL = "repo.state";
const BRANCH_TOOL = "repo.branch";
const WRITE_TOOL = "repo.write";
const COMMIT_TOOL = "repo.commit";
const PR_TOOL = "repo.pr";

/** The steps, in the order they run. */
export type WikiCreateStep = "branch" | "page" | "commit" | "pr";

/**
 * What one run achieved — including, and especially, when it broke off
 * partway.
 *
 * `done` collects the steps that landed and is **not** cleared on failure.
 * The host does not roll back a commit because the network refused it ("what
 * was written is the work"), and a surface that reported "failed" without
 * the rest would take from the reader exactly the information they need to
 * continue by hand.
 */
export type WikiCreated = {
  done: WikiCreateStep[];
  branch: string;
  /** Worktree measured when the branch was opened; retained on pre-push failure. */
  worktree?: string;
  path: string;
  /** The address the page will be reachable at. */
  address: string;
  /**
   * Whether it was written without git — no branch, no worktree, no commit.
   *
   * From the host, not guessed here: `repo.branch` says so, because that is
   * where the measurement lives.
   */
  unversioned?: boolean;
  sha?: string;
  pushed?: boolean;
  url?: string;
  /** What the host said about the last step, when it had something to say. */
  note?: string;
  /** The two commands to continue by hand, when the host names them. */
  hint?: string;
  /** The step it hung on — absent when nothing hung. */
  failedAt?: WikiCreateStep;
  error?: string;
};

/** An error that knows which step it happened at. */
export class WikiHostError extends Error {
  constructor(
    readonly step: WikiCreateStep,
    message: string,
  ) {
    super(message);
    this.name = "WikiHostError";
  }
}

/** What `atlas.bus.call` looks like — as a parameter, so a test can supply a fake. */
export type Call = (tool: string, args?: unknown) => Promise<BusCallResult>;

/**
 * Calls one repo.* tool through the plugin's own door and unwraps its
 * answer.
 *
 * `{ok:false, denied}` and `{ok:false, error}` both become a `WikiHostError`
 * carrying the host's own text, unchanged: it already names which rule was
 * broken, and rewording it here would be a second place for that wording to
 * go stale.
 */
async function post(
  call: Call,
  tool: string,
  args: unknown,
  step: WikiCreateStep,
): Promise<Record<string, unknown>> {
  const result = await call(tool, args);
  if (!result.ok) {
    throw new WikiHostError(
      step,
      "denied" in result ? result.denied : result.error,
    );
  }
  return (result.result as Record<string, unknown>) ?? {};
}

/** Asks the host what it found — through the plugin's own door. */
export async function readWikiState(call: Call): Promise<RepoState> {
  const result = await post(call, STATE_TOOL, {}, "branch");
  return result as unknown as RepoState;
}

/**
 * The header fields of a new page — as **fields**, not as finished text.
 *
 * Writing YAML here would mean re-implementing the host's own quoting rule
 * (`wikiScalar`) a second time. `reviewed` is absent and has no field — that
 * date says a person confirmed the content, and nobody has.
 */
export type WikiFrontFields = {
  title: string;
  category?: string;
  summary?: string;
  status?: string;
  tags?: string[];
  records?: string[];
  /** The prose under the header, empty for a new page's scaffold. */
  body?: string;
};

/**
 * Creates the wiki: branch, first page, commit, and — where it can — the
 * pull request.
 *
 * `onStep` reports **every** step before it runs. Without that, the surface
 * would show the first label while the fourth call was already running.
 *
 * The pull request is the only step whose absence is **not** an error.
 * Without a token or on a foreign forge, the branch and the commit still
 * stand; the host says so explicitly rather than swallowing it (the specification), and
 * this function passes that on unchanged.
 */
export async function createWiki(
  input: {
    branch: string;
    path: string;
    front: WikiFrontFields;
    message: string;
    title: string;
  },
  call: Call,
  onStep?: (step: WikiCreateStep) => void,
): Promise<WikiCreated> {
  return proposePage(
    {
      branch: input.branch,
      path: input.path,
      write: { front: input.front },
      message: input.message,
      title: input.title,
      prText: prBody(input.path),
    },
    call,
    onStep,
  );
}

/**
 * The flow both creating and editing a page run: branch, write, commit,
 * push. `write` is the part of the `repo.write` call that differs — the
 * header fields for a new page, `editBody` plus `ifMatch` for an edit.
 */
export async function proposePage(
  input: {
    branch: string;
    path: string;
    write: Record<string, unknown>;
    message: string;
    title: string;
    prText: string;
  },
  call: Call,
  onStep?: (step: WikiCreateStep) => void,
): Promise<WikiCreated> {
  const out: WikiCreated = {
    done: [],
    branch: input.branch,
    path: input.path,
    address: `wiki:${input.path.replace(/\.md$/, "")}`,
  };
  const step = (next: WikiCreateStep) => onStep?.(next);

  try {
    step("branch");
    const opened = await post(
      call,
      BRANCH_TOOL,
      { branch: input.branch },
      "branch",
    );
    out.unversioned = opened.unversioned === true;
    if (typeof opened.branch === "string") out.branch = opened.branch;
    if (typeof opened.worktree === "string" && opened.worktree)
      out.worktree = opened.worktree;
    out.done.push("branch");

    step("page");
    const page = await post(
      call,
      WRITE_TOOL,
      { branch: input.branch, path: input.path, ...input.write },
      "page",
    );
    if (typeof page.path === "string") out.path = page.path;
    out.done.push("page");

    if (out.unversioned) {
      // The run ends here, and it ends **completely**: the page is where the
      // reader reads it. Calling the two next steps would produce refusals
      // that look like failures where nothing failed.
      return out;
    }

    step("commit");
    const commit = await post(
      call,
      COMMIT_TOOL,
      { branch: input.branch, message: input.message },
      "commit",
    );
    if (typeof commit.sha === "string") out.sha = commit.sha;
    out.done.push("commit");
  } catch (caught) {
    // What stood, stays standing. `done` is not cleared.
    out.failedAt = caught instanceof WikiHostError ? caught.step : "branch";
    out.error = caught instanceof Error ? caught.message : String(caught);
    return out;
  }

  // From here on nothing is an error any more: the branch is pushed or it is
  // not, and neither takes the commit's validity away.
  try {
    step("pr");
    const pr = await post(
      call,
      PR_TOOL,
      { branch: input.branch, title: input.title, body: input.prText },
      "pr",
    );
    out.pushed = pr.pushed === true;
    if (typeof pr.url === "string" && pr.url) out.url = pr.url;
    if (typeof pr.message === "string" && pr.message) out.note = pr.message;
    if (typeof pr.hint === "string" && pr.hint) out.hint = pr.hint;
    if (out.pushed) out.done.push("pr");
  } catch (caught) {
    out.pushed = false;
    out.note = caught instanceof Error ? caught.message : String(caught);
  }
  return out;
}

/** The pull request body — what it is, and what it explicitly is not. */
function prBody(path: string): string {
  return [
    tx("ui.wiki-src-wiki.host-first-page-wiki-path", { path: `\`${path}\`` }),
    "",
    tx("ui.wiki-src-wiki.host-directory-created-git-cannot-commit-empty"),
    "",
    tx("ui.wiki-src-wiki.host-area-not-declared-there-no-wiki", {
      note: `\`${tx("ui.wiki-src-wiki.host-area-not-declared")}\``,
    }),
  ].join("\n");
}

/**
 * The branch name for a slug.
 *
 * Under `wiki/`, so it is recognisable as what it is, and because the host
 * refuses every default branch — a branch under a prefix cannot be one.
 */
export function wikiBranchName(slug: string): string {
  return `wiki/${slug || "first-page"}`;
}

/** The SHA-256 of a page's bytes as hex — what the host's `WikiDigest` computes. */
export async function pageDigest(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const sum = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(sum), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Proposes a changed body for an existing page as a branch and a pull
 * request.
 *
 * Only the body travels. The head of the page is never sent: the host takes
 * it, byte for byte, from the file it already holds, so `reviewed`,
 * `aliases`, `mirror` and the author's formatting survive. `raw` is the page
 * exactly as it was read — its digest is the `ifMatch` that makes the host
 * refuse the edit when the page changed meanwhile.
 */
export async function editPage(
  input: { path: string; raw: string; body: string; title: string },
  call: Call,
  onStep?: (step: WikiCreateStep) => void,
): Promise<WikiCreated> {
  const slug = branchSlug(input.path);
  // Unique per edit: the host keeps the first session of a branch name open
  // with that edit on it, so a second edit of the same page under the same
  // name would be compared against the branch and not against the page the
  // reader sees.
  const branch = wikiBranchName(`edit-${slug}-${stamp()}`);
  let ifMatch: string;
  try {
    ifMatch = await pageDigest(input.raw);
  } catch (caught) {
    return {
      done: [],
      branch,
      path: input.path,
      address: `wiki:${input.path.replace(/\.md$/, "")}`,
      failedAt: "page",
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
  return proposePage(
    {
      branch,
      path: input.path,
      write: { editBody: input.body, ifMatch },
      message: `docs(wiki): ${input.title}`,
      title: `docs(wiki): ${input.title}`,
      prText: tx("ui.wiki-src-wiki.host-body-path-has-changed-header-byte", {
        path: `\`${input.path}\``,
      }),
    },
    call,
    onStep,
  );
}

/** A short, sortable suffix that differs between two edits. */
function stamp(): string {
  return Date.now().toString(36);
}

/**
 * The part of an edit branch's name that comes from the path.
 *
 * The host caps a branch name at 101 characters (`wikiBranchRe`). With the
 * `wiki/edit-` prefix and a `-<stamp>` suffix that leaves 80 for the slug; a
 * longer path is cut and given a short hash of the whole path, so two long
 * paths with the same start still get different names, and the same path
 * always gets the same slug.
 */
export function branchSlug(path: string): string {
  const slug = path.replace(/\.md$/, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  if (slug.length <= 80) return slug;
  let h = 5381;
  for (let i = 0; i < path.length; i++)
    h = ((h * 33) ^ path.charCodeAt(i)) >>> 0;
  return `${slug.slice(0, 71)}-${h.toString(36).padStart(7, "0").slice(0, 8)}`;
}
