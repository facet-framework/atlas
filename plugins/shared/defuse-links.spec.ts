import { defuseLinks, keepsLink, linkTarget } from "./defuse-links";

describe("linkTarget", () => {
  it("trims spaces and control characters and drops tabs and line breaks, as the browser does", () => {
    expect(linkTarget("  javascript:alert(1)  ")).toBe("javascript:alert(1)");
    expect(linkTarget("\u0001java\tscript:x")).toBe("javascript:x");
    expect(linkTarget("\njava\nscript:x")).toBe("javascript:x");
  });

  it("unwraps the angle form, with or without its closing bracket", () => {
    expect(linkTarget("<javascript:alert>")).toBe("javascript:alert");
    expect(linkTarget(" < javascript:alert(1")).toBe("javascript:alert(1");
  });
});

describe("keepsLink", () => {
  it.each([
    ["javascript:alert(1)"],
    [" javascript:alert(1)"],
    ["javascript:alert(1) "],
    ["JavaScript:alert(1)"],
    ["JAVASCRIPT:alert(1)"],
    ["data:text/html,x"],
    ["data:text/html,x "],
    ["DATA:text/html,x"],
    ["vbscript:msgbox(1)"],
    ["VBScript:msgbox(1)"],
    ["<javascript:alert(1)>"],
    ["\tjavascript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["file:///etc/passwd"],
    ["http:example.org"],
  ])("refuses %j", (href) => {
    expect(keepsLink(href)).toBe(false);
  });

  it.each([
    ["https://example.org/q"],
    [" HTTPS://example.org/q "],
    ["http://example.org"],
    ["<https://example.org>"],
    ["mailto:hello@facet-framework.com"],
    ["MAILTO:hello@facet-framework.com"],
    ["#decision"],
    ["docs/adr/0001-one.md"],
    ["../0002-two.md"],
  ])("keeps %j", (href) => {
    expect(keepsLink(href)).toBe(true);
  });

  it("keeps a scheme the plugin names, in any case, and only that one", () => {
    expect(keepsLink("ATLAS:x/y", ["atlas"])).toBe(true);
    expect(keepsLink("atlas:x/y", ["Atlas"])).toBe(true);
    expect(keepsLink("atlas:x/y")).toBe(false);
  });
});

describe("defuseLinks", () => {
  it.each([
    ["[x]( javascript:alert(1))", "x ` javascript:alert(1`)"],
    ["[x](data:text/html,x )", "x `data:text/html,x `"],
    ["[x](vbscript:msgbox)", "x `vbscript:msgbox`"],
    ["[x](JavaScript:alert)", "x `JavaScript:alert`"],
    ["[x](<javascript:alert>)", "x `<javascript:alert>`"],
  ])("turns %j into text and code", (source, defused) => {
    expect(defuseLinks(source)).toBe(defused);
  });

  it("keeps a safe link beside a defused one", () => {
    expect(defuseLinks("[a](javascript:x) [b](https://example.org)")).toBe(
      "a `javascript:x` [b](https://example.org)",
    );
  });

  it("defuses a link whose target starts on the next line", () => {
    expect(defuseLinks("See [x](\njavascript:alert)")).toBe(
      "See x `\njavascript:alert`",
    );
  });

  it("defuses a link that a defused link inside it would otherwise leave behind", () => {
    const out = defuseLinks("[[a](javascript:1)](javascript:2)");
    expect(out).not.toMatch(/\]\(/);
    expect(out).toContain("javascript:2");
  });

  it("defuses a link inside backticks, because the renderer may not pair them as code", () => {
    expect(defuseLinks("*a`* [x](javascript:alert`1)")).toBe(
      "*a`* x `javascript:alert`1`",
    );
  });

  it("leaves fenced code as written and defuses the prose after it", () => {
    const source = [
      "```md",
      "[x](javascript:a)",
      "```",
      "[y](javascript:b)",
    ].join("\n");
    expect(defuseLinks(source)).toBe(
      ["```md", "[x](javascript:a)", "```", "y `javascript:b`"].join("\n"),
    );
  });

  it("treats an indented fence as prose, as the renderer does", () => {
    const source = ["  ```", "[x](javascript:a)", "  ```"].join("\n");
    expect(defuseLinks(source)).toBe(
      ["  ```", "x `javascript:a`", "  ```"].join("\n"),
    );
  });
});
