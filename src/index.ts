export { check, type CheckOptions } from "./check.js";
export { ConfigError, loadConfig, type Config } from "./config.js";
export { RULES } from "./model.js";
export type { CheckResult, Issue, LayerKind, LayerSummary, MessageFormat, RuleId, Severity } from "./model.js";
export { formatGithub, formatJson } from "./report/machine.js";
export { formatPretty, type PrettyOptions } from "./report/pretty.js";
export { createStyle, createSymbols } from "./report/terminal.js";
