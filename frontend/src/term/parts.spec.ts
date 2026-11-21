/** Which parts of a sentence are searched for terms. */

import { isSearchable, searchableParts } from "./parts";

it("takes ordinary text", () => {
  expect(searchableParts("A plain sentence.")).toEqual(["A plain sentence."]);
});

it("leaves out a code span — an identifier stands there, not part of a sentence", () => {
  expect(searchableParts("A `Promise` is no promise here.")).toEqual([
    "A ",
    " is no promise here.",
  ]);
});

it("leaves out a link text — one click does not have two targets", () => {
  expect(searchableParts("See [the Consignee](https://example.org/c) there.")).toEqual([
    "See ",
    " there.",
  ]);
});

it("keeps searching bold and italic", () => {
  // Emphasis is a statement about the sentence, not about the meaning of its
  // words — a term stays one even when it stands in bold.
  expect(searchableParts("The **Consignee** *acknowledges*.")).toEqual([
    "The ",
    "Consignee",
    " ",
    "acknowledges",
    ".",
  ]);
});

it("answers the question per span — the same one the surface asks", () => {
  // The counter calls `searchableParts`, the surface `isSearchable`. Both over
  // the same predicate: a second list would be a second opinion, and it would
  // end up as a number on the sheet over an occurrence nobody can click.
  expect(isSearchable({ kind: "text", text: "x" })).toBe(true);
  expect(isSearchable({ kind: "strong", text: "x" })).toBe(true);
  expect(isSearchable({ kind: "em", text: "x" })).toBe(true);
  expect(isSearchable({ kind: "code", text: "x" })).toBe(false);
  expect(isSearchable({ kind: "link", text: "x", href: "https://e.org" })).toBe(false);
});
