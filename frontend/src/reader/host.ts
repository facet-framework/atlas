/** What the host tells the reader beyond the corpus: repository state, the
 * companion's sign-in, the MCP tools and the installed plugins. Each comes
 * from the host endpoint; a host that cannot answer leaves the
 * value `null` (not asked yet or not answered), never a guess. */

import { useEffect, useState } from "react";
import { agentState, type AgentState } from "@/model";
import { readRepoState, type RepoState } from "@/repo";
import { readMcpTools, type McpTools } from "@/mcpTools";
import { fetchInstalledPlugins, type InstalledPluginListing } from "@/plugin/installed";
import { readTestReport, type TestReportReader } from "./test-report";

export type HostInfo = {
  repo: RepoState | null;
  repoError: string | null;
  agent: AgentState | null;
  /** When the companion state was last asked, ISO; `null` before the first answer. */
  agentCheckedAt: string | null;
  tools: McpTools | null;
  installed: InstalledPluginListing[] | null;
};

export const NO_HOST: HostInfo = {
  repo: null,
  repoError: null,
  agent: null,
  agentCheckedAt: null,
  tools: null,
  installed: null,
};

export type HostReaders = {
  repo: () => Promise<RepoState>;
  agent: () => Promise<AgentState | null>;
  tools: () => Promise<McpTools>;
  installed: () => Promise<InstalledPluginListing[]>;
  /** The judged test report; absent = this host has none to ask. */
  testReport?: TestReportReader;
};

const live: HostReaders = {
  repo: () => readRepoState(),
  agent: () => agentState(),
  tools: () => readMcpTools(),
  installed: () => fetchInstalledPlugins(),
  testReport: () => readTestReport(),
};

/** Where the bench reads the test report from: the live host unless the readers say otherwise. */
export function testReportReader(readers: HostReaders | null | undefined): TestReportReader | null {
  if (readers === null) return null;
  if (readers === undefined) return typeof fetch === "function" ? live.testReport! : null;
  return readers.testReport ?? null;
}

/** Ask the host once; `recheck` asks for the companion state again. */
export function useHostInfo(readers: HostReaders | null = live) {
  const [info, setInfo] = useState<HostInfo>(NO_HOST);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!readers || (readers === live && typeof fetch !== "function")) return;
    let alive = true;
    const put = (patch: Partial<HostInfo>) => alive && setInfo((i) => ({ ...i, ...patch }));
    readers.repo().then(
      (repo) => put({ repo }),
      (e: unknown) => put({ repoError: e instanceof Error ? e.message : String(e) }),
    );
    readers.tools().then(
      (tools) => put({ tools }),
      // A host that refused the list answered: its reason stands, never an empty list.
      (e: unknown) =>
        put({
          tools: {
            available: false,
            reason: e instanceof Error ? e.message : String(e),
            tools: [],
          },
        }),
    );
    readers.installed().then(
      (installed) => put({ installed }),
      () => put({ installed: null }),
    );
    return () => {
      alive = false;
    };
  }, [readers]);
  useEffect(() => {
    if (!readers || (readers === live && typeof fetch !== "function")) return;
    let alive = true;
    readers.agent().then(
      (agent) =>
        alive && setInfo((i) => ({ ...i, agent, agentCheckedAt: new Date().toISOString() })),
      () => alive && setInfo((i) => ({ ...i, agentCheckedAt: new Date().toISOString() })),
    );
    return () => {
      alive = false;
    };
  }, [readers, round]);
  return { info, recheck: () => setRound((n) => n + 1) };
}
