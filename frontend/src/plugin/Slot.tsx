/** Where a plugin's slot actually appears on a surface. */

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PlacePublic } from "./context";
import type { PluginHost } from "./host";
import type { SlotName } from "./slots";

/** Draws every plugin registered for one slot. */

export default function Slot({
  host,
  name,
  place,
}: {
  host: PluginHost;
  name: SlotName;
  place: PlacePublic;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const revision = useSyncExternalStore(
    host.slots.subscribe,
    host.slots.version,
    host.slots.version,
  );

  const { depth, fid, sid, role, area } = place;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    host.slots.mount(node, name, { depth, fid, sid, role, area }, host.seen);
  }, [host, name, depth, fid, sid, role, area, revision]);

  // Late registrations append only the new holder. Existing roots keep their
  // input, focus and state; teardown belongs to a changed place or unmount.
  useEffect(() => {
    const node = ref.current;
    return () => {
      if (node) host.slots.unmount(node);
    };
  }, [host, name, depth, fid, sid, role, area]);

  return <div className="pluginslot" data-slot={name} ref={ref} />;
}
