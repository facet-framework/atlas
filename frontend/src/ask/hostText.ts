/** Host sentences in the reader's language. */

import { resolveHostMessage, type HostMessage } from "@/i18n/host-message";
import type { AgentStream } from "@/model";

/** The companion's message codes this reader knows, each with its dictionary key. */

const HOST_MESSAGES: Readonly<Record<string, HostMessage>> = {
  "companion.sign-in": {
    key: "ui.ask.hosttext-sign-terminal-claude-auth-login-then",
  },
  "companion.nobody-signed-in": {
    key: "ui.ask.hosttext-nobody-signed-claude-code",
  },
  "companion.auth-unknown": {
    key: "ui.ask.hosttext-claude-code-does-not-say-who",
  },
  "companion.auth-unreadable": { key: "ui.ask.hosttext-sign-state-unreadable" },
};

/** A host sentence in the reader's language, or the sent text when the code is
 * unknown or absent — so a reader and a host of different ages keep working. */

export function hostText(code: string | null | undefined, sent: string): string {
  return resolveHostMessage(HOST_MESSAGES, code, undefined, sent);
}

/** The codes a `signin` step carries beside its text and hint. */
export type SignInCodes = { textCode?: string; hintCode?: string };

/** Reads the codes off a `signin` step's raw event. */

export function signInCodesOf(data: unknown): SignInCodes {
  if (typeof data !== "string") return {};
  try {
    const step = JSON.parse(data) as { textCode?: unknown; hintCode?: unknown };
    const out: SignInCodes = {};
    if (typeof step.textCode === "string") out.textCode = step.textCode;
    if (typeof step.hintCode === "string") out.hintCode = step.hintCode;
    return out;
  } catch {
    return {};
  }
}

/** Wraps a stream so the codes of its `signin` step are kept for the handler. */

export function keepingSignInCodes(base: AgentStream): {
  stream: AgentStream;
  codes: () => SignInCodes;
} {
  let last: SignInCodes = {};
  return {
    stream: {
      addEventListener(type, listener) {
        if (type !== "signin") return base.addEventListener(type, listener);
        base.addEventListener(type, (event) => {
          last = signInCodesOf(event.data);
          listener(event);
        });
      },
      close: () => base.close(),
    },
    codes: () => last,
  };
}
