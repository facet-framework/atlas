# Reader localization

Atlas owns the model, component and shell dictionaries in this directory.
The shared design system provides interpolation, plural rules, number formatting
and the React provider. `TextProvider` adds reader labels to that provider.
`useText` supplies the reader defaults when used outside an application provider.

Page translations live in `src/i18n/locales/`. German text belongs only in
German dictionary values; language tests obtain expected text from those values.
