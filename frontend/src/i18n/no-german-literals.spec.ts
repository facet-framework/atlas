import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
it("keeps German text in dictionary values across tracked files", () => {
  const root = resolve(__dirname, "../../..");
  expect(
    JSON.parse(
      execFileSync(process.execPath, ["frontend/scripts/check-language.mjs"], {
        cwd: root,
        encoding: "utf8",
      }),
    ).count,
  ).toBe(0);
});
