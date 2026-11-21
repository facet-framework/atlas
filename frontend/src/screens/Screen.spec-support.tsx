import type { ReactNode } from "react";
import { AppShell } from "@facet-tools/ui";
import {
  MobileTabBar,
  NavBar,
  RoleMenu,
  TopBar,
  type HistoryEntry,
  type TopBarStats,
} from "@/chrome";
import { useText } from "./text";
import { HISTORY, useNav, useRoles } from "../fixtures/shell";
import { TOP_STATS } from "../fixtures/summary";

export type ScreenProps = {
  /** Key of the current area in the nav bar (`overview`, `product`, `records`, …). */
  area: string;
  mobile?: boolean;
  children: ReactNode;
  /** Chat pill, dock or full screen — rendered above the page. */
  chat?: ReactNode;
  /** Sheets, dialogs, palette. */
  overlay?: ReactNode;
  historyOpen?: boolean;
  history?: HistoryEntry[];
  canBack?: boolean;
  canForward?: boolean;
  roleOpen?: boolean;
  role?: string;
  theme?: { theme: "facet" | "paper"; mode: "dark" | "light" };
  /** Top bar figures; defaults to the shared summary, `null` hides them. */
  stats?: TopBarStats | null;
  /** Badges on the area bar by key; `null` removes the default ones (unmeasured states). */
  badges?: Record<string, number> | null;
};

const MOBILE_TABS = [
  { key: "overview", text: "ui.screens.screen-spec-support-overview", icon: "home" },
  { key: "product", text: "ui.screens.screen-spec-support-product", icon: "buildings" },
  { key: "records", text: "ui.screens.screen-spec-support-records", icon: "document" },
  { key: "ask", text: "ui.screens.screen-spec-support-ask", icon: "chat" },
  { key: "more", text: "ui.screens.screen-spec-support-more", icon: "menu" },
] as const;

/** A whole Atlas screen: frame, area bar or tab bar, page. Every story under
 * `Screens/` renders through this, so the frame is identical across groups. */

export function Screen({
  area,
  mobile,
  children,
  chat,
  overlay,
  historyOpen,
  history = HISTORY,
  canBack = true,
  canForward = false,
  roleOpen,
  role = "dev",
  theme,
  stats = TOP_STATS,
  badges,
}: ScreenProps) {
  const { t } = useText();
  const nav = useNav();
  const roles = useRoles();
  const roleName = roles.find((r) => r.key === role)?.name ?? role;
  const inTabs = MOBILE_TABS.some((tab) => tab.key === area);
  return (
    <AppShell
      mobile={mobile}
      theme={theme}
      top={
        <TopBar
          compact={mobile}
          canBack={canBack}
          canForward={canForward}
          historyOpen={historyOpen}
          history={{ entries: history }}
          stats={stats ?? undefined}
          roleName={roleName}
          roleOpen={roleOpen}
          roleMenu={<RoleMenu roles={roles} current={role} />}
          theme={
            theme?.mode === "light"
              ? { label: t("ui.screens.screen-spec-support-dark"), icon: "moon" }
              : { label: t("ui.screens.screen-spec-support-light"), icon: "sun" }
          }
        />
      }
      nav={
        <NavBar
          items={nav.map((n) => ({
            ...n,
            current: n.key === area,
            badge: badges === null ? undefined : (badges?.[n.key] ?? n.badge),
          }))}
        />
      }
      tabbar={
        <MobileTabBar
          items={MOBILE_TABS.map((tab) => ({
            key: tab.key,
            label: t(tab.text),
            icon: tab.icon,
            current: tab.key === area || (!inTabs && tab.key === "more"),
          }))}
        />
      }
      chat={chat}
      overlay={overlay}
    >
      {children}
    </AppShell>
  );
}

/** Story parameters for the two viewports every screen is shown in. */
export const desktop = {
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "desktop" } },
} as const;
export const mobile = {
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobile" } },
} as const;
