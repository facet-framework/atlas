/** The processes plugin's one entry — the area, a settings page and the
 * command — drawn with the FACET design system and reached
 * only through `atlas`. The door into the processes is the host's navigation
 * entry, so no `header.action` is mounted here. */

import { useEffect, useState } from "react";
import { SettingsSection } from "../../../../frontend/src/plugin/components";
import { tx } from "../../../../frontend/src/i18n";
import type { AtlasApi } from "../../../../frontend/src/plugin/host";
import { DirectorySettings } from "../../../shared/DirectorySettings";
import { ProcessFiles, ProcessesPlace } from "./Processes";

/** The area this plugin registers; the host addresses it under the plugin's id. */
export const AREA = "processes";

type AreaState = { path: string | null } & Record<string, unknown>;

/** Phone width, measured the way the host measures it. */
function useMobile(): boolean {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    const on = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

function ProcessesArea({
  atlas,
  store,
  state,
  setState,
}: {
  atlas: AtlasApi;
  store: ProcessFiles;
  state: AreaState;
  setState: (next: AreaState) => void;
}) {
  const mobile = useMobile();
  return (
    <ProcessesPlace
      host={{
        mobile,
        open: (path) => atlas.verbs.openArea(AREA, path),
        openRecord: (id) => atlas.verbs.open(id),
      }}
      rest={state.path ?? ""}
      call={atlas.bus.call}
      state={state}
      setState={(next) => setState({ ...next, path: state.path })}
      store={store}
    />
  );
}

export default function bpmnEntry(atlas: AtlasApi): void {
  const store = new ProcessFiles();
  atlas.areas.register(
    AREA,
    ({ state, setState }) => (
      <ProcessesArea
        atlas={atlas}
        store={store}
        state={state as AreaState}
        setState={setState}
      />
    ),
    {
      initial: (arg) => ({ path: arg }),
      place: (state) => (state as AreaState).path,
    },
  );
  atlas.settings.register({
    id: "bpmn",
    group: "Plugins",
    title: tx("ui.bpmn-src-reader.entry-processes"),
    subtitle: tx("ui.bpmn-src-reader.entry-bpmn-diagrams"),
    keywords: tx("ui.bpmn-src-reader.entry-bpmn-process-diagram-docs"),
    render: () => (
      <SettingsSection title={tx("ui.bpmn-src-reader.entry-bpmn-diagrams")}>
        <DirectorySettings kind="bpmn" />
      </SettingsSection>
    ),
  });
  atlas.commands.register({
    command: "/bpmn",
    argument: tx("ui.bpmn-src-reader.entry-file-name"),
    purpose: tx("ui.bpmn-src-reader.entry-open-diagram"),
    group: tx("ui.bpmn-src-reader.entry-processes"),
    run: (argument) => atlas.verbs.openArea(AREA, argument.trim() || null),
  });
}
