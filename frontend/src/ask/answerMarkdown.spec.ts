import { answerMarkdown } from "./cites";

describe("answerMarkdown", () => {
  it("puts the question as a quote ahead of the answer", () => {
    expect(answerMarkdown({ q: "Why?", answer: "Because.", cites: [] })).toBe("> Why?\n\nBecause.");
  });

  it("appends locations with their full id, not the short form", () => {
    // The short form stands in the button, because the context sits right
    // beside it. In a copied line it stands alone — nobody would find
    // "scan" again.
    expect(
      answerMarkdown({
        q: "Where?",
        answer: "There.",
        cites: [{ fid: "core/corpus/scan", label: "scan" }],
      }),
    ).toBe("> Where?\n\nThere.\n\n**Jump targets**\n- core/corpus/scan");
  });

  it("writes no empty list when Atlas found no location", () => {
    expect(answerMarkdown({ q: "Where?", answer: "Nowhere.", cites: [] })).not.toMatch(
      /Jump targets/,
    );
  });
});
