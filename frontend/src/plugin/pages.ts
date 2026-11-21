import type { ReactNode } from "react";
import type { PlacePublic } from "./context";

/** What a settings page supplies. */

export type SettingsRenderer = (ctx: {
  /** Where the reader stands, narrowed the same way every plugin surface is. */
  place: PlacePublic;
}) => ReactNode;

/** What a plugin says about its page so the reader can find and label it. */
export type SettingsPage = {
  /** The id, unique across plugins and against the core's own seven. */

  id: string;
  /** Which of the core's groups the page stands in. */
  group: string;
  /** The label in the list and at the head of the page. */
  title: string;
  /** The second line under the title. */
  subtitle: string;
  /** What else the page can be searched under. */

  keywords?: string;
  /** What draws on the right when the page is chosen. */
  render: SettingsRenderer;
};

/** A page plus the plugin the host knows it belongs to. */
export type RegisteredPage = SettingsPage & { readonly plugin: string };

/** The host's side of `atlas.settings`. */

// @facet: customization/contributions/plugin-contributed-page
// @facet-role: primary
export class SettingsRegistry {
  constructor(private readonly changed: () => void = () => {}) {}

  private pages: RegisteredPage[] = [];

  /** Records that a plugin owns a settings page. */

  register(plugin: string, reserved: ReadonlySet<string>, page: SettingsPage): (() => void) | null {
    if (reserved.has(page.id) || this.has(page.id)) return null;
    const entry: RegisteredPage = { ...page, plugin };
    this.pages = [...this.pages, entry];
    this.changed();
    return () => {
      const at = this.pages.indexOf(entry);
      if (at >= 0) {
        this.pages = this.pages.filter((item) => item !== entry);
        this.changed();
      }
    };
  }

  /** Every contributed page, in registration order. */
  list(): readonly RegisteredPage[] {
    return this.pages;
  }

  /** A page by its id, or null when no plugin contributed one. */
  find(id: string): RegisteredPage | null {
    return this.pages.find((p) => p.id === id) ?? null;
  }

  /** Whether any plugin contributed this id. */
  has(id: string): boolean {
    return this.find(id) !== null;
  }

  /** Which plugin owns a page. For the host's reporting, not for a plugin. */
  ownerOf(id: string): string | null {
    return this.find(id)?.plugin ?? null;
  }

  /** How many pages are contributed. */
  get count(): number {
    return this.pages.length;
  }
}
