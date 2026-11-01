import path from "node:path";
import { parseArgs } from "node:util";
import { check } from "./check.js";
import { ConfigError } from "./config.js";
import { toLocale } from "./locale.js";
import { formatGithub, formatJson } from "./report/machine.js";
import { formatPretty } from "./report/pretty.js";
import { createStyle, createSymbols, supportsUnicode, wantsColor } from "./report/terminal.js";
import { VERSION } from "./version.js";

export interface Io {
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
  env: NodeJS.ProcessEnv;
  cwd: string;
  platform: NodeJS.Platform;
}

const HELP = `locale-doctor ${VERSION}
A checkup for the translations of mobile and hybrid apps.

Usage
  npx locale-doctor [folder] [options]

Finds JSON translation catalogs (locales/en.json, locales/en/common.json) and
Android string resources (res/values-*/strings.xml) in the folder, checks every
language against the source language, and the layers against each other.

Options
  -s, --source <locale>  The language the others are translated from
                         (default: en, or the most complete locale)
  -f, --format <name>    pretty (default), json, or github for annotations
                         in GitHub Actions
  -c, --config <file>    Config file (default: locale-doctor.config.json, or
                         "localeDoctor" in package.json)
      --strict           Exit with 1 on warnings too
  -q, --quiet            Show errors only
      --all              Show every problem (the default stops at 25 a locale)
      --no-color         Plain text output
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes
  0  no errors
  1  errors found (or warnings, with --strict)
  2  nothing to check, or a usage problem

https://github.com/aozkurt/locale-doctor
`;

/** Runs the command line with `argv` (without node and the script) and returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.stderr.write(`locale-doctor: ${message}\n`);
    return 2;
  };

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        source: { type: "string", short: "s" },
        format: { type: "string", short: "f" },
        config: { type: "string", short: "c" },
        strict: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        all: { type: "boolean" },
        color: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    return fail(`${(error as Error).message}\nRun locale-doctor --help to see the options.`);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (positionals.length > 1) return fail(`expected one folder, got ${positionals.length}: ${positionals.join(" ")}`);
  const format = values.format ?? "pretty";
  if (!["pretty", "json", "github"].includes(format)) return fail(`--format must be pretty, json or github, not "${format}"`);
  const source = values.source === undefined ? undefined : toLocale(values.source);
  if (values.source !== undefined && !source) return fail(`--source must be a language code such as en or pt-BR, not "${values.source}"`);

  const root = path.resolve(io.cwd, positionals[0] ?? ".");
  const started = performance.now();
  let result;
  try {
    result = await check({
      root,
      source,
      configFile: values.config === undefined ? undefined : path.resolve(io.cwd, values.config),
    });
  } catch (error) {
    if (error instanceof ConfigError) return fail(error.message);
    throw error;
  }
  const durationMs = performance.now() - started;

  if (result.layers.length === 0) {
    return fail(
      `found no translation files in ${root}\n` +
        "It looks for JSON catalogs named after their language (locales/en.json, locales/de.json or\n" +
        "locales/en/common.json) and Android resources (res/values/strings.xml, res/values-de/strings.xml).",
    );
  }

  if (format === "json") io.stdout.write(formatJson(result, VERSION));
  else if (format === "github") io.stdout.write(formatGithub(result, io.cwd));
  else {
    const color = values["no-color"] ? false : values.color ? true : wantsColor(io.env, io.stdout.isTTY);
    io.stdout.write(
      formatPretty(result, {
        style: createStyle(color),
        symbols: createSymbols(supportsUnicode(io.env, io.platform)),
        version: VERSION,
        quiet: values.quiet,
        all: values.all,
        durationMs,
      }),
    );
  }

  const { errors, warnings } = result.summary;
  return errors > 0 || (values.strict && warnings > 0) ? 1 : 0;
}
