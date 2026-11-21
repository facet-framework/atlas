/** What the answer shows — and what it does not swallow. */

import { render, screen, within } from "@testing-library/react";
import Answer from "./Answer";

describe("Answer — markup inside running text", () => {
  it("renders bold, italic and code instead of showing their characters", () => {
    const { container } = render(
      <Answer text="The **anchor** sits *there*, in `corpus.go`." running={false} />,
    );

    expect(container.querySelector("strong")).toHaveTextContent("anchor");
    expect(container.querySelector("em")).toHaveTextContent("there");
    expect(container.querySelector("code")).toHaveTextContent("corpus.go");
    // And the characters themselves are gone.
    expect(container.textContent).toBe("The anchor sits there, in corpus.go.");
  });

  it("turns a visitable target into a link", () => {
    const { container } = render(
      <Answer text="See [the specification](https://example.org/facet)." running={false} />,
    );

    const a = container.querySelector("a");
    expect(a).toHaveAttribute("href", "https://example.org/facet");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveTextContent("the specification");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows a target nobody may visit as text with its address", () => {
    // Withholding it would be worse than showing it — but it must not become
    // a button.
    const { container } = render(<Answer text="[harmlos](javascript:alert(1))" running={false} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });
});

describe("Answer — blocks", () => {
  it("builds a list out of a bullet list", () => {
    const { container } = render(
      <Answer
        text={"Three places:\n\n- the bar\n- the counters\n- the knowledge"}
        running={false}
      />,
    );

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["the bar", "the counters", "the knowledge"]);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("shows a code block unchanged and names its language", () => {
    const { container } = render(
      <Answer text={"```go\nif beta {\n\treturn Assets()\n}\n```"} running={false} />,
    );

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(within(pre as HTMLElement).getByText("go")).toBeInTheDocument();
    // Indentation and line breaks survive — the block would be worthless
    // otherwise.
    expect(pre?.querySelector("code")?.textContent).toBe("if beta {\n\treturn Assets()\n}");
  });

  it("leaves what it does not know standing instead of letting it vanish", () => {
    // The reader cannot do tables. A quietly swallowed table would be an
    // answer the companion gave and nobody can see any more.
    const table = "| File | Anchors |\n| --- | --- |\n| corpus.go | 3 |";
    const { container } = render(<Answer text={table} running={false} />);

    expect(container.textContent).toContain("corpus.go");
    expect(container.textContent).toContain("Anchors");
  });
});

describe("Answer — the writing caret", () => {
  it("stands inside the sentence while the answer is still being written", () => {
    render(<Answer text="I am reading" running={true} />);

    const caret = screen.queryByTestId("answer-caret");
    expect(caret).not.toBeNull();
    // Inside the paragraph, not under it: it marks where the next letter
    // appears.
    expect(caret?.closest("p")).not.toBeNull();
  });

  it("stands behind a block that has no place in a sentence to sit in", () => {
    render(<Answer text={"- one\n- two"} running={true} />);

    const caret = screen.queryByTestId("answer-caret");
    expect(caret).not.toBeNull();
    expect(caret?.closest("li")).toBeNull();
  });

  it("stands alone before the first word is there", () => {
    const { container } = render(<Answer text="" running={true} />);

    expect(screen.queryByTestId("answer-caret")).not.toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("disappears as soon as the answer stands", () => {
    // Mutation: retain the caret when running becomes false.
    const { rerender } = render(<Answer text="Done." running={true} />);
    expect(screen.getByTestId("answer-caret")).toBeInTheDocument();
    rerender(<Answer text="Done." running={false} />);
    expect(screen.queryByTestId("answer-caret")).toBeNull();
  });

  it("stands on the last block only, not on the ones already finished", () => {
    const { container } = render(
      <Answer text={"Erstens.\n\nZweitens.\n\nDrittens."} running={true} />,
    );

    const paragraphs = Array.from(container.querySelectorAll("p"));
    // The precondition: this fixture really does produce several blocks.
    // Against a single paragraph the assertion below would hold no matter
    // what the component does.
    expect(paragraphs).toHaveLength(3);

    const carrying = paragraphs.map((p) => within(p).queryByTestId("answer-caret") !== null);
    expect(carrying).toEqual([false, false, true]);
  });
});
