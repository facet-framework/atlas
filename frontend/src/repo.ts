import { tx } from "@/i18n";

/** What the host found, before anything is offered. */

export type RepoState = {
  /** A real indexed checkout that has not been initialized; absent otherwise. */
  initialization?: { path: string; command: string };
  /** A present Git marker that the host could not read. */
  gitError?: string;
  repository: boolean;
  name?: string;
  branch?: string;
  commit?: string;
  history?: {
    date: string;
    sha: string;
    subject: string;
    files?: string[] | null;
    truncated?: boolean;
  }[];
  historyWindow?: number;
  historyExhausted?: boolean;
  historyTruncated?: boolean;
  shallow?: boolean;
  remote?: string;
  /** `"github"`, `"gitlab"` — or empty, and empty is a real answer. */
  forge?: string;
  /** Where the forge came from: `"git remote"` when the host recognised it,
   * `".facetrc.yaml"` when the project declared it — empty beside neither. */

  forgeSource?: string;
  /** The remote's host — `git.example.com` from
   * `git@code.example:team/project.git`. */

  remoteHost?: string;
  /** The name of the source (`GITHUB_TOKEN`, `gh`), empty when none exists. */
  tokenSource?: string;
  dirty: boolean;

  ignored?: boolean;
};

/** Whether a repository in this state is written without git. */

export function repoWithoutGit(host: RepoState | null): boolean {
  if (!host || host.initialization || host.gitError) return false;
  return !host.repository || host.ignored === true;
}

/** The origin of a forge the host itself read from the remote. */

export const FORGE_FROM_REMOTE = "git remote";

/** The file a project keeps its layout and forge declarations in. */

export const FACETRC = ".facetrc.yaml";

/** What `fetch` must be able to do — as a parameter, so a test can supply one. */
export type Fetcher = typeof fetch;

/** Asks the host what it found — under no plugin identity, because this is
 * the core's own question. */

export async function readRepoState(fetcher: Fetcher = fetch): Promise<RepoState> {
  const response = await fetcher("/api/repo/state");
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      text.trim() || tx("ui.root.repo-host-answered-status", { status: response.status }),
    );
  }
  return text ? (JSON.parse(text) as RepoState) : ({} as RepoState);
}
