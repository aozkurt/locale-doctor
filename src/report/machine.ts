import path from "node:path";
import type { CheckResult } from "../model.js";

/** The whole result as JSON, for scripts. */
export function formatJson(result: CheckResult, version: string): string {
  return `${JSON.stringify({ version, ...result }, null, 2)}\n`;
}

const LEVELS = { error: "error", warning: "warning", info: "notice" } as const;

/**
 * GitHub Actions workflow commands, which show each issue as an annotation on its line in the
 * pull request. Paths are made relative to `cwd`, the folder the workflow runs in.
 */
export function formatGithub(result: CheckResult, cwd: string): string {
  const lines = result.issues.map((issue) => {
    const file = issue.file ? path.relative(cwd, path.join(result.root, issue.file)).split(path.sep).join("/") : undefined;
    const properties = [
      file !== undefined ? `file=${property(file)}` : undefined,
      issue.line !== undefined ? `line=${issue.line}` : undefined,
      issue.column !== undefined ? `col=${issue.column}` : undefined,
      `title=${property(`locale-doctor (${issue.rule})`)}`,
    ].filter(Boolean);
    const subject = [issue.locale, issue.key].filter(Boolean).join(" · ");
    return `::${LEVELS[issue.severity]} ${properties.join(",")}::${data(subject ? `${subject}: ${issue.message}` : issue.message)}`;
  });
  const { errors, warnings, infos } = result.summary;
  lines.push(`locale-doctor: ${errors} errors, ${warnings} warnings, ${infos} notes in ${result.layers.length} layers`);
  return `${lines.join("\n")}\n`;
}

function data(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function property(text: string): string {
  return data(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
