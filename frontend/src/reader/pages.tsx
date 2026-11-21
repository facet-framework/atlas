/** Which page a place shows. */

import type { ReactNode } from "react";
import type { PageContext } from "./context";
import type { HostInfo } from "./host";
import type { Route } from "./route";
import type { SourceViewSummary } from "@/chrome/source-view";
import {
  CapabilityPlace,
  DomainPlace,
  OverviewPlace,
  MissingPlace,
  ProductPlace,
} from "./pages/frame";
import { RecordPlace, RecordsPlace } from "./pages/records";
import { GlossaryPlace, HubPlace, KIND_KEYS, KindPlace } from "./pages/contents";
import { SettingsPlace } from "./pages/settings";
import { PluginAreaPlace, PluginTilePlace } from "./plugin-host";

export type { PageContext } from "./context";

export type ShellExtras = {
  host: HostInfo;
  history: { count: number; clear: () => void };
  path: string;
  /** The named source view of the corpus, when the host resolved it through one. */
  sourceView?: SourceViewSummary;
};

export function renderPage(route: Route, ctx: PageContext, extras: ShellExtras): ReactNode {
  switch (route.area) {
    case "overview":
      return <OverviewPlace ctx={ctx} />;
    case "product":
      return <ProductPlace ctx={ctx} />;
    case "domain":
      return <DomainPlace ctx={ctx} id={route.domain} />;
    case "capability":
      return <CapabilityPlace ctx={ctx} domain={route.domain} capability={route.capability} />;
    case "records":
      return <RecordsPlace ctx={ctx} />;
    case "record":
      return <RecordPlace key={route.id} ctx={ctx} id={route.id} section={route.section} />;
    case "contents":
      if (!route.kind) return <HubPlace ctx={ctx} />;
      if (route.kind === "glossary") return <GlossaryPlace ctx={ctx} />;
      if (!KIND_KEYS.has(route.kind)) {
        const tile = ctx.plugins?.host.tiles.find(route.kind);
        if (tile) return <PluginTilePlace key={tile.id} ctx={ctx} tile={tile} />;
        return (
          <MissingPlace ctx={ctx} path={extras.path} kind={ctx.t("ui.reader.pages-content")} />
        );
      }
      return <KindPlace ctx={ctx} kind={route.kind} />;
    case "glossary":
      return <GlossaryPlace ctx={ctx} term={route.term} />;
    case "settings":
      return (
        <SettingsPlace
          ctx={ctx}
          section={route.section}
          host={extras.host}
          history={extras.history}
          sourceView={extras.sourceView}
        />
      );
    case "plugin":
      return (
        <PluginAreaPlace
          key={route.plugin}
          ctx={ctx}
          plugin={route.plugin}
          rest={route.rest}
          missing={<MissingPlace ctx={ctx} path={extras.path} kind="Plugin" />}
        />
      );
    case "ask":
      // The chat is a layer over every place; its own address opens it full size.
      return <OverviewPlace ctx={ctx} />;
    case "unknown":
      return <MissingPlace ctx={ctx} path={extras.path} />;
  }
}
