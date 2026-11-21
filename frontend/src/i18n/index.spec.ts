import en from "./locales/en.json";
import i18n, { addCustomLanguage, customLanguages, isCustomLanguageFile } from ".";

beforeEach(() => localStorage.clear());

describe("Atlas languages", () => {
  beforeEach(() => localStorage.clear());

  it("accepts only files with the complete English key set", () => {
    expect(isCustomLanguageFile({ code: "fr", name: "Français", translation: en })).toBe(true);
    for (const invalid of [
      null,
      "fr",
      {},
      { code: "FR", name: "Français", translation: en },
      { code: "french", name: "Français", translation: en },
      { code: "fr", name: "", translation: en },
      { code: "fr", name: 42, translation: en },
      { code: "fr", name: "Français", translation: {} },
      { code: "fr", name: "Français", translation: { common: { close: "Fermer" } } },
    ]) {
      expect(isCustomLanguageFile(invalid)).toBe(false);
    }
  });

  it("persists an imported language for this browser", async () => {
    await addCustomLanguage({ code: "fr", name: "Français", translation: en });

    expect(i18n.language).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(customLanguages()).toEqual([{ code: "fr", name: "Français", translation: en }]);
  });
});

it("restores an imported translation on a cold module load", async () => {
  const translation = {
    ...en,
    ui: {
      ...en.ui,
      "screens-plugins": { ...en.ui["screens-plugins"], "chat-close": "Fermer" },
    },
  };
  await addCustomLanguage({ code: "fr", name: "Français", translation });
  expect(JSON.parse(localStorage.getItem("facet-atlas-languages") || "[]")).toEqual([
    { code: "fr", name: "Français", translation },
  ]);
  await jest.isolateModulesAsync(async () => {
    const fresh = await import(".");
    expect(fresh.default.resolvedLanguage).toBe("fr");
    expect(fresh.default.t("ui.screens-plugins.chat-close")).toBe("Fermer");
    expect(fresh.customLanguages()).toEqual([{ code: "fr", name: "Français", translation }]);
  });
});
it("rejects an incomplete import without changing language or browser storage", async () => {
  const before = i18n.resolvedLanguage;
  await expect(
    addCustomLanguage({ code: "fr", name: "Français", translation: {} }),
  ).rejects.toThrow("Invalid Atlas language file");
  expect(i18n.resolvedLanguage).toBe(before);
  expect(localStorage.getItem("facet-atlas-languages")).toBeNull();
});
it("ignores malformed or invalid stored language data", () => {
  for (const stored of [
    "{broken",
    "null",
    "{}",
    '[{"code":"fr","name":"Français","translation":{}}]',
  ]) {
    localStorage.setItem("facet-atlas-languages", stored);
    expect(customLanguages()).toEqual([]);
  }
});
