import { initialLanguage } from "./language";

describe("initial Atlas language", () => {
  it("preserves an explicitly saved built-in or imported language", () => {
    expect(initialLanguage("en", ["de-DE"], ["de", "en"])).toBe("en");
    expect(initialLanguage("fr", ["de-DE"], ["de", "en", "fr"])).toBe("fr");
  });
  it("matches supported browser languages in preference order", () => {
    expect(initialLanguage(null, ["fr-FR", "de-AT", "en"], ["de", "en"])).toBe("de");
    expect(initialLanguage(null, ["en-US", "de"], ["de", "en"])).toBe("en");
    expect(initialLanguage(null, [], ["de", "en"])).toBe("en");
    expect(initialLanguage("missing", ["fr"], ["de", "en"])).toBe("en");
  });
  it("matches regional custom languages without changing their identity", () => {
    expect(initialLanguage(null, ["pt-br"], ["de", "en", "pt-BR"])).toBe("pt-BR");
  });
  it("falls back to English without a supported preference or valid saved choice", () => {
    expect(initialLanguage(null, [], ["de", "en"])).toBe("en");
    expect(initialLanguage("missing", ["fr"], ["de", "en"])).toBe("en");
  });
});
