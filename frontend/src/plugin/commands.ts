/** Searchable slash commands registered by loaded plugins.
 * Selecting a command adds its chip; unloading the plugin removes its commands. */

/** One command, as the reader sees it and as it runs. */
export type SlashCommand = {
  /** What is typed, leading slash included: "/record". */
  readonly command: string;
  /** What the argument is called, shown beside the command and used as the
   * input's placeholder once the chip is set. Absent means the command runs
   * the moment it is chosen. */

  readonly argument?: string;
  /** One line: what it does. */
  readonly purpose: string;
  /** The heading it is filed under — "Records", "Notes", "Chat". */
  readonly group: string;
  /** What running it does. The argument is trimmed, and may be empty. */
  readonly run: (argument: string) => void;
};

/** A command with the plugin that contributed it, or "atlas" for the host. */
export type RegisteredCommand = SlashCommand & { readonly plugin: string };

// @facet: customization/contributions/plugin-commands
// @facet-role: primary
/** The host's side of `atlas.commands`. */
export class CommandRegistry {
  private readonly entries: RegisteredCommand[] = [];
  private readonly listeners = new Set<() => void>();

  /** Adds one command and returns the function that removes it again. */

  register(plugin: string, command: SlashCommand): () => void {
    const entry: RegisteredCommand = { ...command, plugin };
    this.entries.push(entry);
    this.announce();
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const at = this.entries.indexOf(entry);
      if (at >= 0) this.entries.splice(at, 1);
      this.announce();
    };
  }

  /** Every command, host and plugin alike, in the order they were registered. */

  list(): readonly RegisteredCommand[] {
    return this.entries.slice();
  }

  /** Those matching what has been typed after the slash. */

  find(query: string): readonly RegisteredCommand[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.list();
    return this.entries.filter((entry) =>
      `${entry.command} ${entry.purpose} ${entry.group}`.toLowerCase().includes(needle),
    );
  }

  /** The command typed exactly, or undefined. */
  exact(command: string): RegisteredCommand | undefined {
    return this.entries.find((entry) => entry.command === command);
  }

  /** Called whenever the set changes, so a rendered list can follow. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private announce(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Splits what is in the field into a command and the rest. */

export function splitCommand(value: string): { command: string; argument: string } | null {
  if (!value.startsWith("/")) return null;
  const space = value.indexOf(" ");
  if (space < 0) return { command: value, argument: "" };
  return { command: value.slice(0, space), argument: value.slice(space + 1) };
}
