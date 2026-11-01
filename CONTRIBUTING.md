# Contributing

Thanks for helping. Bug reports with a small example of the files that confused locale-doctor are the most useful thing you can send.

## Setup

You need Node 22 or newer for the tests (the command itself runs on Node 20).

```sh
npm ci
npm test
npm run build
node dist/cli.js test/fixtures/capacitor-app
```

`npm run typecheck` checks the types of the source and the tests.

## Where things are

| Path | What it does |
| --- | --- |
| `src/files.ts` | Lists the files of the checked folder (git, or a folder walk) |
| `src/discover.ts` | Picks out the translation files and groups them into layers |
| `src/loaders/` | Reads JSON catalogs, JS/TS modules and Android resources into catalogs of messages |
| `src/parsers/` | The JSON and XML parsers, which keep line numbers and duplicate keys, and the reader of a module's exported object (`module.ts`), which runs no code |
| `src/text.ts`, `src/icu.ts` | Placeholders, tags and ICU messages |
| `src/rules/` | The checks |
| `src/report/` | The pretty, JSON and GitHub outputs |
| `test/fixtures/` | Small projects with planted problems |

## Adding a check

1. Add its id to `RULES` in `src/model.ts`.
2. Report it from `src/rules/layer.ts` (or a new file under `src/rules/`). Messages say what is wrong and, when it helps, what to write instead.
3. Plant the problem in a fixture and add it to the expected list in `test/check.test.ts`.
4. Add a row to the rules table in the README.

The README shows real output of `test/fixtures/capacitor-app`, and a test checks that it still matches. When the output changes, update the text between `<!-- demo:start -->` and `<!-- demo:end -->` and run `npm run demo` to redraw `docs/demo.svg`.

A check should stay quiet on correct files: run it on a real project with many languages before opening the pull request, and say in the pull request which one.
