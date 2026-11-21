/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { createContext, useContext, type ReactNode } from "react";
import type { Call } from "./wiki/host";

const CallContext = createContext<Call | null>(null);

export function CallProvider({
  call,
  children,
}: {
  call: Call;
  children: ReactNode;
}) {
  return <CallContext.Provider value={call}>{children}</CallContext.Provider>;
}

/**
 * The way to the host, or a refusal.
 *
 * Throwing rather than returning a no-op: a create-wiki run that silently
 * called nothing would be a defect nobody sees.
 */
export function useCall(): Call {
  const call = useContext(CallContext);
  if (!call) {
    throw new Error(
      "useCall outside the CallProvider — the plugin is not mounted.",
    );
  }
  return call;
}

/**
 * The way to the host, or `null` when the plugin is not mounted with one.
 *
 * For surfaces that add something to a page and show nothing when there is no
 * host to ask — as opposed to `useCall`, which refuses.
 */
export function useOptionalCall(): Call | null {
  return useContext(CallContext);
}
