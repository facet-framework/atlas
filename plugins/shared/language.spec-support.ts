/** The language a plugin spec reads its labels in. */

import { act } from "@testing-library/react";
import i18n from "../../frontend/src/i18n";

/** Switches the whole spec file to English: call it once at the top level. */
export function inEnglish(): void {
  let before = "";
  beforeAll(async () => {
    before = i18n.language;
    await i18n.changeLanguage("en");
  });
  afterAll(async () => {
    await i18n.changeLanguage(before);
  });
}

/** Runs `run` with German as the active language, then restores the previous one. */
export async function inGerman<T>(run: () => T | Promise<T>): Promise<T> {
  const before = i18n.language;
  await act(async () => {
    await i18n.changeLanguage("de");
  });
  try {
    return await run();
  } finally {
    await act(async () => {
      await i18n.changeLanguage(before);
    });
  }
}
