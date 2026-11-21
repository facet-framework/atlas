/**
 * The plugin's own way of reaching the verbs it was handed.
 *
 * Its components used `useNav()` — the core's navigation context — and with
 * it the core's whole surface: fifteen verbs, including the ones the
 * permission model withholds. `Reference.tsx` called `openSheet("term", …)`,
 * which `WITHHELD_VERBS` names as forbidden because one of that verb's kinds
 * is the companion, and the companion carries the reader's own conversation.
 *
 * Nothing was broken to do that. An import was enough, and that is the point:
 * a boundary that a normal import crosses is not a boundary. The plugin
 * carries its own context, filled once from `atlas.verbs`, and reaches
 * exactly what the host offered it.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { createContext, useContext, type ReactNode } from "react";
import type { PluginVerbs } from "../../../frontend/src/plugin/verbs";

const VerbsContext = createContext<PluginVerbs | null>(null);

export function VerbsProvider({
  verbs,
  children,
}: {
  verbs: PluginVerbs;
  children: ReactNode;
}) {
  return (
    <VerbsContext.Provider value={verbs}>{children}</VerbsContext.Provider>
  );
}

/**
 * The verbs, or a refusal.
 *
 * Throwing rather than returning a no-op object: a component that quietly did
 * nothing when clicked would be a defect nobody sees. This says which of the
 * two happened.
 */
export function useVerbs(): PluginVerbs {
  const verbs = useContext(VerbsContext);
  if (!verbs) {
    throw new Error(
      "useVerben outside the VerbenProvider — the plugin is not mounted.",
    );
  }
  return verbs;
}
