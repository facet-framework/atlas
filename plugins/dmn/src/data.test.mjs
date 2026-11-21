import { test } from "node:test";
import assert from "node:assert/strict";
import { casesFor, listModels, readModel } from "./assets/data.js";
import de from "./assets/locales/de.js";
test("maps only linked structured examples and pre-states", () => {
  const records = [
    {
      id: "a/b/c",
      doc: {
        contract: {
          business_rules: [
            {
              model: "rules/x.dmn",
              element: "d",
              scenarios: ["s", "p", "prose"],
            },
          ],
          scenarios: [
            {
              id: "s",
              examples: [
                { columns: ["member", "amount"], rows: [[true, 100]] },
                { rows: [[false, 200]] },
              ],
            },
            { id: "p", pre_state: { member: true, amount: 50 } },
            { id: "prose", statement: "amount = 10" },
          ],
        },
      },
    },
  ];
  assert.deepEqual(
    casesFor(records, "rules/x.dmn", "d").map((c) => c.inputs),
    [
      { member: true, amount: 100 },
      { member: false, amount: 200 },
      { member: true, amount: 50 },
    ],
  );
  assert.equal(casesFor(records, "rules/other.dmn", "d").length, 0);
});
test("reads listed model text with the declared directory and exposes refusals", async () => {
  const calls = [];
  const call = async (tool, args) => {
    calls.push([tool, args]);
    return {
      ok: true,
      result:
        tool === "repo.list"
          ? { files: [{ path: "x.dmn" }] }
          : tool === "repo.read"
            ? { body: "xml" }
            : { decisions: [] },
    };
  };
  assert.deepEqual(await listModels(call), [{ path: "x.dmn" }]);
  assert.equal((await readModel(call, "x.dmn")).xml, "xml");
  assert.deepEqual(calls[1], ["repo.read", { dir: "rules", path: "x.dmn" }]);
  await assert.rejects(
    () =>
      readModel(async () => ({ ok: false, denied: "not granted" }), "x.dmn"),
    /not granted/,
  );
});

test("renders the English text when Atlas selects English or nothing", async () => {
  const { word } = await import("./assets/presentation.js");
  assert.equal(word("Find scenario candidates"), "Find scenario candidates");
  globalThis.document = { documentElement: { lang: "en" } };
  try {
    assert.equal(word("gap"), "gap");
  } finally {
    delete globalThis.document;
  }
});

test("keeps a text the German file does not carry, even an inherited name", async () => {
  const { word } = await import("./assets/presentation.js");
  globalThis.document = { documentElement: { lang: "de" } };
  try {
    assert.equal(word("constructor"), "constructor");
    assert.equal(word("Not in the file"), "Not in the file");
  } finally {
    delete globalThis.document;
  }
});

test("renders German labels when Atlas selects German", async () => {
  const { word } = await import("./assets/presentation.js");
  globalThis.document = { documentElement: { lang: "de" } };
  try {
    assert.equal(
      word("Find scenario candidates"),
      de["Find scenario candidates"],
    );
    assert.equal(word("gap"), de.gap);
  } finally {
    delete globalThis.document;
  }
});
