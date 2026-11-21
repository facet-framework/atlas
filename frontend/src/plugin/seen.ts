export const SEEN_KEY = "facet.atlas.plugin-seen";

function storageResult(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The key for one of a plugin's places. */
export function placeKey(plugin: string, place: string): string {
  return `${plugin}:${place}`;
}

export class Seen {
  private readonly keys: Set<string>;
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(private readonly store: Storage | null = storageResult()) {
    this.keys = new Set(this.read());
  }

  /** Whether this place has not been seen yet. */
  isNew(key: string): boolean {
    return !this.keys.has(key);
  }

  /** The reader has seen this place; its dot goes out and stays out. */
  mark(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.write();
  }

  forget(disabled: readonly string[]): void {
    const off = new Set(disabled);
    let changed = false;
    for (const key of [...this.keys]) {
      if (off.has(key.slice(0, key.indexOf(":")))) {
        this.keys.delete(key);
        changed = true;
      }
    }
    if (changed) this.write();
  }

  set(key: string, on: boolean): void {
    if (!on) {
      this.mark(key);
      return;
    }
    if (!this.keys.has(key)) return;
    this.keys.delete(key);
    this.write();
  }

  /** For `useSyncExternalStore`: a number that changes whenever a key does. */
  version = (): number => this.revision;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private read(): string[] {
    try {
      const raw = this.store?.getItem(SEEN_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      // Unreadable memory is no memory: every place is new, which is the
      // honest reading of "nobody knows what was seen".
      return [];
    }
  }

  private write(): void {
    this.revision += 1;
    try {
      this.store?.setItem(SEEN_KEY, JSON.stringify([...this.keys].sort()));
    } catch {
      // A full or blocked storage keeps the state for this session only.
    }
    for (const l of this.listeners) l();
  }
}
