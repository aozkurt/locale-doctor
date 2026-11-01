import type { PluralCategory } from "../model.js";
import { lineCounter, type Position } from "./position.js";

/** A catalog read from a JavaScript or TypeScript module: the object it exports. */
export interface ModuleObject {
  type: "object";
  offset: number;
  entries: ModuleEntry[];
  /** Spreads, computed keys and entries that could not be read: they may add keys nobody can see. */
  unread: Unread[];
}

export interface ModuleEntry {
  key: string;
  /** Offset of the key. */
  offset: number;
  value: ModuleValue;
}

export interface ModuleArray {
  type: "array";
  offset: number;
  items: ModuleValue[];
}

/**
 * A message: a string, a template literal, a plural(n, { … }) call, or a function returning one of
 * them. `${name}` is written {name}, a condition's texts are joined with |, and a plural shows its
 * other form.
 */
export interface ModuleText {
  type: "text";
  offset: number;
  text: string;
  /** The code as written. */
  raw: string;
  /** For a function: its parameters, in order. */
  params?: string[];
  plurals: ModulePlural[];
}

export interface ModulePlural {
  /** How messages name it: "plural(n, …)"; empty when the plural is the whole message. */
  name: string;
  /** The placeholder that # stands for: "{n}". Unset for an object of forms without a call. */
  count?: string;
  offset: number;
  forms: Map<PluralCategory, ModuleForm>;
}

export interface ModuleForm {
  text: string;
  raw: string;
  /** Offset of the category's key. */
  offset: number;
}

export interface ModuleScalar {
  type: "number" | "boolean" | "null";
  offset: number;
}

/** A value that is code rather than text: a name from elsewhere, a call, a function with a body. */
export interface ModuleSkipped {
  type: "skipped";
  offset: number;
  /** Why it was skipped, for the note: "brandName comes from elsewhere". */
  what: string;
}

export interface Unread {
  offset: number;
  /** "...common is a spread, so the keys it adds are not checked". */
  what: string;
}

export type ModuleValue = ModuleObject | ModuleArray | ModuleText | ModuleScalar | ModuleSkipped;

export interface ParsedModule {
  /** The exported object; unset when the module exports none. */
  value?: ModuleObject;
  position: (offset: number) => Position;
}

export class ModuleSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

const CATEGORIES = new Set<string>(["zero", "one", "two", "few", "many", "other"]);

/**
 * Reads the object a translation module exports (export default { … }, export const messages =
 * { … }, module.exports = { … }) without running it. What it cannot read is kept as a skipped
 * value or an unread part of its object, so the rest of the catalog can still be checked.
 */
export function parseModule(source: string): ParsedModule {
  const position = lineCounter(source);
  const fail = (message: string, at: number): never => {
    const { line, column } = position(at);
    throw new ModuleSyntaxError(message, line, column);
  };
  const list = new List(tokenize(source, source.charCodeAt(0) === 0xfeff ? 1 : 0, false, fail).tokens);
  const found = findExport(list);
  return { value: found === undefined ? undefined : new Reader(source).object(list, found), position };
}

// Tokens

type Token =
  | { type: "name" | "string" | "number" | "regex" | "punct"; value: string; start: number; end: number }
  | { type: "template"; value: string; start: number; end: number; quasis: string[]; expressions: List[] };

/** Tokens with the index of each bracket's partner, so a value's end is found without parsing it. */
class List {
  readonly partner: number[];

  constructor(readonly tokens: Token[]) {
    this.partner = new Array<number>(tokens.length).fill(-1);
    const open: number[] = [];
    tokens.forEach((token, index) => {
      if (token.type !== "punct") return;
      if (token.value === "(" || token.value === "[" || token.value === "{") open.push(index);
      else if (token.value === ")" || token.value === "]" || token.value === "}") {
        const opener = open.pop();
        if (opener === undefined) return;
        this.partner[opener] = index;
        this.partner[index] = opener;
      }
    });
  }

  is(index: number, value: string): boolean {
    const token = this.tokens[index];
    return token !== undefined && (token.type === "punct" || token.type === "name") && token.value === value;
  }

  /** The index after the bracket at `index`, or after the token when it is not a bracket. */
  skip(index: number): number {
    const partner = this.partner[index]!;
    return partner > index ? partner + 1 : index + 1;
  }

  /** The indexes of the tokens equal to `value` in [start, end) that are not inside brackets. */
  split(start: number, end: number, value: string): number[] {
    const found: number[] = [];
    for (let i = start; i < end; i = this.skip(i)) if (this.is(i, value)) found.push(i);
    return found;
  }
}

const PUNCTUATORS = [
  "...", "===", "!==", "**=", "&&=", "||=", "??=", "=>", "==", "!=", "&&", "||", "??", "?.", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**",
];
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);
const NAME_START = /[\p{ID_Start}$_]/u;
const NAME = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y;
const SPACE = /[\s﻿]/;
const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };

/**
 * Splits code into tokens. Inside a template literal's ${…} (`nested`), it stops at the } that
 * closes it and returns where that is.
 */
function tokenize(source: string, from: number, nested: boolean, fail: (message: string, at: number) => never): { tokens: Token[]; end: number } {
  const tokens: Token[] = [];
  let i = from;
  let depth = 0;
  if (source.startsWith("#!", i)) i = lineEnd(source, i);

  const escape = (at: number): { value: string; next: number } => {
    const c = source[at + 1];
    if (c === undefined) fail("A string that is never closed", at);
    if (c === "\r") return { value: "", next: source[at + 2] === "\n" ? at + 3 : at + 2 };
    if (c === "\n" || c === " " || c === " ") return { value: "", next: at + 2 };
    if (c === "x") {
      const hex = source.slice(at + 2, at + 4);
      if (/^[\da-fA-F]{2}$/.test(hex)) return { value: String.fromCharCode(parseInt(hex, 16)), next: at + 4 };
    }
    if (c === "u") {
      const braced = /^\{([\da-fA-F]+)\}/.exec(source.slice(at + 2, at + 12));
      if (braced) return { value: String.fromCodePoint(parseInt(braced[1]!, 16)), next: at + 2 + braced[0].length };
      const hex = source.slice(at + 2, at + 6);
      if (/^[\da-fA-F]{4}$/.test(hex)) return { value: String.fromCharCode(parseInt(hex, 16)), next: at + 6 };
    }
    return { value: SIMPLE_ESCAPES[c!] ?? c!, next: at + 2 };
  };

  const regexAllowed = () => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    if (previous.type === "name") return KEYWORDS_BEFORE_EXPRESSION.has(previous.value);
    return previous.type === "punct" && previous.value !== ")" && previous.value !== "]" && previous.value !== "}";
  };

  // A regular expression ends at its first / outside a character class, and never spans lines.
  const regexEnd = (start: number): number | undefined => {
    let inClass = false;
    for (let j = start + 1; j < source.length; j++) {
      const c = source[j]!;
      if (c === "\n" || c === "\r") return undefined;
      if (c === "\\") j++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        let end = j + 1;
        while (end < source.length && /[a-z]/i.test(source[end]!)) end++;
        return end;
      }
    }
    return undefined;
  };

  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (SPACE.test(c)) {
      i++;
    } else if (c === "/" && next === "/") {
      i = lineEnd(source, i);
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) fail("A comment that is never closed", i);
      i = end + 2;
    } else if (c === '"' || c === "'") {
      let value = "";
      let j = i + 1;
      for (;;) {
        const d = source[j];
        if (d === undefined || d === "\n" || d === "\r") fail("A string that is never closed", i);
        if (d === c) break;
        if (d === "\\") {
          const escaped = escape(j);
          value += escaped.value;
          j = escaped.next;
        } else {
          value += d;
          j++;
        }
      }
      tokens.push({ type: "string", value, start: i, end: j + 1 });
      i = j + 1;
    } else if (c === "`") {
      const quasis: string[] = [];
      const expressions: List[] = [];
      let quasi = "";
      let j = i + 1;
      for (;;) {
        const d = source[j];
        if (d === undefined) fail("A template literal that is never closed", i);
        if (d === "`") break;
        if (d === "\\") {
          const escaped = escape(j);
          quasi += escaped.value;
          j = escaped.next;
        } else if (d === "$" && source[j + 1] === "{") {
          quasis.push(quasi);
          quasi = "";
          const inner = tokenize(source, j + 2, true, fail);
          expressions.push(new List(inner.tokens));
          j = inner.end + 1;
        } else {
          quasi += d;
          j++;
        }
      }
      quasis.push(quasi);
      tokens.push({ type: "template", value: "", start: i, end: j + 1, quasis, expressions });
      i = j + 1;
    } else if (/\d/.test(c) || (c === "." && next !== undefined && /\d/.test(next))) {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(source)!;
      tokens.push({ type: "number", value: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
    } else if (NAME_START.test(c) || (c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdbff)) {
      NAME.lastIndex = i;
      const match = NAME.exec(source);
      if (!match) fail(`Unexpected ${JSON.stringify(c)}`, i);
      tokens.push({ type: "name", value: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
    } else if (c === "/" && regexAllowed() && regexEnd(i) !== undefined) {
      const end = regexEnd(i)!;
      tokens.push({ type: "regex", value: source.slice(i, end), start: i, end });
      i = end;
    } else {
      if (nested) {
        if (c === "{") depth++;
        else if (c === "}" && depth-- === 0) return { tokens, end: i };
      }
      // `?.` before a digit is a conditional followed by a decimal number: a ?.5 : 1.
      const punctuator =
        PUNCTUATORS.find((p) => source.startsWith(p, i) && !(p === "?." && next === "." && /\d/.test(source[i + 2] ?? ""))) ?? c;
      tokens.push({ type: "punct", value: punctuator, start: i, end: i + punctuator.length });
      i += punctuator.length;
    }
  }
  if (nested) fail("A ${ that is never closed", from - 2);
  return { tokens, end: i };
}

function lineEnd(source: string, from: number): number {
  const end = source.slice(from).search(/[\r\n]/);
  return end === -1 ? source.length : from + end;
}

// Finding the exported object

/** The index of the { that opens the exported object, if the module exports one. */
function findExport(list: List): number | undefined {
  const objects = new Map<string, number>();
  const exported: string[] = [];
  let defaultExport: number | string | undefined;
  const { tokens } = list;

  // The object a value is, or the name it refers to: { … }, { … } as const, define({ … }), messages.
  const target = (index: number): number | string | undefined => {
    const token = tokens[index];
    if (!token) return undefined;
    if (list.is(index, "{")) return index;
    if (token.type !== "name") return undefined;
    if (list.is(index + 1, "(") && list.is(index + 2, "{") && list.partner[index + 2]! + 1 === list.partner[index + 1]) return index + 2;
    if (list.is(index + 1, "(") || list.is(index + 1, ".") || list.is(index + 1, "=>")) return undefined;
    return token.value;
  };

  for (let i = 0; i < tokens.length; i = list.skip(i)) {
    if (list.is(i, "export") && list.is(i + 1, "default")) {
      defaultExport = target(i + 2);
    } else if (list.is(i, "module") && list.is(i + 1, ".") && list.is(i + 2, "exports") && list.is(i + 3, "=")) {
      defaultExport = target(i + 4);
    } else if (list.is(i, "export") && list.is(i + 1, "=")) {
      defaultExport = target(i + 2);
    } else if (list.is(i, "export") && list.is(i + 1, "{")) {
      // export { messages as default, other }
      const close = list.partner[i + 1]!;
      for (let j = i + 2; j < close; j++) {
        const name = tokens[j];
        if (name?.type !== "name") continue;
        if (list.is(j + 1, "as") && list.is(j + 2, "default")) {
          defaultExport = name.value;
          j += 2;
        } else exported.push(name.value);
      }
    } else if (list.is(i, "const") || list.is(i, "let") || list.is(i, "var")) {
      const name = tokens[i + 1];
      if (name?.type !== "name") continue;
      const assignment = declarationValue(list, i + 2);
      if (assignment === undefined) continue;
      const value = target(assignment);
      if (typeof value === "number") objects.set(name.value, value);
      if (list.is(i - 1, "export")) exported.push(name.value);
    }
  }

  if (typeof defaultExport === "number") return defaultExport;
  if (typeof defaultExport === "string" && objects.has(defaultExport)) return objects.get(defaultExport);
  // Without a default export, the biggest exported object: messages rather than meta = { dir: "ltr" }.
  const candidates = exported.map((name) => objects.get(name)).filter((index) => index !== undefined);
  return candidates.sort((a, b) => list.partner[b]! - b - (list.partner[a]! - a))[0];
}

/** After `const name`, the index of the value: past a type annotation (: Messages) and the =. */
function declarationValue(list: List, index: number): number | undefined {
  let i = index;
  if (list.is(i, ":")) i = skipType(list, i + 1, list.tokens.length, ["=", ";"]);
  return list.is(i, "=") ? i + 1 : undefined;
}

/** Skips a type up to one of `stops` outside brackets; < and > count as brackets in a type. */
function skipType(list: List, start: number, end: number, stops: string[]): number {
  let angles = 0;
  for (let i = start; i < end; i = list.skip(i)) {
    if (list.is(i, "<")) angles++;
    else if (list.is(i, ">")) angles = Math.max(0, angles - 1);
    else if (angles === 0 && stops.some((stop) => list.is(i, stop))) return i;
  }
  return end;
}

// Reading values

interface Rendered {
  text: string;
  plurals: ModulePlural[];
  /** Set when the expression is one plural, which is then plurals[0]. */
  whole?: boolean;
}

/** The parameters of the function a value is in; undefined outside functions. */
type Scope = Set<string> | undefined;

class Reader {
  constructor(private readonly source: string) {}

  object(list: List, open: number): ModuleObject {
    const close = list.partner[open]!;
    const result: ModuleObject = { type: "object", offset: list.tokens[open]!.start, entries: [], unread: [] };
    let start = open + 1;
    for (const comma of [...list.split(open + 1, close, ","), close]) {
      if (comma > start) this.entry(list, start, comma, result);
      start = comma + 1;
    }
    return result;
  }

  private entry(list: List, start: number, end: number, object: ModuleObject) {
    const { tokens } = list;
    const first = tokens[start]!;
    const unread = (what: string) => object.unread.push({ offset: first.start, what });
    if (list.is(start, "...")) return unread(`${this.excerpt(list, start, end)} is a spread, so the keys it adds are not checked`);
    if (list.is(start, "[")) return unread(`${this.excerpt(list, start, list.skip(start))} is a computed key`);

    // get name() { … }, async name() { … }
    let keyIndex = start;
    if ((list.is(start, "get") || list.is(start, "set") || list.is(start, "async")) && keyIndex + 1 < end && !list.is(start + 1, "(") && !list.is(start + 1, ":")) {
      keyIndex++;
    }
    if (list.is(keyIndex, "*")) keyIndex++;
    const keyToken = tokens[keyIndex]!;
    if (keyToken.type !== "name" && keyToken.type !== "string" && keyToken.type !== "number") {
      return unread(`${this.excerpt(list, start, end)} is not a key and a value`);
    }
    const key = keyToken.type === "number" ? String(Number(keyToken.value.replace(/_/g, ""))) : keyToken.value;
    const add = (value: ModuleValue) => object.entries.push({ key, offset: keyToken.start, value });
    const after = keyIndex + 1;

    if (after === end) {
      // { messages } is shorthand for { messages: messages }.
      return add({ type: "skipped", offset: keyToken.start, what: `${key} comes from elsewhere` });
    }
    if (list.is(after, ":")) return add(this.value(list, after + 1, end));
    if (list.is(after, "(") || list.is(after, "<")) {
      // A method: name(n) { return … }
      const fn = this.function(list, after, end, true);
      return add(fn ?? { type: "skipped", offset: keyToken.start, what: "a method locale-doctor cannot read" });
    }
    return unread(`${this.excerpt(list, start, end)} is not something locale-doctor can read`);
  }

  /** A value of an object or array: tokens [start, end). */
  private value(list: List, start: number, end: number): ModuleValue {
    const { tokens } = list;
    end = stripTypeSuffix(list, start, end);
    const first = tokens[start];
    if (!first || start >= end) return { type: "skipped", offset: tokens[Math.max(0, start - 1)]?.start ?? 0, what: "an empty value" };
    const offset = first.start;
    const whole = (index: number) => list.skip(index) === end;

    if (list.is(start, "{") && whole(start)) {
      const object = this.object(list, start);
      const plural = this.pluralObject(list, start, object, undefined);
      return plural ? this.text(list, start, end, plural) : object;
    }
    if (list.is(start, "[") && whole(start)) {
      const items: ModuleValue[] = [];
      let itemStart = start + 1;
      const close = list.partner[start]!;
      for (const comma of [...list.split(start + 1, close, ","), close]) {
        if (comma > itemStart) items.push(this.value(list, itemStart, comma));
        itemStart = comma + 1;
      }
      return { type: "array", offset, items };
    }
    if (end === start + 1 && first.type === "number") return { type: "number", offset };
    if (end === start + 2 && list.is(start, "-") && tokens[start + 1]!.type === "number") return { type: "number", offset };
    if (end === start + 1 && (list.is(start, "true") || list.is(start, "false"))) return { type: "boolean", offset };
    if (end === start + 1 && (list.is(start, "null") || list.is(start, "undefined"))) return { type: "null", offset };

    const fn = this.function(list, start, end, false);
    if (fn) return fn;
    const rendered = this.render(list, start, end, undefined);
    if (rendered) return this.text(list, start, end, rendered);
    return { type: "skipped", offset, what: this.describe(list, start, end) };
  }

  private text(list: List, start: number, end: number, rendered: Rendered, params?: string[]): ModuleText {
    // A message that is one plural call needs no name for it in messages.
    if (rendered.whole) rendered.plurals[0]!.name = "";
    const text: ModuleText = {
      type: "text",
      offset: list.tokens[start]!.start,
      text: rendered.text,
      raw: this.code(list, start, end, true),
      plurals: rendered.plurals,
    };
    if (params) text.params = params;
    return text;
  }

  /**
   * A function: (n) => …, n => …, function (n) { return … }, or with `method`, a method's
   * (n) { return … }. Undefined when [start, end) is not one; skipped when its body cannot be read.
   */
  private function(list: List, start: number, end: number, method: boolean): ModuleText | ModuleSkipped | undefined {
    const { tokens } = list;
    let i = start;
    let params: string[];
    let body: number;
    const block = () => {
      // Past the parameters and a return type: name(n): string { … }
      params = parameters(list, i);
      const brace = skipType(list, list.skip(i), end, ["{"]);
      if (!list.is(brace, "{") || list.skip(brace) !== end) return false;
      body = brace;
      return true;
    };
    if (method) {
      if (list.is(i, "<")) i = skipType(list, i, end, ["("]);
      if (!list.is(i, "(") || !block()) return undefined;
    } else {
      if (list.is(i, "async") && i + 1 < end && !list.is(i + 1, "=>")) i++;
      if (list.is(i, "function")) {
        i++;
        if (list.is(i, "*")) i++;
        if (tokens[i]?.type === "name") i++;
        if (!list.is(i, "(") || !block()) return undefined;
      } else if (tokens[i]?.type === "name" && list.is(i + 1, "=>")) {
        params = [tokens[i]!.value];
        body = i + 2;
      } else if (list.is(i, "(") || list.is(i, "<")) {
        if (list.is(i, "<")) i = skipType(list, i, end, ["("]);
        if (!list.is(i, "(")) return undefined;
        params = parameters(list, i);
        let arrow = list.skip(i);
        if (list.is(arrow, ":")) arrow = skipType(list, arrow + 1, end, ["=>"]);
        if (!list.is(arrow, "=>")) return undefined;
        body = arrow + 1;
      } else {
        return undefined;
      }
    }

    const scope = new Set(params!);
    const offset = tokens[start]!.start;
    let rendered: Rendered | undefined;
    if (list.is(body!, "{") && list.skip(body!) === end) {
      // Only a body that is one return statement: { return `Hi ${name}`; }
      let last = end - 1;
      if (list.is(last - 1, ";")) last--;
      if (!list.is(body! + 1, "return") || list.split(body! + 1, last, ";").length > 0) {
        return { type: "skipped", offset, what: "a function with more than a return statement" };
      }
      rendered = this.render(list, body! + 2, last, scope);
    } else {
      rendered = this.render(list, body!, end, scope);
    }
    if (!rendered) return { type: "skipped", offset, what: "a function whose result is not a string, template literal or plural() call" };
    return this.text(list, start, end, rendered, params!);
  }

  /**
   * Text for an expression: a string, a template literal, a + of them, a ? : between them, or a
   * plural call. Inside a function, other code that uses its parameters is a placeholder.
   */
  private render(list: List, start: number, end: number, scope: Scope): Rendered | undefined {
    const { tokens } = list;
    end = stripTypeSuffix(list, start, end);
    if (start >= end) return undefined;
    if (list.is(start, "(") && list.skip(start) === end) return this.render(list, start + 1, end - 1, scope);

    const question = list.split(start, end, "?")[0];
    if (question !== undefined) {
      const colon = conditionalColon(list, question + 1, end);
      if (colon === undefined) return undefined;
      const yes = this.render(list, question + 1, colon, scope);
      const no = this.render(list, colon + 1, end, scope);
      if (!yes || !no) return undefined;
      return { text: `${yes.text} | ${no.text}`, plurals: [...yes.plurals, ...no.plurals] };
    }

    const plus = list.split(start, end, "+").filter((index) => index > start);
    if (plus.length > 0) {
      const parts: Array<[number, number]> = [];
      let partStart = start;
      for (const index of [...plus, end]) {
        parts.push([partStart, index]);
        partStart = index + 1;
      }
      const literal = parts.some(([s, e]) => e === s + 1 && (tokens[s]!.type === "string" || tokens[s]!.type === "template"));
      if (!literal) return scope ? this.placeholder(list, start, end, scope) : undefined;
      return join(parts.map(([s, e]) => this.substitution(list, s, e, scope)));
    }

    const first = tokens[start]!;
    if (end === start + 1 && first.type === "string") return { text: first.value, plurals: [] };
    if (end === start + 1 && first.type === "template") return this.template(first, scope);
    if (list.is(start, "{") && list.skip(start) === end) return this.pluralObject(list, start, this.object(list, start), scope);
    const call = this.pluralCall(list, start, end, scope);
    if (call) return { text: otherForm(call), plurals: [call, ...nestedPlurals(call)], whole: true };
    return scope ? this.placeholder(list, start, end, scope) : undefined;
  }

  /** What a ${…} shows: like render, but anything else is a placeholder. */
  private substitution(list: List, start: number, end: number, scope: Scope): Rendered {
    const { tokens } = list;
    end = stripTypeSuffix(list, start, end);
    if (start >= end) return { text: "", plurals: [] };
    if (list.is(start, "(") && list.skip(start) === end) return this.substitution(list, start + 1, end - 1, scope);
    const first = tokens[start]!;
    if (end === start + 1 && first.type === "string") return { text: first.value, plurals: [] };
    if (end === start + 1 && first.type === "template") return this.template(first, scope);

    const question = list.split(start, end, "?")[0];
    const colon = question === undefined ? undefined : conditionalColon(list, question + 1, end);
    if (question !== undefined && colon !== undefined) {
      const yes = this.substitution(list, question + 1, colon, scope);
      const no = this.substitution(list, colon + 1, end, scope);
      return { text: `[${yes.text} | ${no.text}]`, plurals: [...yes.plurals, ...no.plurals] };
    }
    const call = this.pluralCall(list, start, end, scope);
    if (call) return { text: otherForm(call), plurals: [call, ...nestedPlurals(call)] };
    return this.placeholder(list, start, end, scope);
  }

  private template(token: Extract<Token, { type: "template" }>, scope: Scope): Rendered {
    const parts: Rendered[] = [{ text: token.quasis[0]!, plurals: [] }];
    token.expressions.forEach((expression, index) => {
      parts.push(this.substitution(expression, 0, expression.tokens.length, scope));
      parts.push({ text: token.quasis[index + 1]!, plurals: [] });
    });
    return join(parts);
  }

  /** {name} for each parameter the code uses, or the code itself when it uses none: {APP_NAME}. */
  private placeholder(list: List, start: number, end: number, scope: Scope): Rendered {
    const used = scope ? usedParameters(list, start, end, scope) : [];
    if (used.length > 0) return { text: used.map((name) => `{${name}}`).join(""), plurals: [] };
    return { text: `{${this.code(list, start, end).replace(/[{}]/g, (brace) => (brace === "{" ? "(" : ")"))}}`, plurals: [] };
  }

  /** plural(n, { one: "# day", other: "# days" }), or any call with an object of plural forms. */
  private pluralCall(list: List, start: number, end: number, scope: Scope): ModulePlural | undefined {
    const { tokens } = list;
    let open = start;
    while (open < end && (tokens[open]!.type === "name" || list.is(open, ".") || list.is(open, "?."))) open++;
    if (open === start || !list.is(open, "(") || list.skip(open) !== end) return undefined;
    const close = end - 1;
    const args: Array<[number, number]> = [];
    let argStart = open + 1;
    for (const comma of [...list.split(open + 1, close, ","), close]) {
      if (comma > argStart) args.push([argStart, comma]);
      argStart = comma + 1;
    }
    const formsArg = args.find(([s, e]) => list.is(s, "{") && list.skip(s) === e && this.isFormsObject(list, s, false));
    if (!formsArg) return undefined;
    const countArg = args.find((arg) => arg !== formsArg);
    const callee = this.code(list, start, open);
    let count: string | undefined;
    let name = `${callee}(…)`;
    if (countArg) {
      const used = scope ? usedParameters(list, countArg[0], countArg[1], scope) : [];
      const code = this.code(list, countArg[0], countArg[1]);
      count = used.length > 0 ? `{${used[0]}}` : `{${code}}`;
      name = `${callee}(${code}, …)`;
    }
    return this.forms(list, formsArg[0], tokens[start]!.start, name, count, scope);
  }

  /** An object of plural forms without a call: { one: "# day", other: "# days" }. */
  private pluralObject(list: List, open: number, object: ModuleObject, scope: Scope): Rendered | undefined {
    if (!this.isFormsObject(list, open, true) || object.unread.length > 0) return undefined;
    const plural = this.forms(list, open, list.tokens[open]!.start, "", undefined, scope);
    return { text: otherForm(plural), plurals: [plural, ...nestedPlurals(plural)], whole: true };
  }

  /** Whether every key is a plural category; without a call, `other` must be one of them. */
  private isFormsObject(list: List, open: number, needsOther: boolean): boolean {
    const close = list.partner[open]!;
    let start = open + 1;
    const keys: string[] = [];
    for (const comma of [...list.split(open + 1, close, ","), close]) {
      if (comma > start) {
        const key = list.tokens[start]!;
        if ((key.type !== "name" && key.type !== "string") || !list.is(start + 1, ":") || !CATEGORIES.has(key.value)) return false;
        keys.push(key.value);
      }
      start = comma + 1;
    }
    return keys.length > 0 && (!needsOther || keys.includes("other"));
  }

  private forms(list: List, open: number, offset: number, name: string, count: string | undefined, scope: Scope): ModulePlural {
    const close = list.partner[open]!;
    const forms = new Map<PluralCategory, ModuleForm>();
    const nested: ModulePlural[] = [];
    let start = open + 1;
    for (const comma of [...list.split(open + 1, close, ","), close]) {
      if (comma > start) {
        const key = list.tokens[start]!;
        const rendered = this.substitution(list, start + 2, comma, scope);
        const text = count === undefined ? rendered.text : rendered.text.replace(/#/g, () => count);
        forms.set(key.value as PluralCategory, { text, raw: this.code(list, start + 2, comma, true), offset: key.start });
        nested.push(...rendered.plurals);
      }
      start = comma + 1;
    }
    const plural: ModulePlural = { name, offset, forms };
    if (count !== undefined) plural.count = count;
    if (nested.length > 0) nestedByPlural.set(plural, nested);
    return plural;
  }

  /** Why a value that is not text was skipped, for the note. */
  private describe(list: List, start: number, end: number): string {
    const { tokens } = list;
    let open = start;
    while (open < end && (tokens[open]!.type === "name" || list.is(open, ".") || list.is(open, "?."))) open++;
    if (open === end) return `${this.excerpt(list, start, end)} comes from elsewhere`;
    if (open > start && list.is(open, "(") && list.skip(open) === end) return `${this.excerpt(list, start, open)}(…) is a call, not text`;
    return `${this.excerpt(list, start, end)} is not a string, template literal or plural() call`;
  }

  /** The code of tokens [start, end) for a message, cut at 40 characters. */
  private excerpt(list: List, start: number, end: number): string {
    const code = this.code(list, start, end);
    return code.length > 40 ? `${code.slice(0, 39)}…` : code;
  }

  /** The code of tokens [start, end); without spaces unless `exact`. */
  private code(list: List, start: number, end: number, exact = false): string {
    const first = list.tokens[start];
    const last = list.tokens[Math.min(end, list.tokens.length) - 1];
    if (!first || !last || end <= start) return "";
    const code = this.source.slice(first.start, last.end);
    return exact ? code : code.replace(/\s+/g, "");
  }
}

// The plurals inside a plural's forms, kept apart so a whole-message plural lists them after itself.
const nestedByPlural = new WeakMap<ModulePlural, ModulePlural[]>();

function nestedPlurals(plural: ModulePlural): ModulePlural[] {
  return nestedByPlural.get(plural) ?? [];
}

function otherForm(plural: ModulePlural): string {
  return (plural.forms.get("other") ?? [...plural.forms.values()].at(-1))?.text ?? "";
}

function join(parts: Rendered[]): Rendered {
  return { text: parts.map((part) => part.text).join(""), plurals: parts.flatMap((part) => part.plurals) };
}

/** Leaves out `as const`, `as Type` and `satisfies Type` at the end of a value. */
function stripTypeSuffix(list: List, start: number, end: number): number {
  for (let i = start; i < end; i = list.skip(i)) {
    if ((list.is(i, "as") || list.is(i, "satisfies")) && i > start && !list.is(i - 1, ".") && !list.is(i - 1, "?.")) return i;
  }
  return end;
}

/** The : that ends the true branch of a ? at `start`, skipping nested ? : pairs. */
function conditionalColon(list: List, start: number, end: number): number | undefined {
  let open = 0;
  for (let i = start; i < end; i = list.skip(i)) {
    if (list.is(i, "?")) open++;
    else if (list.is(i, ":") && open-- === 0) return i;
  }
  return undefined;
}

/** The names a parameter list binds: (name: string, { a, b }: Props, n = 1, ...rest). */
function parameters(list: List, open: number): string[] {
  const names: string[] = [];
  const close = list.partner[open]!;
  const collect = (start: number, end: number, pattern: boolean) => {
    let expectName = true;
    for (let i = start; i < end; i = list.skip(i)) {
      const token = list.tokens[i]!;
      if (list.is(i, ",")) expectName = true;
      else if (list.is(i, "...")) continue;
      else if (expectName && (list.is(i, "{") || list.is(i, "["))) {
        collect(i + 1, list.partner[i]!, true);
        expectName = false;
      } else if (expectName && token.type === "name") {
        // { a: b } binds b.
        if (pattern && list.is(i + 1, ":")) continue;
        names.push(token.value);
        expectName = false;
      } else if (!pattern && list.is(i, ":")) {
        i = skipType(list, i + 1, end, [",", "="]) - 1;
        expectName = false;
      } else if (pattern && list.is(i, ":")) {
        expectName = true;
      } else {
        expectName = false;
      }
    }
  };
  collect(open + 1, close, false);
  return names;
}

/** The parameters that code uses, in order: `label` for label.toLowerCase(). */
function usedParameters(list: List, start: number, end: number, scope: Set<string>): string[] {
  const used: string[] = [];
  const visit = (current: List, from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const token = current.tokens[i]!;
      if (token.type === "template") token.expressions.forEach((expression) => visit(expression, 0, expression.tokens.length));
      else if (token.type === "name" && scope.has(token.value) && !current.is(i - 1, ".") && !current.is(i - 1, "?.") && !used.includes(token.value)) {
        used.push(token.value);
      }
    }
  };
  visit(list, start, end);
  return used;
}
