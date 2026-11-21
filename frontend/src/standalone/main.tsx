/** Entry point of the standalone Atlas bundle. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AtlasLive from "@/reader/AtlasLive";
// @facet: workspace/controls/stylesheet-integrity
// @facet-role: primary
import "@/app/globals.css";
// The FACET design system (ADR 0007): it sets nothing on `:root` but `--t-`
// variables and prefixes every class with `t-`.
import "@facet-tools/ui/styles.css";
import "@/chrome/shell.css";
import "@/screens/styles/frame.css";
import "@/screens/styles/records.css";
import "@/screens/styles/contents.css";
import "@/screens/styles/plugins.css";

const mount = document.getElementById("atlas");

if (!mount) {
  throw new Error('No root node <div id="atlas"> in the page.');
}

createRoot(mount).render(
  <StrictMode>
    <AtlasLive url={mount.dataset.stream || "/api/corpus"} />
  </StrictMode>,
);
