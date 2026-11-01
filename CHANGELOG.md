# Changelog

## 0.1.0 (unreleased)

The first version.

- Finds JSON catalogs (one file or one folder per locale) and Android string resources without configuration.
- Reads i18next, ICU MessageFormat and plain placeholders, and Android format specifiers.
- 16 checks, from missing keys and placeholders to plural forms per language, Android escaping and the languages each layer has.
- Pretty, JSON and GitHub Actions output; a config file to change rule levels and ignore paths, keys and texts.
