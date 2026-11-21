import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseGlossary } from "@/model";
import Prose from "./Prose";
import { NavContext, type Nav } from "../nav";
import type { DerivedGlossary } from "../derive";
import { glossaryTermList } from "@/model";

const GLOSSARY: DerivedGlossary = (() => {
  const parsed = parseGlossary(`schema_version: "0.1"
terms:
  - term: Consignee
    definition: |
      The party named in the transport document.
  - term: promise
    definition: |
      A sentence a record makes about the product's behaviour.
`);
  return {
    terms: parsed!.terms,
    index: glossaryTermList(parsed),
    usedBy: { Consignee: [], promise: [] },
    // No groups, and that is the point here: prose links against the flat
    // view. Whether anyone categorises is none of its business, and null says
    // that more plainly than an empty array would.
    groups: null,
  };
})();

function renderProse(text: string, glossary: DerivedGlossary | null) {
  const nav: Nav = {
    go: jest.fn(),
    open: jest.fn(),
    openScenario: jest.fn(),
    openSheet: jest.fn(),
    closeSheet: jest.fn(),
    openArea: jest.fn(),
    closeArea: jest.fn(),
    openCatalogue: jest.fn(),
    closeCatalogue: jest.fn(),
    openSet: jest.fn(),
    closeSet: jest.fn(),
    openPalette: jest.fn(),
    ask: jest.fn(),
    setRole: jest.fn(),
  };
  const view = render(
    <NavContext.Provider value={nav}>
      <Prose text={text} glossary={glossary} />
    </NavContext.Provider>,
  );
  return { nav, ...view };
}

it("shows the text unchanged when the project has no glossary", () => {
  const { container } = renderProse("The Consignee is notified.", null);
  expect(container).toHaveTextContent("The Consignee is notified.");
  expect(container.querySelector("button")).toBeNull();
});

it("makes every exact occurrence clickable", () => {
  const { container } = renderProse("Consignee and Consignee again.", GLOSSARY);
  expect(container.querySelectorAll('[data-testid="prose-term"]')).toHaveLength(2);
  expect(container).toHaveTextContent("Consignee and Consignee again.");
});

it("leaves a word alone that merely contains the term", () => {
  const { container } = renderProse("The Consigneelist is long.", GLOSSARY);
  expect(container.querySelector("button")).toBeNull();
});

it("opens the sheet with the term it found", async () => {
  const { nav } = renderProse("The Consignee confirms.", GLOSSARY);
  await userEvent.click(screen.getByRole("button", { name: /Consignee/ }));
  expect(nav.openSheet).toHaveBeenCalledWith("term", "Consignee");
});

// The text is the text. A reader who copies a sentence should get the same
// sentence, with no gap where a term stood.
it("loses no character", () => {
  const text = "Consignee, at the start and end of the sentence: Consignee";
  const { container } = renderProse(text, GLOSSARY);
  expect(container.textContent).toBe(text);
});

it("handles empty text", () => {
  const { container } = renderProse("", GLOSSARY);
  expect(container.textContent).toBe("");
});

describe("Prose — what the author marked up", () => {
  it("marks an identifier in backticks as code and omits the backticks", () => {
    const { container } = renderProse("Given `feature_get` returns an empty map.", GLOSSARY);

    expect(container.querySelector("code")).toHaveTextContent("feature_get");
    expect(container.textContent).toBe("Given feature_get returns an empty map.");
    expect(container.textContent).not.toContain("`");
  });

  it("marks bold and italic instead of showing asterisks", () => {
    const { container } = renderProse("Then **no** *drift* is reported.", GLOSSARY);

    expect(container.querySelector("strong")).toHaveTextContent("no");
    expect(container.querySelector("em")).toHaveTextContent("drift");
    expect(container.textContent).toBe("Then no drift is reported.");
  });

  it("turns a reference into a link", () => {
    const { container } = renderProse("See [the paper](https://example.org/p).", GLOSSARY);
    const a = container.querySelector("a");

    expect(a).toHaveTextContent("the paper");
    expect(a).toHaveAttribute("href", "https://example.org/p");
    // A target from a file anyone may write is not opened in the current
    // window.
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows a scheme nobody may visit as text with its address", () => {
    const { container } = renderProse("See [here](javascript:alert(1)).", GLOSSARY);

    // Staying silent would be worse than showing it: the reader sees where
    // the link would have pointed, and still cannot get there.
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });

  it("leaves a block alone — a Given step is not a list", () => {
    // No heading, no bullet list: whoever writes that into a step is saying
    // too much, and this area should not make that comfortable. The
    // characters therefore stay in place instead of being swallowed quietly.
    const { container } = renderProse("## Heading", GLOSSARY);

    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(container.textContent).toBe("## Heading");
  });
});

/** The spot where the two refiners could cut into each other. */

describe("Prose — glossary and markup on the same sentence", () => {
  it("links the term beside it but not the one in backticks", () => {
    const { container } = renderProse("A `promise` is no promise here.", GLOSSARY);
    const buttons = container.querySelectorAll('[data-testid="prose-term"]');

    expect(buttons).toHaveLength(1);
    // Namely the second one: the one in the code span is the identifier in
    // code.
    expect(container.querySelector("code")).toHaveTextContent("promise");
    expect(container.querySelector("code button")).toBeNull();
    expect(buttons[0].textContent).toBe("promise");
    expect(container.textContent).toBe("A promise is no promise here.");
  });

  it("finds the term even inside a bold span", () => {
    const { container } = renderProse("The **Consignee** confirms.", GLOSSARY);

    // The button sits *inside* the bold node and not beside it: both
    // statements hold about the same spot, and neither displaces the other.
    expect(container.querySelector('strong [data-testid="prose-term"]')).toHaveTextContent(
      "Consignee",
    );
    expect(container.textContent).toBe("The Consignee confirms.");
  });

  it("does not turn a link's text into a second target", () => {
    const { container } = renderProse("See [the Consignee](https://example.org/c).", GLOSSARY);

    expect(container.querySelector("a button")).toBeNull();
    expect(container.querySelectorAll('[data-testid="prose-term"]')).toHaveLength(0);
    expect(container.querySelector("a")).toHaveTextContent("the Consignee");
  });

  it("marks up even without a glossary", () => {
    const { container } = renderProse("Given `feature_get` returns **no** null.", null);

    // The two readings are independent. A project without a glossary has not
    // asked to see its backticks.
    expect(container.querySelector("code")).toHaveTextContent("feature_get");
    expect(container.querySelector("strong")).toHaveTextContent("no");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders a sentence without markup as the same node tree as before", () => {
    // This area's rule, unchanged: when nothing is found, the text stands
    // there — not in a version that shows it was searched.
    const { container } = renderProse("A plain sentence.", GLOSSARY);

    expect(container.innerHTML).toBe("A plain sentence.");
  });
});
