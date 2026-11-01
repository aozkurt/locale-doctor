import { IcuSyntaxError, parseIcu, type IcuMessage } from "./icu.js";
import type { MessageFormat } from "./model.js";

/** A placeholder or tag that a translation has to keep. */
export interface Token {
  kind: "placeholder" | "tag";
  /** Equal for tokens that mean the same: {{ name }} and {{name}}, %d and %1$d. */
  id: string;
  /** The token as shown in messages. */
  label: string;
  /** Android format specifiers: the argument number, to tell a changed type from a dropped argument. */
  argument?: number;
}

export interface Analysis {
  tokens: Token[];
  /** Android only: % signs that are neither %% nor part of a format specifier. */
  strayPercents: number;
  icu?: IcuMessage;
  /** Why an ICU message could not be read. */
  syntaxError?: string;
}

const I18NEXT = /\{\{\s*-?\s*([^\s,}]+)[^}]*\}\}/g;
const I18NEXT_NESTING = /\$t\(\s*([^,)\s]+)[^)]*\)/g;
const SIMPLE = /\{\s*([\w$.-]+)\s*\}/g;
const PRINTF = /%(?:\d+\$)?[-#+0,(]*\d*(?:\.\d+)?[a-zA-Z@]/g;
const TAG = /<(\/?)([A-Za-z0-9][\w.:-]*)(?:\s[^<>]*)?\/?>/g;
// java.util.Formatter, which Android's getString(id, args) uses. Without the space flag, so that
// "50% off" counts as a stray % instead of the specifier "% o".
const JAVA = /%(?:(\d+)\$|(<))?[-#+0,(]*\d*(?:\.\d+)?([bBhHsScCdoxXeEfgGaA%n]|[tT][a-zA-Z])/g;

/** The placeholders and tags in a message, read the way its format reads them. */
export function analyze(text: string, format: MessageFormat, formatted = true): Analysis {
  if (format === "android") return analyzeAndroid(text, formatted);
  if (format === "icu") {
    try {
      const icu = parseIcu(text);
      const tokens = [
        ...icu.arguments.map((name) => placeholder(`{${name}}`)),
        ...icu.tags.map((name) => tag(name)),
      ];
      return { tokens, strayPercents: 0, icu };
    } catch (error) {
      if (error instanceof IcuSyntaxError) return { tokens: [], strayPercents: 0, syntaxError: error.message };
      throw error;
    }
  }
  const tokens: Token[] = [];
  let rest = text;
  if (format === "i18next") {
    rest = rest.replace(I18NEXT, (_, name: string) => {
      tokens.push(placeholder(`{{${name}}}`));
      return " ";
    });
    rest = rest.replace(I18NEXT_NESTING, (_, key: string) => {
      tokens.push(placeholder(`$t(${key})`));
      return " ";
    });
  }
  rest = rest.replace(SIMPLE, (_, name: string) => {
    tokens.push(placeholder(`{${name}}`));
    return " ";
  });
  rest = rest.replace(PRINTF, (specifier) => {
    tokens.push(placeholder(specifier));
    return " ";
  });
  for (const match of rest.matchAll(TAG)) {
    if (!match[1]) tokens.push(tag(match[2]!));
  }
  return { tokens: unique(tokens), strayPercents: 0 };
}

function analyzeAndroid(text: string, formatted: boolean): Analysis {
  if (!formatted) return { tokens: [], strayPercents: 0 };
  const tokens: Token[] = [];
  let next = 0;
  let previous = 0;
  let consumed = 0;
  for (const match of text.matchAll(JAVA)) {
    const conversion = match[3]!;
    consumed += match[0].split("%").length - 1;
    if (conversion === "%" || conversion === "n") continue;
    const argument = match[1] ? Number(match[1]) : match[2] ? previous : ++next;
    previous = argument;
    tokens.push({ kind: "placeholder", id: `%${argument}$${conversionKind(conversion)}`, label: match[0], argument });
  }
  const percents = text.split("%").length - 1;
  return { tokens: unique(tokens), strayPercents: percents - consumed };
}

function conversionKind(conversion: string): string {
  if ("doxX".includes(conversion)) return "d";
  if ("eEfgGaA".includes(conversion)) return "f";
  return conversion[0]!.toLowerCase();
}

function placeholder(label: string): Token {
  return { kind: "placeholder", id: label.replace(/\s+/g, ""), label };
}

function tag(name: string): Token {
  return { kind: "tag", id: `<${name}>`, label: `<${name}>` };
}

function unique(tokens: Token[]): Token[] {
  const seen = new Set<string>();
  return tokens.filter((token) => !seen.has(token.id) && seen.add(token.id));
}

export interface TokenDiff {
  missing: Token[];
  unknown: Token[];
}

export function diffTokens(source: Token[], target: Token[]): TokenDiff {
  const sourceIds = new Set(source.map((token) => token.id));
  const targetIds = new Set(target.map((token) => token.id));
  return {
    missing: source.filter((token) => !targetIds.has(token.id)),
    unknown: target.filter((token) => !sourceIds.has(token.id)),
  };
}

const NOT_WORDS = [
  /https?:\/\/\S+/g,
  /\S+@\S+\.\S+/g,
  /\{\{[^}]*\}\}/g,
  /\{\s*[\w$.-]+\s*,\s*(?:plural|selectordinal|select|number|date|time)\s*,?/g,
  /(?:=\d+|zero|one|two|few|many|other)\s*\{/g,
  /\{\s*[\w$.-]+\s*\}/g,
  /%(?:\d+\$)?[-#+0,(]*\d*(?:\.\d+)?[a-zA-Z@%]/g,
  /<[^<>]*>/g,
  /\$t\([^)]*\)/g,
];

/** The words of a message, placeholders, tags, links and plural keywords left out. */
export function words(text: string): string[] {
  let rest = text;
  for (const pattern of NOT_WORDS) rest = rest.replace(pattern, " ");
  return rest.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu) ?? [];
}

/** Text with placeholders and tags left out, for the "is it in the right script?" check. */
export function plainText(text: string): string {
  return words(text).join(" ");
}

export function isLatinWord(word: string): boolean {
  return /\p{Script=Latin}/u.test(word);
}

/** Shortens a text for a message: "Track your nights…". */
export function excerpt(text: string, length = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
