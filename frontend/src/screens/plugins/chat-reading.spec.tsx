/** What the chat does while the reader reads: where the conversation box
 * scrolls while an answer grows, what a finished answer says it read, the
 * copy actions with their outcome, the glow of an answer nobody looked at,
 * and a notice above the composer. Every case reads what lands — the box's
 * scroll position, the rendered DOM, the accessible description. */

import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish as render } from "../testing";
import {
  ChatDock,
  ChatFull,
  ChatPill,
  ChatTurn,
  type ChatSessionVM,
  type ChatTurnVM,
  type ComposerProps,
} from "./Chat";
import { pinnedTop, standsAtTheBottom, tailroom } from "./chatScroll";

const composer: ComposerProps = { value: "", mode: "Ask", model: "Opus", context: [] };

function turn(i: number, over: Partial<NonNullable<ChatTurnVM["answer"]>> = {}): ChatTurnVM {
  return {
    id: `1-${i}`,
    question: `Question ${i}`,
    at: "",
    answer: { markdown: "Answer", state: "done", steps: [], sources: [], ...over },
  };
}

/** A faithful box ------------------------------------------------------------------ */

const CLIENT = 300;
const TURN = 100;

function installBox() {
  let top = 0;
  const box = () => screen.getByTestId("chat-scroll");
  const room = () => {
    const el = box().querySelector<HTMLElement>('[data-testid="chat-room"]');
    return el ? parseFloat(el.style.height) || 0 : 0;
  };
  const articles = () => [...box().querySelectorAll("article")];
  const scrollHeight = () => Math.max(CLIENT, articles().length * TURN + room());
  const isBox = (el: Element) => el.getAttribute("data-testid") === "chat-scroll";
  const spies = [
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isBox(this) ? CLIENT : 0;
    }),
    jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isBox(this) ? scrollHeight() : 0;
    }),
    jest.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return isBox(this) ? top : 0;
    }),
    jest.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
      this: Element,
      v: number,
    ) {
      if (isBox(this)) top = Math.max(0, Math.min(v, scrollHeight() - CLIENT));
    }),
    jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const i = this.tagName === "ARTICLE" ? articles().indexOf(this as HTMLElement) : -1;
      const y = i >= 0 ? i * TURN - top : 0;
      const height = i >= 0 ? TURN : isBox(this) ? CLIENT : 0;
      return {
        top: y,
        height,
        bottom: y + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y,
      } as DOMRect;
    }),
  ];
  return {
    get top() {
      return top;
    },
    /** The reader scrolls: the position moves and the browser fires its event. */
    readerScrolls(to: number) {
      top = Math.max(0, Math.min(to, scrollHeight() - CLIENT));
      fireEvent.scroll(box());
    },
    /** Something other than the reader moves the box, without an event. */
    shift(to: number) {
      top = to;
    },
    maxTop: () => scrollHeight() - CLIENT,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

describe("the conversation box pins the reader's own question", () => {
  let geo: ReturnType<typeof installBox>;
  beforeEach(() => {
    geo = installBox();
  });
  afterEach(() => geo.restore());

  const dock = (turns: ChatTurnVM[], follow?: boolean) => (
    <ChatDock title="conversation" turns={turns} composer={composer} follow={follow} />
  );

  it("scrolls the last turn to the top edge once the room below it is there", () => {
    const turns = [turn(0), turn(1), turn(2, { state: "streaming", markdown: "" })];
    render(dock(turns));
    // Three turns of 100 fill the box exactly: without room the box could not
    // scroll at all, and the first pin is clamped to 0.
    expect(screen.getByTestId("chat-room")).toHaveStyle({ height: `${CLIENT - TURN}px` });
    expect(geo.top).toBe(2 * TURN);
  });

  it("keeps pinning on every step until the reader scrolls, then leaves the box alone", () => {
    const first = [turn(0), turn(1), turn(2, { state: "streaming", markdown: "" })];
    const { rerender } = render(dock(first));
    expect(geo.top).toBe(200);
    // Something moves the box without the reader: the next step pins again.
    geo.shift(40);
    rerender(dock([turn(0), turn(1), turn(2, { state: "streaming", markdown: "One" })]));
    expect(geo.top).toBe(200);
    geo.readerScrolls(60);
    rerender(dock([turn(0), turn(1), turn(2, { state: "streaming", markdown: "A sentence" })]));
    expect(geo.top).toBe(60);
  });

  it("does not read the pin's own scroll event as the reader taking over", () => {
    const { rerender } = render(dock([turn(0), turn(1), turn(2, { state: "streaming" })]));
    expect(geo.top).toBe(200);
    // The browser reports the pin's own assignment as a scroll at exactly that position.
    fireEvent.scroll(screen.getByTestId("chat-scroll"));
    geo.shift(10);
    rerender(dock([turn(0), turn(1), turn(2, { state: "streaming", markdown: "more" })]));
    expect(geo.top).toBe(200);
  });

  it("aims again when a turn's entrance motion ends, without new content, until the reader scrolls", () => {
    render(dock([turn(0), turn(1), turn(2, { state: "streaming" })]));
    expect(geo.top).toBe(200);
    // The motion ends and layout settles elsewhere: nothing re-renders.
    geo.shift(195);
    fireEvent.animationEnd(screen.getAllByRole("article")[2]);
    expect(geo.top).toBe(200);
    geo.readerScrolls(60);
    fireEvent.animationEnd(screen.getAllByRole("article")[2]);
    expect(geo.top).toBe(60);
  });

  it("pins a new question again after the reader had scrolled", () => {
    const { rerender } = render(dock([turn(0), turn(1, { state: "streaming" })]));
    geo.readerScrolls(0);
    rerender(dock([turn(0), turn(1), turn(2, { state: "streaming", markdown: "" })]));
    expect(geo.top).toBe(200);
  });

  it("follows the bottom when asked to, pauses 24 px above it and resumes within 23 px", () => {
    // One running answer that grows by a step at a time.
    const step = (n: number) =>
      dock(
        [
          ...Array.from({ length: 4 }, (_, i) => turn(i)),
          turn(4, {
            state: "streaming",
            steps: Array.from({ length: n }, () => ({ label: "Read", state: "done" as const })),
          }),
        ],
        true,
      );
    const { rerender } = render(step(0));
    expect(screen.getByTestId("chat-room")).toHaveStyle({ height: "0px" });
    expect(geo.top).toBe(5 * TURN - CLIENT);
    geo.readerScrolls(geo.maxTop() - 24);
    rerender(step(1));
    expect(geo.top).toBe(geo.maxTop() - 24);
    geo.readerScrolls(geo.maxTop() - 23);
    rerender(step(2));
    expect(geo.top).toBe(geo.maxTop());
  });

  it("pins in the full view as in the dock", () => {
    render(
      <ChatFull
        title="conversation"
        turns={[turn(0), turn(1), turn(2, { state: "streaming" })]}
        composer={composer}
        sessions={[]}
        currentId="1"
        query=""
      />,
    );
    expect(geo.top).toBe(200);
  });
});

describe("the pin's arithmetic", () => {
  it("never asks for more than the box can scroll, nor for less than nothing", () => {
    expect(pinnedTop({ scrollHeight: 500, clientHeight: 300 }, 120)).toBe(120);
    expect(pinnedTop({ scrollHeight: 500, clientHeight: 300 }, 900)).toBe(200);
    expect(pinnedTop({ scrollHeight: 500, clientHeight: 300 }, -40)).toBe(0);
  });

  it("gives a short last turn the room it is missing, and nothing to a turn that fills the box", () => {
    expect(tailroom({ clientHeight: 300 }, 120)).toBe(180);
    expect(tailroom({ clientHeight: 300 }, 420)).toBe(0);
  });

  it("counts 23 px above the bottom as the bottom and 24 px as gone up to read", () => {
    expect(standsAtTheBottom({ scrollHeight: 500, clientHeight: 300, scrollTop: 177 })).toBe(true);
    expect(standsAtTheBottom({ scrollHeight: 500, clientHeight: 300, scrollTop: 176 })).toBe(false);
    expect(standsAtTheBottom({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 })).toBe(true);
  });
});

describe("what a finished answer read", () => {
  it("names the distinct files, the line ranges where read, and nothing written when backed", () => {
    render(
      <ChatTurn
        turn={turn(0, {
          read: { count: 2, files: ["README.md:1-20", "go.mod"], nothingWritten: true },
        })}
      />,
    );
    const footer = screen.getByTestId("answer-read");
    expect(footer).toHaveTextContent("2 files read · nothing written");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["README.md:1-20", "go.mod"]);
    expect(screen.getByRole("list", { name: "read" })).toBe(footer.querySelector("ul"));
  });

  it("says nothing about writing when the host's lists do not back it", () => {
    render(<ChatTurn turn={turn(0, { read: { count: 1, files: ["a.go"] } })} />);
    expect(screen.getByTestId("answer-read")).toHaveTextContent("1 file read");
    expect(screen.getByTestId("answer-read")).not.toHaveTextContent("written");
  });

  it.each([
    ["a running answer", { state: "streaming" as const }],
    ["a failed answer", { state: "failed" as const }],
    ["a stopped answer", { state: "stopped" as const }],
    ["a finished answer that read nothing", { read: { count: 0, files: [] } }],
  ])("shows no footer under %s", (_, over) => {
    render(<ChatTurn turn={turn(0, { read: { count: 1, files: ["a.go"] }, ...over })} />);
    expect(screen.queryByTestId("answer-read")).not.toBeInTheDocument();
  });
});

describe("copying", () => {
  it("copies the question through its own button and the answer through the actions", async () => {
    const onCopy = jest.fn();
    render(<ChatTurn turn={turn(0)} onCopy={onCopy} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy question" }));
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(onCopy.mock.calls).toEqual([["question"], ["markdown"]]);
  });

  it("confirms a copy the clipboard took and reports one it refused", () => {
    const { rerender } = render(
      <ChatTurn turn={turn(0)} onCopy={jest.fn()} copied={{ what: "markdown" }} />,
    );
    expect(screen.getByRole("button", { name: "Copied" })).toHaveAttribute("data-copy", "done");
    rerender(
      <ChatTurn turn={turn(0)} onCopy={jest.fn()} copied={{ what: "markdown", failed: true }} />,
    );
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not copied" })).toHaveAttribute(
      "data-copy",
      "failed",
    );
    rerender(
      <ChatTurn turn={turn(0)} onCopy={jest.fn()} copied={{ what: "question", failed: true }} />,
    );
    expect(screen.getByRole("button", { name: "Not copied" })).toHaveAttribute(
      "data-copy",
      "failed",
    );
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();
  });
});

describe("the glow of an answer nobody looked at", () => {
  const session = (over: Partial<ChatSessionVM>): ChatSessionVM => ({
    id: "1",
    title: "conversation",
    rounds: 1,
    mode: "Ask",
    ...over,
  });

  it("marks an unread session and describes its button as a new answer; a running one keeps its dot", () => {
    render(
      <ChatFull
        title="conversation"
        turns={[]}
        composer={composer}
        currentId="1"
        query=""
        sessions={[
          session({ id: "1", title: "Open" }),
          session({ id: "2", title: "Frisch", unread: true }),
          session({ id: "3", title: "Running", unread: true, running: true }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("chat-glow")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Frisch/ })).toHaveAccessibleDescription(
      "new answer",
    );
    expect(screen.getByRole("button", { name: /^Open/ })).not.toHaveAccessibleDescription();
    expect(
      screen.getByRole("button", { name: /running.*round/ }),
    ).not.toHaveAccessibleDescription();
  });

  it("marks the pill and the dock's full-view button", () => {
    const { unmount } = render(<ChatPill unread label="Ask Atlas" />);
    expect(screen.getByRole("button")).toHaveAccessibleDescription("new answer");
    unmount();
    render(<ChatPill unread running label="Ask Atlas" />);
    expect(screen.queryByTestId("chat-glow")).not.toBeInTheDocument();
  });

  it("marks the dock's full-view button while another conversation is unread", () => {
    render(<ChatDock title="conversation" turns={[]} composer={composer} othersUnread />);
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveAccessibleDescription(
      "new answer",
    );
  });
});

describe("a notice above the composer", () => {
  it("stands as a status in the dock and the full view, and not without a text", () => {
    const { rerender } = render(
      <ChatDock title="conversation" turns={[]} composer={composer} notice="Not saved" />,
    );
    expect(screen.getByTestId("chat-notice")).toHaveTextContent("Not saved");
    expect(screen.getByRole("status")).toBe(screen.getByTestId("chat-notice"));
    rerender(<ChatDock title="conversation" turns={[]} composer={composer} />);
    expect(screen.queryByTestId("chat-notice")).not.toBeInTheDocument();
    rerender(
      <ChatFull
        title="conversation"
        turns={[]}
        composer={composer}
        sessions={[]}
        currentId="1"
        query=""
        notice="Not saved"
      />,
    );
    expect(screen.getByTestId("chat-notice")).toHaveTextContent("Not saved");
  });
});
