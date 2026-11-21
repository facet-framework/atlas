import type { ReactNode } from "react";
import type { PlacePublic } from "./context";

/** Draws the whole surface a role stands for, in place of the core's
 * `OVERVIEW[role]` component. */

export type RoleRenderer = (ctx: {
  /** Where the reader stands, narrowed the same way every plugin surface is. */
  place: PlacePublic;
}) => ReactNode;

/** What a plugin says about a role it contributes. */
export type PluginRole = {
  /** The label in the role menu and in the path bar's own button. */
  label: string;
  /** The sentence beside the label in the menu, same field the core's own roles carry. */
  purpose: string;
  render: RoleRenderer;
};

/** A role plus the plugin the host knows it belongs to. */
export type RegisteredRole = PluginRole & { readonly id: string; readonly plugin: string };

/** The host's side of `atlas.roles`. */

// @facet: workspace/contracts/plugin-roles
// @facet-role: primary
export class RoleRegistry {
  constructor(private readonly changed: () => void = () => {}) {}

  private roles: RegisteredRole[] = [];

  /** Records that a plugin owns a role. */

  register(
    plugin: string,
    reserved: ReadonlySet<string>,
    id: string,
    role: PluginRole,
  ): (() => void) | null {
    if (reserved.has(id)) return null;
    if (this.roles.some((r) => r.id === id)) return null;
    const entry: RegisteredRole = { ...role, id, plugin };
    this.roles = [...this.roles, entry];
    this.changed();
    return () => {
      const at = this.roles.indexOf(entry);
      if (at >= 0) {
        this.roles = this.roles.filter((item) => item !== entry);
        this.changed();
      }
    };
  }

  /** Every contributed role, in registration order. */
  list(): readonly RegisteredRole[] {
    return this.roles;
  }

  /** A role by its id, or null when no plugin contributed one. */
  find(id: string): RegisteredRole | null {
    return this.roles.find((r) => r.id === id) ?? null;
  }

  /** Whether any plugin contributed this id. */
  has(id: string): boolean {
    return this.roles.some((r) => r.id === id);
  }

  /** Which plugin owns a role. For the host's reporting, not for a plugin. */
  ownerOf(id: string): string | null {
    return this.roles.find((r) => r.id === id)?.plugin ?? null;
  }

  /** How many roles are contributed. */
  get count(): number {
    return this.roles.length;
  }
}
