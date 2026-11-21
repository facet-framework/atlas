import de from "./locales/de.js";

/** The text in the page's language: English as written, German from its own file. */
export function word(text) {
  const german = globalThis.document?.documentElement.lang.startsWith("de");
  return german && Object.hasOwn(de, text) ? de[text] : text;
}
export const panel = {
  background: "var(--t-surface, white)",
  borderRadius: 12,
  padding: 20,
  minWidth: 0,
};
export const cell = {
  padding: "10px 16px",
  textAlign: "left",
  borderBottom: "1px solid var(--t-line, #ddd)",
  whiteSpace: "nowrap",
};
export const control = {
  padding: "9px 12px",
  marginLeft: 8,
  border: "1px solid var(--t-line-strong, #ccc)",
  borderRadius: 8,
  background: "var(--t-surface, white)",
  color: "inherit",
  maxWidth: "100%",
};
export const action = {
  padding: "10px 16px",
  borderRadius: 8,
  background: "var(--t-signal, #3a5ce0)",
  color: "var(--t-signal-ink, white)",
  justifySelf: "start",
  cursor: "pointer",
};
