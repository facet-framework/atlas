/** Resolve sibling plugin imports through individual package links in a real directory. */
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const browser = fileURLToPath(new URL("..", import.meta.url));
const source = join(browser, "node_modules");
const target = join(browser, "../node_modules");
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(source)) {
  if (entry.startsWith(".")) continue;
  const names = entry.startsWith("@")
    ? readdirSync(join(source, entry)).map((name) => join(entry, name))
    : [entry];
  for (const name of names) {
    const destination = join(target, name);
    if (existsSync(destination)) continue;
    if (entry.startsWith("@")) mkdirSync(join(target, entry), { recursive: true });
    const parent = entry.startsWith("@") ? join(target, entry) : target;
    symlinkSync(relative(parent, join(source, name)), destination, "dir");
  }
}
