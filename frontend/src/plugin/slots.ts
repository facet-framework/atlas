/** Mount plugin contributions in host-owned slots with closed shadow roots.
 * Shadow roots encapsulate rendering; plugin modules still share the host realm. */

import { placeKey, type Seen } from "./seen";
import type { PlacePublic } from "./context";
import "./slots.css";

/** Where on a surface a plugin may mount. Named, never a CSS selector. */
export type SlotName = "surface.section" | "record.panel" | "scenario.panel" | "header.action";

/** Everything the host knows about one mounted slot. */
export type SlotMount = {
  /** Which slot this is. */
  slot: SlotName;
  /** The plugin that asked for it, for the log and for teardown. */
  plugin: string;
  /** What the plugin renders into. A closed shadow root, never a host node. */
  root: ShadowRoot;
};

/** What a plugin supplies when it mounts. */
export type SlotRenderer = (root: ShadowRoot, place: PlacePublic) => void;

type Registration = {
  slot: SlotName;
  plugin: string;
  render: SlotRenderer;
  /** Only mount where the reader is in this role. Absent means every role. */
  role?: string;
};

/** The host's side of `atlas.slots`. */

// @facet: workspace/contracts/plugin-slots
// @facet-role: primary
export class SlotRegistry {
  private registrations: Registration[] = [];
  private mounted = new Map<Element, SlotMount>();
  private rendered = new WeakMap<Element, Set<Registration>>();
  private revision = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  version = (): number => this.revision;

  /** Records that a plugin wants a slot. Nothing is drawn here. */

  register(plugin: string, slot: SlotName, render: SlotRenderer, role?: string): void {
    this.registrations.push({ slot, plugin, render, role });
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  /** Which plugins want this slot, in registration order. */
  for(slot: SlotName, role: string): Registration[] {
    return this.registrations.filter(
      (r) => r.slot === slot && (r.role === undefined || r.role === role),
    );
  }

  /** Draws every registration for a slot into the host node. */

  mount(host: Element, slot: SlotName, place: PlacePublic, seen?: Seen): SlotMount[] {
    const mounts: SlotMount[] = [];
    const rendered = this.rendered.get(host) ?? new Set<Registration>();
    this.rendered.set(host, rendered);
    for (const reg of this.for(slot, place.role)) {
      if (rendered.has(reg)) continue;
      const holder = document.createElement("div");
      holder.dataset.facetPlugin = reg.plugin;
      const key = placeKey(reg.plugin, slot);
      holder.dataset.plslot = key;

      // never inside it: the plugin cannot see, move or keep it. A click or
      // a focus inside the slot — both cross the closed shadow boundary as
      // events on the holder — is the reader having seen it.
      host.appendChild(holder);
      if (seen?.isNew(key)) this.glow(holder, key, seen);

      // Closed, not open: an open root is readable through element.shadowRoot,
      // and then the boundary is a suggestion.
      const root = holder.attachShadow({ mode: "closed" });
      const mount: SlotMount = { slot, plugin: reg.plugin, root };
      this.mounted.set(holder, mount);
      mounts.push(mount);

      // One plugin that throws keeps its empty holder and loses only its own
      // drawing; the next registration in this slot is still drawn.
      try {
        reg.render(root, place);
      } catch (cause) {
        holder.dataset.facetFailed = cause instanceof Error ? cause.message : String(cause);
      }
      rendered.add(reg);
    }
    return mounts;
  }

  /** Draws one place's glow beside an already-mounted holder, and the
   * listener that puts it out on a click or a focus. Shared by `mount`
   * (drawn because nobody has seen the place yet) and `notify` (drawn
   * because a plugin just said the place has something new again) — the
   * dot and its removal behave identically either way. */

  private glow(holder: HTMLElement, key: string, seen: Seen): void {
    const glow = document.createElement("i");
    glow.className = "plugin-glow";
    glow.setAttribute("aria-hidden", "true");
    glow.dataset.testid = `slot-glow-${key}`;
    glow.dataset.glowFor = key;
    holder.after(glow);
    const seenHandler = () => {
      seen.mark(key);
      // The same slot can stand on several surfaces at once; using one
      // is having seen the place, so every one of its glows goes out.
      for (const g of document.querySelectorAll(`[data-glow-for="${CSS.escape(key)}"]`)) g.remove();
      holder.removeEventListener("click", seenHandler);
      holder.removeEventListener("focusin", seenHandler);
    };
    holder.addEventListener("click", seenHandler);
    holder.addEventListener("focusin", seenHandler);
  }

  notify(key: string, on: boolean, seen: Seen): void {
    seen.set(key, on);
    if (!on) {
      for (const g of document.querySelectorAll(`[data-glow-for="${CSS.escape(key)}"]`)) g.remove();
      return;
    }
    for (const holder of document.querySelectorAll(`[data-plslot="${CSS.escape(key)}"]`)) {
      if (holder.nextElementSibling?.getAttribute("data-glow-for") === key) continue;
      this.glow(holder as HTMLElement, key, seen);
    }
  }

  /** Takes every slot under this host node away again. */

  unmount(host: Element): void {
    this.rendered.delete(host);
    for (const child of Array.from(host.children)) {
      this.mounted.delete(child);
      child.remove();
    }
  }

  /** How many slots are live. For the host's own reporting, not for a plugin. */
  get liveCount(): number {
    return this.mounted.size;
  }
}
