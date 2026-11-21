import german from "../locales/de.json";
import { parseHead } from "./headers";

const EXAMPLE_DELIVERY = `# ADR 0042 — Ship books together

**Status:** accepted
**Date:** 2024-04-06
**Concerns:** Library shipping: weekly packages and returns
**Measured against:** \`sample-run-03\` (2024-04-02), 8 packages, 27 labels
**Sources:** Shipping handbook: section “Combined packages”

---

## 1. Decision

Books are grouped into one shipping package by destination.
`;

describe("parseHead with a fictional library delivery decision", () => {
  it("reads every header field and preserves colons and inline code in its values", () => {
    const head = parseHead(EXAMPLE_DELIVERY);
    expect(head.title).toBe("ADR 0042 — Ship books together");
    // A German status word is an alias: it is read as its English value.
    expect(head.status).toBe("accepted");
    expect(head.date).toBe("2024-04-06");
    expect(head.concerns).toBe("Library shipping: weekly packages and returns");
    expect(head.measuredAgainst).toBe(
      "`sample-run-03` (2024-04-02), 8 packages, 27 labels",
    );
    expect(head.sources).toBe("Shipping handbook: section “Combined packages”");
  });
});

describe("a status line with a trailing date", () => {
  it("normalizes the leading word before a comma and preserves the original status line", () => {
    const head = parseHead("# T\n\n**Status:** Accepted, 2024-04-07\n\n---\n");
    expect(head.status).toBe("accepted");
    expect(head.statusRaw).toBe("Accepted, 2024-04-07");
    expect(head.date).toBe("2024-04-07");
  });

  it("reads the leading word before a parenthesized date", () => {
    const head = parseHead("# T\n\n**Status:** accepted (2024-04-08)\n\n---\n");
    expect(head.status).toBe("accepted");
    expect(head.date).toBe("2024-04-08");
  });
});

describe("a status word this reader does not know", () => {
  it("leaves status unset rather than guessing, and keeps the raw text", () => {
    const head = parseHead("# T\n\n**Status:** frozen\n\n---\n");
    expect(head.status).toBeUndefined();
    expect(head.statusRaw).toBe("frozen");
  });
});

describe("a file with no status line at all", () => {
  it("carries no status and no raw text — absent, not guessed", () => {
    const head = parseHead("# T\n\n---\n\nbody\n");
    expect(head.status).toBeUndefined();
    expect(head.statusRaw).toBeUndefined();
  });
});

describe("the other three known status words", () => {
  it.each(["proposed", "superseded", "rejected"])("reads %s", (raw) => {
    const head = parseHead(`# T\n\n**Status:** ${raw}\n\n---\n`);
    expect(head.status).toBe(raw);
  });
});

describe("German ADR status words", () => {
  it.each([
    [german.proposed, "proposed"],
    [german.accepted, "accepted"],
    [german.superseded, "superseded"],
    [german.rejected, "rejected"],
    [`${german.accepted}, 2024-04-07`, "accepted"],
  ])("reads %s as %s and keeps the raw text", (raw, expected) => {
    const head = parseHead(`# T\n\n**Status:** ${raw}\n\n---\n`);
    expect(head.status).toBe(expected);
    expect(head.statusRaw).toBe(raw);
  });

  it("does not read a name every object inherits as a status", () => {
    const head = parseHead("# T\n\n**Status:** constructor\n\n---\n");
    expect(head.status).toBeUndefined();
    expect(head.statusRaw).toBe("constructor");
  });
});

describe("German ADR header labels", () => {
  it.each([
    [german.date, "Date", "date"],
    [german.concerns, "Concerns", "concerns"],
    [german.measuredAgainst, "Measured against", "measuredAgainst"],
    [german.sources, "Sources", "sources"],
  ])("reads %s as %s", (old, english, field) => {
    expect(parseHead(`**${old}:** original`)).toHaveProperty(field, "original");
    expect(parseHead(`**${english}:** current`)).toHaveProperty(
      field,
      "current",
    );
    expect(
      parseHead(`**${old}:** original\n**${english}:** current`),
    ).toHaveProperty(field, "current");
  });
});
