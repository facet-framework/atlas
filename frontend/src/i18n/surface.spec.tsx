import { germanLabel } from "./testing-labels.spec-support";
import { act } from "@testing-library/react";
import i18n from ".";
import { groupLabel, pageOf, search } from "../settings/page-tree";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

it("updates the settings search while preserving state identifiers", async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(pageOf("language").t).toBe("Language");
  expect(groupLabel("General")).toBe("General");
  expect(search("branches").flatMap((g) => g.rows.map((s) => s.id))).toEqual(["git-provider"]);
  expect(pageOf("git-provider").g).toBe("Integrations");
  await act(async () => {
    await i18n.changeLanguage("de");
  });
  expect(pageOf("language").t).toBe(germanLabel("Language"));
});
