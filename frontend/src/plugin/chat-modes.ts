/** What a plugin says about a conversation mode it contributes. */
export type ChatMode = {
  /** The label in the mode picker. */
  label: string;
  /** Sent ahead of the reader's own question, every time this mode is chosen. */

  systemPrompt: string;
};

/** A mode plus the plugin the host knows it belongs to. */
export type RegisteredMode = ChatMode & { readonly id: string; readonly plugin: string };

/** The core's own mode — always present, first in the list, never removable. */
export const CORE_MODE_ID = "normal";

/** The chat's own mode in the reader that keys modes by `ask` (`chat.tsx`).
 * It starts in this mode, so a plugin mode under the same id would be folded
 * into every plain question while the picker shows the core's mode as chosen. */

export const ASK_MODE_ID = "ask";

/** The reserved ids a plugin may not take: the core's own mode under both
 * names it carries. */

export const CORE_MODE_IDS: ReadonlySet<string> = new Set([CORE_MODE_ID, ASK_MODE_ID]);

/** The host's side of `atlas.chat`. */

// @facet: customization/contributions/plugin-chat-modes
// @facet-role: primary
export class ChatModeRegistry {
  constructor(private readonly changed: () => void = () => {}) {}

  private modes: RegisteredMode[] = [];

  /** Records that a plugin owns a conversation mode. */

  register(
    plugin: string,
    reserved: ReadonlySet<string>,
    id: string,
    mode: ChatMode,
  ): (() => void) | null {
    if (reserved.has(id)) return null;
    if (this.modes.some((m) => m.id === id)) return null;
    const entry: RegisteredMode = { ...mode, id, plugin };
    this.modes = [...this.modes, entry];
    this.changed();
    return () => {
      const at = this.modes.indexOf(entry);
      if (at >= 0) {
        this.modes = this.modes.filter((item) => item !== entry);
        this.changed();
      }
    };
  }

  /** Every contributed mode, in registration order. */
  list(): readonly RegisteredMode[] {
    return this.modes;
  }

  /** A mode by its id, or null when no plugin contributed one. */
  find(id: string): RegisteredMode | null {
    return this.modes.find((m) => m.id === id) ?? null;
  }

  /** Whether any plugin contributed this id. */
  has(id: string): boolean {
    return this.modes.some((m) => m.id === id);
  }

  /** Which plugin owns a mode. For the host's reporting, not for a plugin. */
  ownerOf(id: string): string | null {
    return this.modes.find((m) => m.id === id)?.plugin ?? null;
  }

  /** How many modes are contributed. */
  get count(): number {
    return this.modes.length;
  }
}

/** The text actually sent to the agent for one question under one mode. */

export function withDefaults(question: string, mode: RegisteredMode | null): string {
  if (!mode) return question;
  return `${mode.systemPrompt}\n\n${question}`;
}
