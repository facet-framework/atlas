import fs from "node:fs";
import path from "node:path";
import { PluginHost } from "./host";
import { OFFICIAL_PLUGINS } from "./official";

it.each(OFFICIAL_PLUGINS)("the $id manifest names the areas its entry registers", (plugin) => {
  const root = path.resolve(process.cwd(), "..");
  const actual = JSON.parse(
    fs.readFileSync(path.join(root, `plugins/${plugin.id}/plugin.json`), "utf8"),
  );
  const host = new PluginHost();
  const nav = {
    go: jest.fn(),
    open: jest.fn(),
    openScenario: jest.fn(),
    openArea: jest.fn(),
    closeArea: jest.fn(),
    openSheet: jest.fn(),
    openCatalogue: jest.fn(),
    setRole: jest.fn(),
  };
  host.load(plugin.id, plugin.entry, nav);
  expect(actual.id).toBe(plugin.id);
  expect(actual.api).toBe(0);
  expect(actual.tools.length).toBeGreaterThan(0);
  expect(host.areas.namesOf(plugin.id).sort()).toEqual(expect.arrayContaining(actual.areas));
});
