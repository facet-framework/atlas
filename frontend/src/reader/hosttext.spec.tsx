import { germanLabel } from "@/i18n/testing-labels.spec-support";
/** The companion's coded sentences, drawn in the reader's language. */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentState, AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import Atlas from "./Atlas";
import type { HostReaders } from "./host";

const model = taskflowModel();

const SIGNED_IN: AgentState = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [
    { id: "", label: "Default" },
    { id: "haiku", label: "Haiku" },
  ],
  model: "",
};

/** The sign-in step the host sends, codes beside the English source text. */
const CODED_SIGNIN = {
  text: "Nobody is signed in to Claude Code.",
  textCode: "companion.nobody-signed-in",
  hint: "Sign in in a terminal: `claude auth login`. Then ask here again.",
  hintCode: "companion.sign-in",
};

function readersFor(agent: AgentState): HostReaders {
  return {
    repo: async () => {
      throw new Error("no repository in this spec");
    },
    agent: async () => agent,
    tools: async () => {
      throw new Error("no tools in this spec");
    },
    installed: async () => [],
  };
}

function scriptedStream() {
  const listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  const open = (): AgentStream => ({
    addEventListener: (type, l) => {
      (listeners[type] ??= []).push(l);
    },
    close: () => undefined,
  });
  const emit = (type: string, data: unknown) =>
    act(() => listeners[type]?.forEach((l) => l({ data: JSON.stringify(data) } as MessageEvent)));
  return { open, emit };
}

async function inLanguage(language: string) {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
}

function mount(path: string, agent: AgentState, openStream?: (url: string) => AgentStream) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={readersFor(agent)} openStream={openStream} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(async () => {
  await inLanguage("en");
});

describe("chat draws the host's coded sign-in step in the reader's language", () => {
  async function signInIn(language: "de" | "en", payload: Record<string, unknown>) {
    await inLanguage(language);
    const s = scriptedStream();
    const view = mount("/", SIGNED_IN, s.open);
    const words =
      language === "de"
        ? [germanLabel("Ask Atlas"), germanLabel("Question to Atlas"), germanLabel("Send")]
        : ["Ask Atlas", "Question to Atlas", "send"];
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(words[0]) }));
    await userEvent.type(screen.getByRole("textbox", { name: words[1] }), "Who?");
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${words[2]}`, "i") }));
    s.emit("signin", payload);
    return view.container;
  }

  it("in German", async () => {
    const container = await signInIn("de", CODED_SIGNIN);
    expect(container).toHaveTextContent(germanLabel("Nobody is signed in to Claude Code."));
    expect(container).not.toHaveTextContent("Nobody is signed in");
  });

  it("in English", async () => {
    const container = await signInIn("en", CODED_SIGNIN);
    expect(container).toHaveTextContent("Nobody is signed in to Claude Code.");
    expect(container).not.toHaveTextContent(germanLabel("Nobody is signed in to Claude Code."));
  });

  it("and shows the sent text for a code this reader does not know", async () => {
    const container = await signInIn("de", {
      text: "A newer host says this.",
      textCode: "companion.from-a-newer-host",
      hint: "Do the newer thing.",
      hintCode: "companion.also-unknown",
    });
    expect(container).toHaveTextContent("A newer host says this.");
  });
});

describe("chat names why the companion is unavailable in the reader's language", () => {
  const UNAVAILABLE = (reasonCode: string, reason: string) =>
    ({
      ...SIGNED_IN,
      auth: { ...SIGNED_IN.auth, available: false, reason, reasonCode },
    }) as AgentState;

  async function hostErrorIn(language: "de" | "en", agent: AgentState) {
    await inLanguage(language);
    const view = mount("/", agent);
    await userEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(language === "de" ? germanLabel("Ask Atlas") : "Ask Atlas"),
      }),
    );
    return view.container;
  }

  const CODED = UNAVAILABLE("companion.auth-unknown", "Claude Code does not say who is signed in.");

  it("in German", async () => {
    const container = await hostErrorIn("de", CODED);
    expect(container).toHaveTextContent(germanLabel("Claude Code does not say who is signed in."));
    expect(container).not.toHaveTextContent("does not say who is signed in");
  });

  it("in English", async () => {
    const container = await hostErrorIn("en", CODED);
    expect(container).toHaveTextContent("Claude Code does not say who is signed in.");
  });

  it("and in the host's own words for a code this reader does not know", async () => {
    const container = await hostErrorIn(
      "de",
      UNAVAILABLE("companion.from-a-newer-host", "The newer host is unavailable."),
    );
    expect(container).toHaveTextContent("The newer host is unavailable.");
  });
});

describe("names the host's default model in the reader's language", () => {
  async function aiSectionIn(language: "de" | "en") {
    await inLanguage(language);
    mount("/settings/ai", SIGNED_IN);
    // The model is stated as the host reports it; the reader offers no choice the host never sees.
    return within(await screen.findByTestId("ai-model"));
  }

  it("in German", async () => {
    const section = await aiSectionIn("de");
    expect(section.getAllByText(germanLabel("Default")).length).toBeGreaterThan(0);
    expect(section.queryByText("Default")).not.toBeInTheDocument();
  });

  it("in English", async () => {
    const section = await aiSectionIn("en");
    expect(section.getAllByText("Default").length).toBeGreaterThan(0);
    expect(section.queryByText(germanLabel("Default"))).not.toBeInTheDocument();
  });
});
