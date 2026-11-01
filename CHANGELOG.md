# Changelog

## 0.2.0 (unreleased)

- Reads catalogs written as JavaScript or TypeScript modules (`en.ts`, `de.js`, `pt-BR.mjs`) without running them: `export default { … }`, `export const messages = { … }` and `module.exports = { … }`, with template literals, functions, conditions and `plural(n, { one, other })` calls ([#3](https://github.com/aozkurt/locale-doctor/issues/3)). Their layers show as JS/TS modules, in the `module` format.
- In a module, the plural forms a language leaves out are notes, since modules pick their forms by hand, and `{ other }` alone is a word that never changes. A missing `other` is still an error.
- A new note, `dynamic-value`, for the parts of a module that are code rather than text: a spread, a computed key, a name from elsewhere, a call. The keys they may hold are not reported as missing.
- Fewer false alarms, found on apps with 16 languages:
  - Text left the same as the source is fine when the language writes those words in its own translations ("In Google Drive" in German, "deload in week" in Dutch).
  - A `%` before a letter is text when the source has no printf placeholders (Korean writes percentage points as `%p`).
  - An empty part of a sentence split around a link is fine when its text moved to the part the source leaves empty.
  - A layer without the language the other layers translate from gets a note: its text is usually in the code.
  - Android's default `values/` folder takes the language most layers translate from.
  - A form a language never uses in many plurals is one note for that language, not one per plural.

## 0.1.0 (2026-11-01)

The first version.

- Finds JSON catalogs (one file or one folder per locale) and Android string resources without configuration.
- Reads i18next, ICU MessageFormat and plain placeholders, and Android format specifiers.
- 16 checks, from missing keys and placeholders to plural forms per language, Android escaping and the languages each layer has.
- Pretty, JSON and GitHub Actions output; a config file to change rule levels and ignore paths, keys and texts.
