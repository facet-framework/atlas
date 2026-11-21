import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "tsup";

// Resolved from this package, so the copies are the reader's own.
const reactRequire = createRequire(join(__dirname, "package.json"));

const outDir = process.env.ATLAS_BUILD_DIR ?? "dist";

/** Standalone browser assets for the combined facet application. React, the
 * component library and the data layer are bundled, so the runtime machine
 * needs no Node installation. */

export default defineConfig({
  entry: { atlas: "src/standalone/main.tsx" },
  outDir,
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: false,
  clean: true,
  minify: true,
  metafile: true,
  noExternal: [/.*/],
  define: { "process.env.NODE_ENV": '"production"' },
  outExtension: () => ({ js: ".js" }),
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.nodePaths = [...(options.nodePaths ?? []), "node_modules"];
    options.alias = {
      ...(options.alias ?? {}),
      react: dirname(reactRequire.resolve("react/package.json")),
      "react-dom": dirname(reactRequire.resolve("react-dom/package.json")),
    };
  },
  onSuccess: async () => {
    copyFileSync("src/standalone/index.html", join(outDir, "index.html"));
    copyFileSync("src/standalone/theme-init.js", join(outDir, "theme-init.js"));
  },
});
