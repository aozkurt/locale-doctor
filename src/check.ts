import path from "node:path";
import { loadConfig, type Config } from "./config.js";
import { discover } from "./discover.js";
import { listFiles } from "./files.js";
import { loadAndroidLayer } from "./loaders/android.js";
import { loadJsonLayer } from "./loaders/json.js";
import { loadModuleLayer } from "./loaders/module.js";
import type { CheckResult, Issue, Layer, LayerSummary, Severity } from "./model.js";
import { checkCoverage } from "./rules/coverage.js";
import { checkLayer } from "./rules/layer.js";

export interface CheckOptions {
  /** The folder to check. Default: the current folder. */
  root?: string;
  /** The source language; overrides the config. */
  source?: string;
  /** A config to use instead of reading one from the folder. */
  config?: Config;
  /** A config file to read instead of locale-doctor.config.json. */
  configFile?: string;
}

/** Finds the translation files under a folder and checks them. */
export async function check(options: CheckOptions = {}): Promise<CheckResult> {
  const root = path.resolve(options.root ?? ".");
  const config = options.config ?? (await loadConfig(root, options.configFile)).config;
  const source = options.source ?? config.source;

  const groups = discover(await listFiles(root, config.ignore));
  const layers: Layer[] = [];
  for (const group of groups) {
    if (group.kind === "android") continue;
    const layer = group.kind === "json" ? await loadJsonLayer(root, group, source) : await loadModuleLayer(root, group, source);
    if (layer) layers.push(layer);
  }
  // Android's default values/ folder is in the source language of the rest of the app.
  const androidSource = source ?? appSource(layers) ?? "en";
  for (const group of groups) {
    if (group.kind !== "android") continue;
    const layer = await loadAndroidLayer(root, group, androidSource);
    if (layer) layers.push(layer);
  }

  const ruleOptions = { allowIdentical: new Set(config.allowIdentical ?? []), ignoreKey: keyMatcher(config.ignoreKeys ?? []) };
  const found = [...layers.flatMap((layer) => checkLayer(layer, ruleOptions)), ...checkCoverage(layers)];
  const issues = applyRuleSettings(found, config.rules ?? {}).sort(byPosition(layers));

  return {
    root,
    layers: layers.map(summarize),
    issues,
    summary: {
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      infos: issues.filter((issue) => issue.severity === "info").length,
    },
  };
}

/**
 * The language the layers translate from: the source of the most layers, then of the biggest. A
 * folder of translations whose source text is in the code falls back to another language.
 */
function appSource(layers: Layer[]): string | undefined {
  const sharing = (layer: Layer) => layers.filter((other) => other.source.locale === layer.source.locale).length;
  return [...layers].sort((a, b) => sharing(b) - sharing(a) || b.source.messages.size - a.source.messages.size)[0]?.source.locale;
}

function summarize(layer: Layer): LayerSummary {
  return {
    kind: layer.kind,
    path: layer.path,
    format: layer.format,
    source: layer.source.label,
    locales: layer.targets.map((target) => target.label),
    languages: [layer.source, ...layer.targets].map((catalog) => catalog.locale),
    keys: layer.source.messages.size,
  };
}

function keyMatcher(patterns: string[]): (key: string) => boolean {
  if (patterns.length === 0) return () => false;
  const expressions = patterns.map((pattern) => new RegExp(`^${pattern.split("*").map(escape).join(".*")}$`));
  return (key) => expressions.some((expression) => expression.test(key));
}

function escape(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function applyRuleSettings(issues: Issue[], rules: NonNullable<Config["rules"]>): Issue[] {
  return issues.flatMap((issue) => {
    const setting = rules[issue.rule];
    if (setting === "off") return [];
    return [tidy({ ...issue, severity: (setting as Severity | undefined) ?? issue.severity })];
  });
}

// The same field order in every issue, without unset fields, for readable JSON output.
function tidy(issue: Issue): Issue {
  const { rule, severity, message, layer, locale, key, file, line, column } = issue;
  return Object.fromEntries(
    Object.entries({ rule, severity, message, layer, locale, key, file, line, column }).filter(([, value]) => value !== undefined),
  ) as unknown as Issue;
}

function byPosition(layers: Layer[]) {
  const order = new Map(layers.map((layer, index) => [layer.path, index]));
  const text = (value: string | undefined) => value ?? "";
  return (a: Issue, b: Issue) =>
    (order.get(text(a.layer)) ?? -1) - (order.get(text(b.layer)) ?? -1) ||
    text(a.locale).localeCompare(text(b.locale)) ||
    text(a.file).localeCompare(text(b.file)) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    text(a.key).localeCompare(text(b.key));
}
