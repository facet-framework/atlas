/** The footer under a finished answer: what was read, and what was denied. */

import type { ConversationStep as Step } from "./conversations";

/** The tools whose absence from the agent's reach makes "nothing written" true. */
export const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit", "Bash"] as const;

/** How many distinct files the agent opened. */

export function filesRead(steps: readonly Step[]): number {
  return new Set(steps.filter((s) => s.kind === "Read" && s.target).map((s) => s.target)).size;
}

/** What the agent may use without any plugin: reading and searching only. */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "mcp__facet__rag_query"] as const;

/** Whether the host's two lists back the sentence "nothing written". */

export function writeIsBlocked(blocked: unknown, allowed: unknown): boolean {
  if (!Array.isArray(blocked) || !Array.isArray(allowed)) return false;
  const readOnly: readonly unknown[] = READ_ONLY_TOOLS;
  return (
    WRITE_TOOLS.every((tool) => blocked.includes(tool)) &&
    allowed.every((tool) => readOnly.includes(tool))
  );
}

/** The files that were read, each with its line range where the Read call
 * carried one. */

export function sourcesRead(steps: readonly Step[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const s of steps) {
    if (s.kind !== "Read" || !s.target) continue;
    const label = s.lines ? `${s.target}:${s.lines}` : s.target;
    seen.set(label, label);
  }
  return [...seen.keys()].map((label) => ({ key: label, label }));
}
