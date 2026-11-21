# Atlas translations

`en.json` is the source of truth. `de.json` and every additional file in
`locales/` must have exactly the same leaf keys.

## Key format

Every key has exactly three levels: `ui.<area>.<leaf>`.

- The namespace is `ui`.
- The area is the caller's current English folder, relative to `src/` for Atlas
  or `plugins/` for plugins. Flatten folder separators into hyphens.
  Files directly in `src/` use `root`.
- The leaf is the calling filename without its extension, followed by a slug of
  at most the first six meaningful words of the English text. The whole key is
  at most 80 characters; keep fewer whole words when needed to fit. Omit articles,
  conjunctions and common prepositions from the explicit stop-word list in the
  key naming script; keep the original words if all words would be omitted. Lowercase both, remove accents, and replace each run of
  non-alphanumeric characters with one hyphen. Keep English placeholder names;
  anonymous positional placeholders use first-value through fourth-value.
  For example, `reader/history.ts` asking for “Ask Atlas” uses
  `ui.reader.history-ask-atlas`.

Segments contain hyphens, never embedded dots, underscores, counters or hashes.
Plural forms append `-one` and `-other`; i18next uses `pluralSeparator: "-"`.
A constant containing a key belongs to the file defining the constant. Calls in
separate files receive separate keys. Fixture helpers follow the same caller rule. Retained entries without a
caller outside ordinary specs belong to the catalogue loader, `i18n/index.ts`, until used again.

**Collisions.** Only on collision, extend the six-word slug with further English words,
still within 80 characters, or append an English role. When
punctuation or case distinguishes two texts, use the English role, for example
`-tooltip`, `-button-text`, `-placeholder` or `-question`. Never use a counter or
hash. Identical texts in the same caller may share a key when their translations
also agree.

`pnpm i18n:lint` checks key shape, locale parity, rendered JSX and naming against
current callers and English text. `pnpm i18n:sync` copies missing English values
into other locales and runs the same naming check.

Atlas also accepts languages at runtime through the **+** button beside the
language selector. The JSON file must use this envelope and contain the exact
same `translation` tree as `locales/en.json`:

```json
{
  "code": "fr",
  "name": "Français",
  "translation": {}
}
```

Imported languages are validated, saved in local storage, and immediately
selected. They remain specific to that browser and are not uploaded.
