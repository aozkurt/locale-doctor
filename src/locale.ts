import type { PluralCategory } from "./model.js";

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const dialectNames = new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "dialect", fallback: "code" });

const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

// Old codes that Intl rewrites and projects still use, mostly because Android does.
const LEGACY = new Map([
  ["in", "id"],
  ["iw", "he"],
  ["ji", "yi"],
]);

/**
 * The canonical BCP 47 tag when `name` is a language code ("pt_BR" → "pt-BR"), else undefined.
 * Words that only turn into a language through an alias ("src" → Sardinian "sc") are not codes.
 */
export function toLocale(name: string): string | undefined {
  const candidate = name.replace(/_/g, "-");
  if (!TAG.test(candidate)) return undefined;
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(candidate)[0]!;
  } catch {
    return undefined;
  }
  const language = new Intl.Locale(canonical).language;
  const written = candidate.split("-")[0]!.toLowerCase();
  if (written !== language && LEGACY.get(written) !== language) return undefined;
  return languageNames.of(language) ? canonical : undefined;
}

// Android qualifiers that look like language codes: "car" is the car UI mode, not Carib.
const ANDROID_NOT_LOCALES = new Set(["car"]);

/**
 * The locale of an Android values folder: null for the default "values", "pt-BR" for
 * "values-pt-rBR", "zh-Hans" for "values-b+zh+Hans". Undefined for folders that are not about
 * language (values-night, values-v21) or mix it with other qualifiers (values-de-land).
 */
export function androidLocale(folder: string): string | null | undefined {
  if (folder === "values") return null;
  if (!folder.startsWith("values-")) return undefined;
  const parts = folder.slice("values-".length).split("-");
  while (parts.length > 0 && /^(?:mcc|mnc)\d+$/.test(parts[0]!)) parts.shift();
  const first = parts.shift();
  if (!first) return undefined;
  let tag: string;
  if (first.startsWith("b+")) {
    tag = first.slice(2).split("+").join("-");
  } else {
    if (!/^[a-z]{2,3}$/.test(first) || ANDROID_NOT_LOCALES.has(first)) return undefined;
    tag = first;
    if (parts[0] && /^r(?:[A-Z]{2}|\d{3})$/.test(parts[0])) tag += `-${parts.shift()!.slice(1)}`;
  }
  if (parts.length > 0) return undefined;
  return toLocale(tag);
}

/** The values folder Android reads a locale from: "pt-BR" → "values-pt-rBR", "id" → "values-in". */
export function androidFolder(locale: string): string {
  const { language, script, region } = new Intl.Locale(locale);
  const legacy = [...LEGACY].find(([, modern]) => modern === language)?.[0];
  if (script) return `values-b+${[language, script, region].filter(Boolean).join("+")}`;
  return `values-${legacy ?? language}${region ? `-r${region}` : ""}`;
}

/** A key that is equal for tags meaning the same language: "zh-CN" and "zh-Hans", "pt" and "pt-BR", "in" and "id". */
export function localeKey(locale: string): string {
  try {
    return new Intl.Locale(locale).maximize().baseName;
  } catch {
    return locale.toLowerCase();
  }
}

export function sameLanguage(a: string, b: string): boolean {
  return new Intl.Locale(a).language === new Intl.Locale(b).language;
}

/** "Russian", "Brazilian Portuguese". */
export function languageName(locale: string): string {
  try {
    return dialectNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

const pluralRules = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string, ordinal: boolean): Intl.PluralRules {
  const id = `${locale}|${ordinal}`;
  let rules = pluralRules.get(id);
  if (!rules) {
    rules = new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" });
    pluralRules.set(id, rules);
  }
  return rules;
}

const SAMPLES = [...Array.from({ length: 1001 }, (_, n) => n), 10_000, 100_000, 1_000_000, 2_000_000, 1_000_000_000];

export interface PluralCategoryInfo {
  category: PluralCategory;
  /** Whole numbers (from a sample up to a billion) that pick this category, in order. */
  examples: number[];
}

const categoryCache = new Map<string, PluralCategoryInfo[]>();

// Node 22 lists a language's categories alphabetically and Node 24 in this order; messages use this one.
const CATEGORY_ORDER: PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

/** The plural categories a language uses, in the order zero, one, two, few, many, other, with the whole numbers that pick each one. */
export function pluralCategories(locale: string, ordinal = false): PluralCategoryInfo[] {
  const id = `${locale}|${ordinal}`;
  const cached = categoryCache.get(id);
  if (cached) return cached;
  const rules = rulesFor(locale, ordinal);
  const used = new Set(rules.resolvedOptions().pluralCategories as PluralCategory[]);
  const examples = new Map<PluralCategory, number[]>();
  for (const category of CATEGORY_ORDER) if (used.has(category)) examples.set(category, []);
  for (const n of SAMPLES) examples.get(rules.select(n) as PluralCategory)?.push(n);
  const result = [...examples].map(([category, numbers]) => ({ category, examples: numbers }));
  categoryCache.set(id, result);
  return result;
}

/** Formats example numbers for a message: "1, 21, 31, 41…". */
export function exampleList(numbers: number[], limit = 4): string {
  const shown = numbers.slice(0, limit).map(String);
  return numbers.length > limit ? `${shown.join(", ")}…` : shown.join(", ");
}

export interface Script {
  name: string;
  pattern: RegExp;
}

const SCRIPTS: Record<string, Script> = {
  Arab: { name: "Arabic", pattern: /\p{Script=Arabic}/u },
  Armn: { name: "Armenian", pattern: /\p{Script=Armenian}/u },
  Beng: { name: "Bengali", pattern: /\p{Script=Bengali}/u },
  Cyrl: { name: "Cyrillic", pattern: /\p{Script=Cyrillic}/u },
  Deva: { name: "Devanagari", pattern: /\p{Script=Devanagari}/u },
  Ethi: { name: "Ethiopic", pattern: /\p{Script=Ethiopic}/u },
  Geor: { name: "Georgian", pattern: /\p{Script=Georgian}/u },
  Grek: { name: "Greek", pattern: /\p{Script=Greek}/u },
  Gujr: { name: "Gujarati", pattern: /\p{Script=Gujarati}/u },
  Guru: { name: "Gurmukhi", pattern: /\p{Script=Gurmukhi}/u },
  Hans: { name: "Chinese", pattern: /\p{Script=Han}/u },
  Hant: { name: "Chinese", pattern: /\p{Script=Han}/u },
  Hebr: { name: "Hebrew", pattern: /\p{Script=Hebrew}/u },
  Jpan: { name: "Japanese", pattern: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u },
  Khmr: { name: "Khmer", pattern: /\p{Script=Khmer}/u },
  Knda: { name: "Kannada", pattern: /\p{Script=Kannada}/u },
  Kore: { name: "Korean", pattern: /[\p{Script=Hangul}\p{Script=Han}]/u },
  Laoo: { name: "Lao", pattern: /\p{Script=Lao}/u },
  Mlym: { name: "Malayalam", pattern: /\p{Script=Malayalam}/u },
  Mymr: { name: "Myanmar", pattern: /\p{Script=Myanmar}/u },
  Orya: { name: "Odia", pattern: /\p{Script=Oriya}/u },
  Sinh: { name: "Sinhala", pattern: /\p{Script=Sinhala}/u },
  Taml: { name: "Tamil", pattern: /\p{Script=Tamil}/u },
  Telu: { name: "Telugu", pattern: /\p{Script=Telugu}/u },
  Thaa: { name: "Thaana", pattern: /\p{Script=Thaana}/u },
  Thai: { name: "Thai", pattern: /\p{Script=Thai}/u },
  Tibt: { name: "Tibetan", pattern: /\p{Script=Tibetan}/u },
};

/** The script a language is written in, when it is not Latin: Cyrillic for "ru", Japanese for "ja". */
export function expectedScript(locale: string): Script | undefined {
  let script: string | undefined;
  try {
    script = new Intl.Locale(locale).maximize().script;
  } catch {
    return undefined;
  }
  if (!script || script === "Latn") return undefined;
  return SCRIPTS[script];
}
