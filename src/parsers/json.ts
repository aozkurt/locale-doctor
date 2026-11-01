import { lineCounter, type Position } from "./position.js";

export interface JsonObject {
  type: "object";
  offset: number;
  /** Every entry in file order, duplicates included (JSON.parse would keep only the last one). */
  entries: JsonEntry[];
}

export interface JsonArray {
  type: "array";
  offset: number;
  items: JsonValue[];
}

export interface JsonString {
  type: "string";
  offset: number;
  value: string;
}

export interface JsonScalar {
  type: "number" | "boolean" | "null";
  offset: number;
}

export type JsonValue = JsonObject | JsonArray | JsonString | JsonScalar;

export interface JsonEntry {
  key: string;
  /** Offset of the key's opening quote. */
  offset: number;
  value: JsonValue;
}

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

export interface ParsedJson {
  value: JsonValue;
  position: (offset: number) => Position;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const STRING_SPECIAL = /["\\\u0000-\u001f]/g;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const LITERALS = [
  ["true", "boolean"],
  ["false", "boolean"],
  ["null", "null"],
] as const;

/**
 * A strict JSON parser that, unlike JSON.parse, keeps duplicate keys and the position of every
 * value, so problems can be reported at their line.
 */
export function parseJson(text: string): ParsedJson {
  const position = lineCounter(text);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string, at = i): never => {
    const { line, column } = position(at);
    throw new JsonSyntaxError(message, line, column);
  };
  const describe = (at: number) => (at >= text.length ? "end of file" : JSON.stringify(text[at]));

  const space = () => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) fail("Comments are not allowed in JSON");
      else return;
    }
  };

  const string = (): string => {
    const start = i;
    i++;
    let out = "";
    for (;;) {
      STRING_SPECIAL.lastIndex = i;
      const match = STRING_SPECIAL.exec(text);
      if (!match) fail("A string that is never closed", start);
      const at = match!.index;
      out += text.slice(i, at);
      i = at;
      const c = text[i]!;
      if (c === '"') {
        i++;
        return out;
      }
      if (c !== "\\") fail(c === "\n" || c === "\r" ? "A line break inside a string (write \\n)" : "A control character inside a string");
      const escape = text[i + 1] ?? "";
      if (escape in ESCAPES) {
        out += ESCAPES[escape];
        i += 2;
      } else if (escape === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
        i += 6;
      } else {
        fail(`An invalid escape: \\${escape}`);
      }
    }
  };

  const value = (): JsonValue => {
    space();
    const start = i;
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return { type: "string", offset: start, value: string() };
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(text);
      if (!match) fail("An invalid number");
      i += match![0].length;
      return { type: "number", offset: start };
    }
    for (const [word, type] of LITERALS) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return { type, offset: start };
      }
    }
    return fail(`Unexpected ${describe(i)}, expected a value`);
  };

  const object = (): JsonObject => {
    const node: JsonObject = { type: "object", offset: i, entries: [] };
    i++;
    space();
    if (text[i] === "}") {
      i++;
      return node;
    }
    for (;;) {
      space();
      if (text[i] !== '"') {
        fail(text[i] === "}" ? "A trailing comma before }" : `Unexpected ${describe(i)}, expected a key in double quotes`);
      }
      const offset = i;
      const key = string();
      space();
      if (text[i] !== ":") fail(`Unexpected ${describe(i)}, expected : after "${key}"`);
      i++;
      node.entries.push({ key, offset, value: value() });
      space();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return node;
      }
      fail(`Unexpected ${describe(i)}, expected , or }`);
    }
  };

  const array = (): JsonArray => {
    const node: JsonArray = { type: "array", offset: i, items: [] };
    i++;
    space();
    if (text[i] === "]") {
      i++;
      return node;
    }
    for (;;) {
      space();
      if (text[i] === "]") fail("A trailing comma before ]");
      node.items.push(value());
      space();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return node;
      }
      fail(`Unexpected ${describe(i)}, expected , or ]`);
    }
  };

  const root = value();
  space();
  if (i < text.length) fail(`Unexpected ${describe(i)} after the end of the JSON`);
  return { value: root, position };
}
