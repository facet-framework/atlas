/** What a plugin is told, and what it may tell others. */

/** Events the host emits. A closed list: a plugin cannot invent one. */
export const HOST_EVENTS = ["facets.changed", "scan.done"] as const;
export type HostEvent = (typeof HOST_EVENTS)[number];

type Listener = (payload: unknown) => void;

/** A plugin's event name must carry its own id, so a plugin cannot announce in
 * another's name. Checked rather than trusted: the id comes from the manifest
 * the host verified. */

function ownsEvent(plugin: string, event: string): boolean {
  return event.startsWith(plugin + ".");
}

/** The host's side of `atlas.bus`. */

// @facet: customization/execution/plugin-bus
// @facet-role: primary
export class PluginBus {
  private listeners = new Map<string, { plugin: string; fn: Listener }[]>();

  /** Subscribes a plugin to an event. Any plugin may listen to anything. */
  on(plugin: string, event: string, fn: Listener): () => void {
    const list = this.listeners.get(event) ?? [];
    const entry = { plugin, fn };
    list.push(entry);
    this.listeners.set(event, list);
    return () => {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        current.filter((e) => e !== entry),
      );
    };
  }

  /** A plugin announces something of its own. */

  emit(plugin: string, event: string, payload?: unknown): boolean {
    if (!ownsEvent(plugin, event)) {
      return false;
    }
    this.deliver(event, payload);
    return true;
  }

  /** The host announces. Not reachable from a plugin: `emit` requires a plugin
   * id and a host event carries no plugin prefix, so the check refuses it. */

  emitFromHost(event: HostEvent, payload?: unknown): void {
    this.deliver(event, payload);
  }

  private deliver(event: string, payload: unknown): void {
    for (const { fn } of this.listeners.get(event) ?? []) {
      // One plugin's failure is not another's. A throwing listener would
      // otherwise stop delivery for everyone after it in the list.
      try {
        fn(payload);
      } catch {
        /** a plugin that throws is its own problem */
      }
    }
  }

  /** How many subscriptions are live. For the host's reporting. */
  get listenerCount(): number {
    let n = 0;
    for (const list of this.listeners.values()) n += list.length;
    return n;
  }
}
