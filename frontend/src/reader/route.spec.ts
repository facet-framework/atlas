import { addressUrl, parse, readAddress } from "./route";

describe("where the reader keeps its address", () => {
  const at = { pathname: "/records", hash: "#/product", search: "?x=1" };

  it("reads the path under path addressing and writes the path back", () => {
    expect(readAddress("path", at)).toBe("/records");
    expect(addressUrl("path", "/record/a/b/c", at)).toBe("/record/a/b/c");
  });

  it("reads the fragment under hash addressing and keeps the document's own path", () => {
    expect(readAddress("hash", at)).toBe("/product");
    expect(addressUrl("hash", "/record/a/b/c", at)).toBe("/records?x=1#/record/a/b/c");
  });

  it("starts on the Overview when the fragment holds no address", () => {
    expect(readAddress("hash", { pathname: "/index.html", hash: "" })).toBe("/");
    expect(readAddress("hash", { pathname: "/index.html", hash: "#not-a-record" })).toBe("/");
  });
});

it("keeps unknown paths and record-like fragments literal", () => {
  const at = { pathname: "/unregistered/records", hash: "#tasks/create/quick-add" };
  expect(readAddress("path", at)).toBe(at.pathname);
  expect(parse(at.pathname)).toEqual({ area: "unknown", path: at.pathname });
  expect(readAddress("hash", at)).toBe("/");
});
