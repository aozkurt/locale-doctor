import path from "node:path";
import { escapingProblems, type EscapingProblem } from "../android.js";
import { exampleList, expectedScript, languageName, pluralCategories, sameLanguage, type PluralCategoryInfo } from "../locale.js";
import type {
  ArrayMessage,
  Catalog,
  Issue,
  Layer,
  Location,
  Message,
  PluralCategory,
  PluralMessage,
  TextMessage,
} from "../model.js";
import { analyze, diffTokens, excerpt, isLatinWord, words, type Analysis, type Token } from "../text.js";

export interface RuleOptions {
  /** Texts that may stay the same as in the source language: "OK", "Email". */
  allowIdentical: Set<string>;
  ignoreKey: (key: string) => boolean;
}

type Report = (issue: Omit<Issue, "layer">) => void;

type Where = Pick<Issue, "locale" | "key" | "file" | "line" | "column">;

/** Android strings that usually stay the app's name in every language. */
export const OPTIONAL_ANDROID = new Set(["app_name", "title_activity_main"]);

const ESCAPING: Record<EscapingProblem, string> = {
  apostrophe: "Unescaped apostrophe — Android needs \\' (or the whole text in double quotes)",
  quote: 'Unescaped double quotes — Android drops them; write \\" to show one',
  reference: "Starts with @, so Android reads it as a resource reference — write \\@",
};

/** Runs every check that looks at one layer: each catalog on its own, then each translation against the source. */
export function checkLayer(layer: Layer, options: RuleOptions): Issue[] {
  const issues: Issue[] = [...layer.issues];
  new LayerCheck(layer, options, (issue) => issues.push({ layer: layer.path, ...issue })).run();
  return issues;
}

class LayerCheck {
  private readonly source: Catalog;
  private readonly keys: string[];
  /** Keys that no translation has: reported once rather than once per locale. */
  private readonly missingEverywhere = new Set<string>();
  /** For each source text, the share of translations that kept it unchanged. */
  private readonly identicalShare = new Map<string, number>();
  /** Plural forms used only for numbers like a million, collected into one note per layer. */
  private readonly rareForms = new Map<string, RareForm>();

  constructor(
    private readonly layer: Layer,
    private readonly options: RuleOptions,
    private readonly report: Report,
  ) {
    this.source = layer.source;
    this.keys = [...layer.source.messages.keys()].filter((key) => !options.ignoreKey(key));
  }

  run() {
    for (const catalog of [this.source, ...this.layer.targets]) this.checkCatalog(catalog);
    this.reportRareForms();
    // Without a readable source there is nothing to compare with; the parse error says why.
    if (this.layer.targets.length === 0 || this.source.broken) return;
    this.survey();
    this.reportMissingEverywhere();
    for (const target of this.layer.targets) this.compareCatalog(target);
  }

  private get sourceLabel() {
    return this.source.label;
  }

  // Checks that need only the catalog itself.

  private checkCatalog(catalog: Catalog) {
    for (const [key, message] of catalog.messages) {
      if (this.options.ignoreKey(key)) continue;
      if (this.layer.kind === "android") this.checkEscaping(catalog, message);
      if (!message.translatable) continue;
      if (message.kind === "plural") {
        this.checkPluralForms(catalog, message);
        this.checkImpliedQuantity(catalog, message);
      } else if (message.kind === "text" && this.layer.format === "icu") {
        this.checkIcu(catalog, message);
      }
    }
  }

  private checkEscaping(catalog: Catalog, message: Message) {
    const texts =
      message.kind === "text"
        ? [{ key: message.key, raw: message.raw, loc: message.loc }]
        : message.kind === "plural"
          ? [...message.forms].map(([category, form]) => ({ key: `${message.key} (${category})`, raw: form.raw, loc: form.loc }))
          : message.kind === "array"
            ? message.items.map((item, index) => ({ key: `${message.key}[${index}]`, raw: item.raw, loc: item.loc }))
            : [];
    for (const { key, raw, loc } of texts) {
      for (const problem of escapingProblems(raw)) {
        this.report({
          rule: "android-escaping",
          severity: problem === "quote" ? "warning" : "error",
          locale: catalog.label,
          key,
          ...at(loc),
          message: ESCAPING[problem],
        });
      }
    }
  }

  private checkPluralForms(catalog: Catalog, message: PluralMessage) {
    const language = languageName(catalog.locale);
    const categories = pluralCategories(catalog.locale, message.ordinal);
    const { everyday, rare } = splitCategories(categories);
    const names = (list: PluralCategory[]) => list.map((category) => formName(message, category)).join(", ");
    const where = { locale: catalog.label, key: message.key, ...at(message.loc) };

    const missing = everyday.filter((info) => !message.forms.has(info.category)).map((info) => info.category);
    if (missing.length > 0) {
      this.report({
        ...where,
        rule: "plural-forms",
        severity: missing.includes("other") ? "error" : "warning",
        message: `Missing ${names(missing)} — ${language} uses ${categories.map((info) => info.category).join(", ")}`,
      });
    }
    for (const info of rare) {
      if (!message.forms.has(info.category)) {
        const name = message.style === "android" ? `quantity="${info.category}"` : `_${info.category} form`;
        this.noteRareForm(name, catalog, info, message.loc);
      }
    }

    const used = new Set(categories.map((info) => info.category));
    for (const [category, form] of message.forms) {
      // i18next reads key_zero for a count of 0 in every language.
      if (used.has(category) || (message.style === "i18next" && category === "zero")) continue;
      const zero = category === "zero" && message.style === "android" ? `, not even for 0 (Android picks "other")` : "";
      this.report({
        ...where,
        ...at(form.loc),
        rule: "plural-forms",
        severity: message.style === "android" ? "warning" : "info",
        message: `${language} never uses ${formName(message, category)}${zero}`,
      });
    }
  }

  private noteRareForm(name: string, catalog: Catalog, info: PluralCategoryInfo, loc: Location) {
    const id = `${name}|${info.examples[0]}`;
    const entry = this.rareForms.get(id) ?? { name, example: info.examples[0]!, plurals: 0, locales: new Set(), languages: new Set(), loc };
    entry.plurals++;
    entry.locales.add(catalog.label);
    entry.languages.add(languageName(catalog.locale));
    this.rareForms.set(id, entry);
  }

  private reportRareForms() {
    for (const { name, example, plurals, locales, languages, loc } of this.rareForms.values()) {
      const where = locales.size === 1 ? { locale: [...locales][0] } : {};
      this.report({
        ...where,
        rule: "plural-forms",
        severity: "info",
        ...at(loc),
        message:
          `No ${name} in ${plurals === 1 ? "1 plural" : `${plurals} plurals`}${locales.size > 1 ? ` of ${[...locales].join(", ")}` : ""} — ` +
          `${[...languages].join(", ")} ${languages.size === 1 ? "uses" : "use"} it only for numbers like ${example.toLocaleString("en")}`,
      });
    }
  }

  private checkImpliedQuantity(catalog: Catalog, message: PluralMessage) {
    const reference = this.source.messages.get(message.key);
    const other = reference?.kind === "plural" ? reference.forms.get("other") : undefined;
    if (!other || !showsNumber(message, other.text)) return;
    const categories = pluralCategories(catalog.locale, message.ordinal);
    for (const [category, form] of message.forms) {
      if (category === "other") continue;
      const examples = categories.find((info) => info.category === category)?.examples.filter((n) => n <= 1000) ?? [];
      if (examples.length < 2 || showsNumber(message, form.text)) continue;
      this.report({
        rule: "plural-implied-quantity",
        severity: "warning",
        locale: catalog.label,
        key: message.key,
        ...at(form.loc),
        message: `The ${category} form has no number, but ${languageName(catalog.locale)} uses it for ${exampleList(examples)} — they would all read ${quote(form.text)}`,
      });
    }
  }

  private checkIcu(catalog: Catalog, message: TextMessage) {
    const analysis = analyze(message.text, "icu");
    const where = { locale: catalog.label, key: message.key, ...at(message.loc) };
    if (analysis.syntaxError) {
      this.report({ ...where, rule: "message-syntax", severity: "error", message: `Not a valid ICU message: ${analysis.syntaxError}` });
      return;
    }
    const language = languageName(catalog.locale);
    const sourceMessage = this.source.messages.get(message.key);
    const sourcePlurals =
      catalog === this.source ? analysis.icu!.plurals : sourceMessage?.kind === "text" ? (analyze(sourceMessage.text, "icu").icu?.plurals ?? []) : [];

    for (const plural of analysis.icu!.plurals) {
      const categories = pluralCategories(catalog.locale, plural.ordinal);
      const { everyday, rare } = splitCategories(categories);
      const argument = `{${plural.argument}, ${plural.ordinal ? "selectordinal" : "plural"}}`;
      const missing = everyday.filter((info) => !plural.options.includes(info.category)).map((info) => info.category);
      if (missing.length > 0) {
        this.report({
          ...where,
          rule: "plural-forms",
          severity: missing.includes("other") ? "error" : "warning",
          message: `${argument} has no ${missing.join(", ")} — ${language} uses ${categories.map((info) => info.category).join(", ")}`,
        });
      }
      for (const info of rare) {
        if (!plural.options.includes(info.category)) this.noteRareForm(`"${info.category}" option`, catalog, info, message.loc);
      }
      const reference = sourcePlurals.find((p) => p.argument === plural.argument && p.ordinal === plural.ordinal);
      if (!reference || reference.optionsWithoutNumber.includes("other")) continue;
      for (const option of plural.optionsWithoutNumber) {
        const examples = categories.find((info) => info.category === option)?.examples.filter((n) => n <= 1000) ?? [];
        if (option === "other" || examples.length < 2) continue;
        this.report({
          ...where,
          rule: "plural-implied-quantity",
          severity: "warning",
          message: `The ${option} option of ${argument} has no #, but ${language} uses it for ${exampleList(examples)}`,
        });
      }
    }
  }

  // Checks that compare the translations with the source.

  private survey() {
    for (const key of this.keys) {
      const message = this.source.messages.get(key)!;
      if (!message.translatable) continue;
      const targets = this.layer.targets.filter((target) => this.covers(target, message) === "yes");
      if (targets.length === 0) continue;
      const found = targets.map((target) => target.messages.get(key));
      if (targets.length === this.layer.targets.length && found.every((m) => m === undefined)) this.missingEverywhere.add(key);
      if (message.kind === "text") {
        const present = found.filter((m) => m !== undefined);
        const same = present.filter((m) => m.kind === "text" && m.text === message.text).length;
        if (present.length > 0) this.identicalShare.set(key, same / present.length);
      }
    }
  }

  private reportMissingEverywhere() {
    const count = this.layer.targets.length;
    for (const key of this.missingEverywhere) {
      const message = this.source.messages.get(key)!;
      const text = sourceText(message);
      if (this.layer.kind === "json") {
        this.report({
          rule: "missing-key",
          severity: "error",
          key,
          ...at(message.loc),
          message: `Missing in ${count === 1 ? "the translation" : `all ${count} translations`} (${this.sourceLabel}: ${quote(text)})`,
        });
      } else if (needsTranslation(message)) {
        const nameLike = OPTIONAL_ANDROID.has(key) || looksLikeName(text);
        this.report({
          rule: "not-translated-anywhere",
          severity: nameLike ? "info" : "warning",
          key,
          ...at(message.loc),
          message: nameLike
            ? `Only in ${this.sourceLabel}/ — if it stays the same in every language, mark it translatable="false"`
            : `Not translated in any of the ${count} locales (${this.sourceLabel}: ${quote(text)})`,
        });
      }
    }
  }

  private compareCatalog(target: Catalog) {
    this.reportMissingFiles(target);
    for (const key of this.keys) {
      const expected = this.source.messages.get(key)!;
      if (!expected.translatable || this.covers(target, expected) !== "yes") continue;
      const actual = target.messages.get(key);
      if (actual) {
        this.compareMessage(target, expected, actual);
      } else if (!this.missingEverywhere.has(key) && (this.layer.kind === "json" || needsTranslation(expected))) {
        this.report({
          rule: "missing-key",
          severity: "error",
          locale: target.label,
          key,
          file: this.fileFor(target, expected),
          message: `Missing (${this.sourceLabel}: ${quote(sourceText(expected))})`,
        });
      }
    }
    for (const [key, message] of target.messages) {
      if (this.source.messages.has(key) || this.options.ignoreKey(key) || !message.translatable) continue;
      const namespace = namespaceOf(target, message);
      if (namespace !== undefined && this.source.brokenNamespaces?.has(namespace)) continue;
      this.report({
        rule: "extra-key",
        severity: "warning",
        locale: target.label,
        key,
        ...at(message.loc),
        message: `Not in ${this.sourceLabel} — left over, or a typo in the key?`,
      });
    }
  }

  private reportMissingFiles(target: Catalog) {
    if (!this.source.namespaces || !target.namespaces) return;
    for (const [namespace, file] of this.source.namespaces) {
      if (target.namespaces.has(namespace) || target.brokenNamespaces?.has(namespace)) continue;
      const keys = this.keys.filter((key) => namespaceOf(this.source, this.source.messages.get(key)!) === namespace).length;
      const name = path.posix.basename(file);
      this.report({
        rule: "missing-file",
        severity: "error",
        locale: target.label,
        file: path.posix.join(path.posix.dirname(path.posix.dirname(file)), target.label, name),
        message: `No ${name} — ${this.sourceLabel} has ${keys} ${keys === 1 ? "key" : "keys"} in it`,
      });
    }
  }

  private compareMessage(target: Catalog, expected: Message, actual: Message) {
    if (expected.kind !== actual.kind) {
      this.report({
        rule: "type-mismatch",
        severity: "error",
        locale: target.label,
        key: actual.key,
        ...at(actual.loc),
        message: `${capitalize(kindName(actual))} here, ${kindName(expected)} in ${this.sourceLabel}`,
      });
      return;
    }
    const formatted = expected.formatted && actual.formatted;
    if (expected.kind === "text" && actual.kind === "text") {
      this.compareText(target, {
        key: actual.key,
        loc: actual.loc,
        expected: expected.text,
        actual: actual.text,
        formatted,
        share: this.identicalShare.get(expected.key),
      });
    } else if (expected.kind === "plural" && actual.kind === "plural") {
      this.comparePlural(target, expected, actual);
    } else if (expected.kind === "array" && actual.kind === "array") {
      this.compareArray(target, expected, actual);
    }
  }

  private comparePlural(target: Catalog, expected: PluralMessage, actual: PluralMessage) {
    const reference = expected.forms.get("other") ?? [...expected.forms.values()][0];
    if (!reference) return;
    // A form may leave the count out ("one night"); plural-implied-quantity decides when that is wrong.
    const isCount = (token: Token) => (expected.style === "android" ? token.id.endsWith("$d") : token.id === "{{count}}");
    for (const [category, form] of actual.forms) {
      this.compareText(target, {
        key: formName(actual, category, true),
        loc: form.loc,
        expected: (expected.forms.get(category) ?? reference).text,
        reference: reference.text,
        actual: form.text,
        formatted: expected.formatted && actual.formatted,
        mayDrop: isCount,
      });
    }
  }

  private compareArray(target: Catalog, expected: ArrayMessage, actual: ArrayMessage) {
    if (expected.items.length !== actual.items.length) {
      this.report({
        rule: "array-size",
        severity: "warning",
        locale: target.label,
        key: actual.key,
        ...at(actual.loc),
        message: `${actual.items.length} items here, ${expected.items.length} in ${this.sourceLabel}`,
      });
    }
    actual.items.forEach((item, index) => {
      const counterpart = expected.items[index];
      if (!counterpart) return;
      this.compareText(target, {
        key: `${actual.key}[${index}]`,
        loc: item.loc,
        expected: counterpart.text,
        actual: item.text,
        formatted: expected.formatted && actual.formatted,
      });
    });
  }

  private compareText(target: Catalog, pair: TextPair) {
    const where: Where = { locale: target.label, key: pair.key, ...at(pair.loc) };
    if (!pair.actual.trim()) {
      if (pair.expected.trim()) {
        this.report({ ...where, rule: "empty-value", severity: "warning", message: `Empty (${this.sourceLabel}: ${quote(pair.expected)})` });
      }
      return;
    }
    const reference = pair.reference ?? pair.expected;
    const before = analyze(reference, this.layer.format, pair.formatted);
    const after = analyze(pair.actual, this.layer.format, pair.formatted);
    if (!before.syntaxError && !after.syntaxError) this.comparePlaceholders(where, reference, before, after, pair.mayDrop);
    this.checkUntranslated(where, target, pair.expected, pair.actual, pair.share);
  }

  private comparePlaceholders(where: Where, reference: string, before: Analysis, after: Analysis, mayDrop?: (token: Token) => boolean) {
    const diff = diffTokens(before.tokens, after.tokens);
    const missing = diff.missing.filter((token) => !mayDrop?.(token));
    const source = `(${this.sourceLabel}: ${quote(reference)})`;

    const dropped = missing.filter((token) => token.kind === "placeholder");
    const added = diff.unknown.filter((token) => token.kind === "placeholder");
    // The same Android argument with another type: %1$s where the source has %1$d.
    const changed = added.filter((token) => token.argument !== undefined && dropped.some((d) => d.argument === token.argument));
    const parts = changed.map((token) => `${token.label} where ${this.sourceLabel} has ${dropped.find((d) => d.argument === token.argument)!.label}`);
    const gone = dropped.filter((token) => !changed.some((c) => c.argument === token.argument));
    const extra = added.filter((token) => !changed.includes(token));
    if (gone.length > 0) parts.push(`drops ${labels(gone)}`);
    if (extra.length > 0) parts.push(`has ${labels(extra)}, which ${this.sourceLabel} does not`);
    if (parts.length > 0) {
      this.report({ ...where, rule: "placeholder-mismatch", severity: "error", message: `${capitalize(parts.join("; "))} ${source}` });
    }

    const tagsGone = missing.filter((token) => token.kind === "tag");
    const tagsAdded = diff.unknown.filter((token) => token.kind === "tag");
    const tagParts = [
      ...(tagsGone.length > 0 ? [`drops ${labels(tagsGone)}`] : []),
      ...(tagsAdded.length > 0 ? [`has ${labels(tagsAdded)}, which ${this.sourceLabel} does not`] : []),
    ];
    if (tagParts.length > 0) {
      this.report({ ...where, rule: "placeholder-mismatch", severity: "warning", message: `${capitalize(tagParts.join("; "))} ${source}` });
    }

    if (this.layer.format === "android" && before.tokens.length > 0 && after.strayPercents > 0) {
      this.report({
        ...where,
        rule: "placeholder-mismatch",
        severity: "error",
        message: "Has a % that is not part of a format specifier — String.format throws on it or misreads it; write %% for a percent sign",
      });
    }
  }

  private checkUntranslated(where: Where, target: Catalog, expected: string, actual: string, share?: number) {
    if (sameLanguage(this.source.locale, target.locale) || this.options.allowIdentical.has(actual.trim())) return;
    const nameLike = looksLikeName(expected);
    if (actual === expected) {
      const list = words(expected);
      // Single words and units (Status, km/h) are often the same in other languages; names stay the same on purpose.
      if (list.length < 2 || !list.some((word) => word.length >= 4)) return;
      if (nameLike && (share ?? 0) >= 0.5) return;
      this.report({ ...where, rule: "untranslated", severity: "warning", message: `Same as ${this.sourceLabel}: ${quote(actual)}` });
      return;
    }
    const script = expectedScript(target.locale);
    if (!script || nameLike) return;
    const list = words(actual);
    const latin = list.filter(isLatinWord);
    if (latin.length >= 2 && latin.some((word) => word.length >= 4) && !list.some((word) => script.pattern.test(word))) {
      this.report({ ...where, rule: "untranslated", severity: "warning", message: `No ${script.name} text — looks untranslated: ${quote(actual)}` });
    }
  }

  private covers(target: Catalog, message: Message): "yes" | "no-file" | "broken" {
    if (target.broken) return "broken";
    const namespace = namespaceOf(this.source, message);
    if (namespace === undefined) return "yes";
    if (target.brokenNamespaces?.has(namespace)) return "broken";
    return target.namespaces?.has(namespace) ? "yes" : "no-file";
  }

  private fileFor(target: Catalog, message: Message): string {
    const namespace = namespaceOf(this.source, message);
    return (namespace !== undefined && target.namespaces?.get(namespace)) || target.file;
  }
}

interface RareForm {
  name: string;
  example: number;
  plurals: number;
  locales: Set<string>;
  languages: Set<string>;
  loc: Location;
}

interface TextPair {
  key: string;
  loc: Location;
  /** The source text in the same position, for the untranslated check. */
  expected: string;
  actual: string;
  /** The source text whose placeholders the translation must keep; `expected` when unset. */
  reference?: string;
  formatted: boolean;
  share?: number;
  /** Placeholders the translation may leave out. */
  mayDrop?: (token: Token) => boolean;
}

function splitCategories(categories: PluralCategoryInfo[]) {
  // French and Spanish use "many" only for millions; a missing form for those is worth a note, not a warning.
  const everyday = categories.filter((info) => info.category === "other" || info.examples.some((n) => n <= 1000));
  const rare = categories.filter((info) => !everyday.includes(info) && info.examples.length > 0);
  return { everyday, rare };
}

function namespaceOf(catalog: Catalog, message: Message): string | undefined {
  if (!catalog.namespaces) return undefined;
  for (const [namespace, file] of catalog.namespaces) {
    if (file === message.loc.file) return namespace;
  }
  return undefined;
}

function showsNumber(message: PluralMessage, text: string): boolean {
  if (message.style === "android") return analyze(text, "android", message.formatted).tokens.some((token) => token.id.endsWith("$d"));
  return analyze(text, "i18next").tokens.some((token) => token.id === "{{count}}");
}

/** How a plural form is named in messages: quantity="few" on Android, nights_few for i18next. */
function formName(message: PluralMessage, category: PluralCategory, asKey = false): string {
  if (message.style === "i18next") return `${message.base}_${message.ordinal ? "ordinal_" : ""}${category}`;
  return asKey ? `${message.key} (${category})` : `quantity="${category}"`;
}

function sourceText(message: Message): string {
  switch (message.kind) {
    case "text":
      return message.text;
    case "plural":
      return (message.forms.get("other") ?? [...message.forms.values()][0])?.text ?? "";
    case "array":
      return message.items.map((item) => item.text).join(", ");
    default:
      return "";
  }
}

/** Whether a source string has anything to translate: not a link, an e-mail address or a number. */
export function needsTranslation(message: Message): boolean {
  if (message.kind === "value") return false;
  if (message.kind !== "text") return true;
  const text = message.text.trim();
  return words(text).length > 0 && !/^https?:\/\/\S+$/.test(text) && !/^\S+@\S+\.\S+$/.test(text);
}

/** "Sleep Diary Plus": up to three capitalized words, not a sentence. */
function looksLikeName(text: string): boolean {
  const list = words(text);
  return list.length > 0 && list.length <= 3 && list.every((word) => /^\p{Lu}/u.test(word)) && !/[.!?:;,]$/.test(text.trim());
}

function kindName(message: Message): string {
  switch (message.kind) {
    case "text":
      return "text";
    case "plural":
      return "a plural";
    case "array":
      return "a list";
    default:
      return message.valueType === "null" ? "null" : `a ${message.valueType}`;
  }
}

function at(loc: Location): Pick<Issue, "file" | "line" | "column"> {
  return { file: loc.file, line: loc.line, column: loc.column };
}

function quote(text: string): string {
  return `"${excerpt(text)}"`;
}

function labels(tokens: Token[]): string {
  return tokens.map((token) => token.label).join(", ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
