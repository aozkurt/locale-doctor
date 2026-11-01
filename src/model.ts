export type Severity = "error" | "warning" | "info";

/** Every check locale-doctor runs. A config file can turn each one off or change its severity. */
export const RULES = [
  "parse-error",
  "dynamic-value",
  "duplicate-key",
  "missing-file",
  "missing-key",
  "extra-key",
  "type-mismatch",
  "array-size",
  "placeholder-mismatch",
  "message-syntax",
  "plural-forms",
  "plural-implied-quantity",
  "empty-value",
  "untranslated",
  "android-escaping",
  "not-translated-anywhere",
  "layer-coverage",
] as const;

export type RuleId = (typeof RULES)[number];

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export interface Location {
  /** Path relative to the checked folder, with forward slashes. */
  file: string;
  line: number;
  column: number;
}

/** One plural form or array item. */
export interface Form {
  /** The text as the app shows it. */
  text: string;
  /** The text as written in the file (Android escapes and all). */
  raw: string;
  loc: Location;
}

interface MessageBase {
  /** The key as the project writes it: "settings.title", "common:save", "widget_title". */
  key: string;
  loc: Location;
  /** False for strings that must stay the same in every language (Android translatable="false"). */
  translatable: boolean;
  /** False for Android strings marked formatted="false", where % is plain text. */
  formatted: boolean;
}

export interface TextMessage extends MessageBase {
  kind: "text";
  text: string;
  raw: string;
  /** JS and TS modules: the parameters of a message that is a function. */
  params?: string[];
  /** JS and TS modules: the plural(n, { … }) calls in the message, each checked for the forms its language needs. */
  plurals?: PluralMessage[];
}

export interface PluralMessage extends MessageBase {
  kind: "plural";
  /** "android" for <plurals>, "i18next" for key_one / key_other groups, "module" for plural(n, { one, other }) in a JS or TS module. */
  style: "android" | "i18next" | "module";
  /**
   * The key without the plural suffix: "nights" for nights_one and nights_other. For a module plural,
   * the call as messages name it ("plural(n, …)"), empty when it is the whole message.
   */
  base: string;
  /** Module plurals: the placeholder that # stands for, "{n}". */
  count?: string;
  ordinal: boolean;
  forms: Map<PluralCategory, Form>;
}

export interface ArrayMessage extends MessageBase {
  kind: "array";
  items: Form[];
}

/** A JSON value that is not text: a number, true/false or null. */
export interface ValueMessage extends MessageBase {
  kind: "value";
  valueType: "number" | "boolean" | "null";
}

export type Message = TextMessage | PluralMessage | ArrayMessage | ValueMessage;

export interface Catalog {
  /** BCP 47 tag: "pt-BR", "zh-Hans". */
  locale: string;
  /** What the project calls it: "pt-BR" in a JSON folder, "values-pt-rBR" on Android. */
  label: string;
  /** The file a missing key belongs in. */
  file: string;
  messages: Map<string, Message>;
  /** Set when a file of this locale could not be read, so its keys are not reported as missing. */
  broken: boolean;
  /** Folder-per-locale layouts: namespace ("common") to file, and the namespaces whose file is broken. */
  namespaces?: Map<string, string>;
  brokenNamespaces?: Set<string>;
  /**
   * JS and TS modules: keys whose value is code locale-doctor cannot read, and objects with a spread or
   * a computed key ("" for the top). Keys at or under them are not reported as missing or extra.
   */
  unread?: Set<string>;
  /** Hint set by loaders for catalog formats that use structured message objects. */
  formatHint?: MessageFormat;
}

export type LayerKind = "json" | "module" | "android";

/**
 * How placeholders are written: {{name}}, ICU {name, plural, ...}, plain {name}, a module's template
 * literals and plural() calls, or Android's %1$s.
 */
export type MessageFormat = "i18next" | "icu" | "simple" | "module" | "android" | "webextension";

/** One set of translation files that belong together: a JSON or module locales folder, or an Android res folder. */
export interface Layer {
  kind: LayerKind;
  /** The folder, relative to the checked folder: "src/locales", "android/app/src/main/res". */
  path: string;
  format: MessageFormat;
  source: Catalog;
  targets: Catalog[];
  /** Problems found while reading the files: parse errors, duplicate keys. */
  issues: Issue[];
}

export interface Issue {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** The layer's folder. */
  layer?: string;
  /** The locale's label ("tr", "values-tr"); unset when the issue is about every locale. */
  locale?: string;
  key?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface LayerSummary {
  kind: LayerKind;
  path: string;
  format: MessageFormat;
  /** Label of the source locale. */
  source: string;
  /** Labels of the translated locales. */
  locales: string[];
  /** BCP 47 tags of the source and the translations, in the same order. */
  languages: string[];
  /** Number of keys in the source locale. */
  keys: number;
}

export interface CheckResult {
  root: string;
  layers: LayerSummary[];
  issues: Issue[];
  summary: { errors: number; warnings: number; infos: number };
}
