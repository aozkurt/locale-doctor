import { localeKey } from "../locale.js";
import type { CheckResult, Issue, LayerSummary, Severity } from "../model.js";
import type { Style, Symbols } from "./terminal.js";

export interface PrettyOptions {
  style: Style;
  symbols: Symbols;
  version: string;
  /** Show errors only. */
  quiet?: boolean;
  /** Show every issue instead of the first ones per locale. */
  all?: boolean;
  durationMs?: number;
}

const LIMIT = 25;

const LAYER_NAMES = { json: "JSON catalogs", module: "JS/TS modules", android: "Android strings" } as const;

/** The report for people: one section per layer, issues grouped by locale. */
export function formatPretty(result: CheckResult, options: PrettyOptions): string {
  const { style, symbols } = options;
  const issues = options.quiet ? result.issues.filter((issue) => issue.severity === "error") : result.issues;
  const icon = (severity: Severity) =>
    severity === "error" ? style.red(symbols.error) : severity === "warning" ? style.yellow(symbols.warning) : style.cyan(symbols.info);
  const lines: string[] = [`${style.bold("locale-doctor")} ${style.dim(options.version)}`];
  let truncated = false;

  const printIssue = (issue: Issue) => {
    const text = `${issue.key ? `${style.bold(issue.key)}  ` : ""}${issue.message}`;
    lines.push(`    ${icon(issue.severity)} ${issue.severity === "info" ? style.dim(text) : text}`);
    const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}:${issue.column ?? 1}` : ""}` : "";
    lines.push(`      ${style.dim([location, issue.rule].filter(Boolean).join(" · "))}`);
  };

  for (const layer of result.layers) {
    lines.push("", heading(layer, style, symbols));
    const layerIssues = issues.filter((issue) => issue.layer === layer.path && issue.rule !== "layer-coverage");
    const groups: Array<[string | undefined, Issue[]]> = [];
    for (const label of [undefined, layer.source, ...layer.locales]) {
      const group = layerIssues.filter((issue) => issue.locale === label);
      if (group.length > 0) groups.push([label, group]);
    }
    for (const [label, group] of groups) {
      lines.push("", `  ${worst(group, icon)} ${style.bold(label ?? "all locales")}${label === layer.source ? style.dim(" (source)") : ""}  ${style.dim(counts(group))}`);
      const shown = options.all ? group : group.slice(0, LIMIT);
      shown.forEach(printIssue);
      if (shown.length < group.length) {
        truncated = true;
        lines.push(`    ${style.dim(`… and ${group.length - shown.length} more`)}`);
      }
    }
    const clean = layer.locales.filter((label) => !groups.some(([groupLabel]) => groupLabel === label));
    const none = options.quiet ? "No errors" : "No problems";
    if (clean.length > 0 && groups.length > 0) lines.push("");
    if (layer.locales.length === 0) {
      if (groups.length === 0) lines.push(`  ${style.green(symbols.ok)} ${none} ${style.dim("(no translations yet)")}`);
    } else if (clean.length === layer.locales.length && groups.length === 0) {
      lines.push(`  ${style.green(symbols.ok)} ${none} in ${layer.source} and its ${plural(clean.length, "translation")}`);
    } else if (clean.length > 0) {
      lines.push(`  ${style.green(symbols.ok)} ${none} in ${clean.join(", ")}`);
    }
  }

  if (result.layers.length > 1) {
    const coverage = issues.filter((issue) => issue.rule === "layer-coverage");
    lines.push("", style.bold("Across layers"));
    if (coverage.length === 0) {
      lines.push(`  ${style.green(symbols.ok)} Every layer has the same ${plural(languageCount(result), "language")}`);
    }
    for (const issue of coverage) {
      lines.push(`  ${icon(issue.severity)} ${style.bold(issue.layer ?? "")}  ${issue.message}`);
    }
  }

  lines.push("", summaryLine(result, options), "");
  if (truncated) lines.splice(-1, 0, style.dim("Run with --all to see every problem."), "");
  return lines.join("\n");
}

function heading(layer: LayerSummary, style: Style, symbols: Symbols): string {
  const details = [
    layer.kind !== "android" ? `${layer.format} format` : undefined,
    `${layer.source} → ${plural(layer.locales.length, "locale")}`,
    plural(layer.keys, layer.kind === "android" ? "string" : "key"),
  ].filter(Boolean);
  return `${style.cyan(symbols.bullet)} ${style.bold(LAYER_NAMES[layer.kind])}  ${layer.path}  ${style.dim(details.join(" · "))}`;
}

function summaryLine(result: CheckResult, options: PrettyOptions): string {
  const { style, symbols } = options;
  const { errors, warnings, infos } = result.summary;
  const scope = [
    plural(result.layers.length, "layer"),
    plural(languageCount(result), "language"),
    options.durationMs !== undefined ? `${(options.durationMs / 1000).toFixed(1)}s` : undefined,
  ].filter(Boolean);
  const parts = [
    errors > 0 ? style.red(`${symbols.error} ${plural(errors, "error")}`) : undefined,
    warnings > 0 && !options.quiet ? style.yellow(`${symbols.warning} ${plural(warnings, "warning")}`) : undefined,
    infos > 0 && !options.quiet ? style.cyan(`${symbols.info} ${plural(infos, "note")}`) : undefined,
  ].filter(Boolean);
  const verdict = parts.length > 0 ? parts.join("  ") : style.green(`${symbols.ok} No problems found`);
  return `${verdict}  ${style.dim(`(${scope.join(", ")})`)}`;
}

function languageCount(result: CheckResult): number {
  return new Set(result.layers.flatMap((layer) => layer.languages.map(localeKey))).size;
}

function worst(issues: Issue[], icon: (severity: Severity) => string): string {
  if (issues.some((issue) => issue.severity === "error")) return icon("error");
  if (issues.some((issue) => issue.severity === "warning")) return icon("warning");
  return icon("info");
}

function counts(issues: Issue[]): string {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const notes = issues.length - errors - warnings;
  return [
    errors > 0 ? plural(errors, "error") : undefined,
    warnings > 0 ? plural(warnings, "warning") : undefined,
    notes > 0 ? plural(notes, "note") : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
