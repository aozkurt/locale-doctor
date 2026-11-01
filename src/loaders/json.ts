import path from "node:path";
import type { JsonGroup } from "../discover.js";
import { readText } from "../files.js";
import { localeKey } from "../locale.js";
import type { Catalog, Issue, Layer, Message, MessageFormat, PluralCategory, PluralMessage } from "../model.js";
import { JsonSyntaxError, parseJson, type JsonValue, type ParsedJson } from "../parsers/json.js";

interface ParsedFile {
  catalog: Catalog;
  file: string;
  namespace: string;
  json: ParsedJson;
}

/** Reads a folder of JSON catalogs into a layer: one catalog per locale, keys flattened to "a.b.c". */
export async function loadJsonLayer(root: string, group: JsonGroup, preferredSource?: string): Promise<Layer | undefined> {
  const layerPath = group.dir || ".";
  const issues: Issue[] = [];
  const catalogs: Catalog[] = [];
  const parsed: ParsedFile[] = [];
  const byFolder = group.layout === "folders";

  for (const [locale, { label, files }] of group.locales) {
    const catalog: Catalog = { locale, label, file: files[0]!, messages: new Map(), broken: false };
    if (byFolder) {
      catalog.namespaces = new Map();
      catalog.brokenNamespaces = new Set();
    }
    catalogs.push(catalog);
    for (const file of files) {
      const namespace = byFolder ? path.posix.basename(file).replace(/\.json$/i, "") : "";
      const text = await readText(root, file);
      if (text === undefined) continue;
      const fail = (message: string, line?: number, column?: number) => {
        issues.push({ rule: "parse-error", severity: "error", layer: layerPath, locale: label, file, line, column, message });
        if (byFolder) catalog.brokenNamespaces!.add(namespace);
        else catalog.broken = true;
      };
      try {
        const json = parseJson(text);
        if (json.value.type !== "object") fail("Expected an object of translations at the top of the file", 1, 1);
        else {
          catalog.namespaces?.set(namespace, file);
          parsed.push({ catalog, file, namespace, json });
        }
      } catch (error) {
        if (!(error instanceof JsonSyntaxError)) throw error;
        fail(`Not valid JSON: ${error.message}`, error.line, error.column);
      }
    }
  }

  // With several namespace files per locale, keys carry their namespace the way i18next writes it: "common:save".
  const namespaces = new Set(parsed.map((file) => file.namespace));
  const prefixed = byFolder && namespaces.size > 1;
  for (const file of parsed) flatten(file, prefixed ? `${file.namespace}:` : "", layerPath, issues);

  const source = pickSource(catalogs, preferredSource);
  if (!source) return undefined;
  const format = detectFormat(source);
  if (format !== "icu") groupPlurals(catalogs, source);

  return {
    kind: "json",
    path: layerPath,
    format,
    source,
    targets: catalogs.filter((catalog) => catalog !== source).sort((a, b) => a.label.localeCompare(b.label)),
    issues,
  };
}

// A broken source stays the source: comparing against another language would report nonsense.
export function pickSource(catalogs: Catalog[], preferred: string | undefined): Catalog | undefined {
  if (preferred) {
    const wanted = localeKey(preferred);
    const match = catalogs.find((c) => c.locale === preferred) ?? catalogs.find((c) => localeKey(c.locale) === wanted);
    if (match) return match;
  }
  const english = catalogs.find((c) => c.locale === "en") ?? catalogs.find((c) => c.locale.startsWith("en-"));
  if (english) return english;
  return [...catalogs].sort((a, b) => b.messages.size - a.messages.size)[0];
}

function flatten({ catalog, file, json }: ParsedFile, prefix: string, layerPath: string, issues: Issue[]) {
  const at = (offset: number) => ({ file, ...json.position(offset) });

  const visit = (value: JsonValue, key: string, offset: number) => {
    const loc = at(offset);
    const set = (message: Message) => catalog.messages.set(message.key, message);
    const base = { key: prefix + key, loc, translatable: true, formatted: true };
    switch (value.type) {
      case "object": {
        const seen = new Map<string, number>();
        for (const entry of value.entries) {
          const child = key ? `${key}.${entry.key}` : entry.key;
          const first = seen.get(entry.key);
          if (first !== undefined) {
            const position = at(entry.offset);
            issues.push({
              rule: "duplicate-key",
              severity: "error",
              layer: layerPath,
              locale: catalog.label,
              key: prefix + child,
              file,
              line: position.line,
              column: position.column,
              message: `Defined twice (also on line ${at(first).line}) — only this last one is used`,
            });
          }
          seen.set(entry.key, entry.offset);
          visit(entry.value, child, entry.offset);
        }
        break;
      }
      case "array":
        value.items.forEach((item, index) => visit(item, `${key}.${index}`, item.offset));
        break;
      case "string":
        set({ ...base, kind: "text", text: value.value, raw: value.value });
        break;
      default:
        set({ ...base, kind: "value", valueType: value.type });
    }
  };

  visit(json.value, "", json.value.offset);
}

export function detectFormat(source: Catalog): MessageFormat {
  let icu = 0;
  let i18next = 0;
  for (const [key, message] of source.messages) {
    if (/_(?:zero|one|two|few|many|other)$/.test(key)) i18next++;
    if (message.kind !== "text") continue;
    if (/\{\s*[\w$.-]+\s*,\s*(?:plural|selectordinal|select)\s*,/.test(message.text)) icu++;
    if (/\{\{[^{}]+\}\}/.test(message.text)) i18next++;
  }
  if (icu > 0 && icu >= i18next) return "icu";
  return i18next > 0 ? "i18next" : "simple";
}

const PLURAL_SUFFIX = /^(.+?)_(ordinal_)?(zero|one|two|few|many|other)$/;

/**
 * Turns i18next plural keys (nights_one, nights_other) into one plural message per catalog, so
 * each language can be checked against the plural forms it needs instead of English's.
 */
export function groupPlurals(catalogs: Catalog[], source: Catalog) {
  const bases = new Set<string>();
  for (const [key, message] of source.messages) {
    const match = PLURAL_SUFFIX.exec(key);
    if (match && match[3] === "other" && message.kind === "text") bases.add(`${match[1]}_${match[2] ?? ""}`);
  }
  if (bases.size === 0) return;

  for (const catalog of catalogs) {
    const plurals = new Map<string, PluralMessage>();
    for (const [key, message] of catalog.messages) {
      const match = PLURAL_SUFFIX.exec(key);
      if (!match || message.kind !== "text" || !bases.has(`${match[1]}_${match[2] ?? ""}`)) continue;
      const ordinal = Boolean(match[2]);
      const pluralKey = `${match[1]}_${ordinal ? "ordinal_" : ""}*`;
      let plural = plurals.get(pluralKey);
      if (!plural) {
        plural = {
          kind: "plural",
          style: "i18next",
          key: pluralKey,
          base: match[1]!,
          ordinal,
          forms: new Map(),
          loc: message.loc,
          translatable: true,
          formatted: true,
        };
        plurals.set(pluralKey, plural);
      }
      const category = match[3] as PluralCategory;
      plural.forms.set(category, { text: message.text, raw: message.raw, loc: message.loc });
      if (category === "other") plural.loc = message.loc;
      catalog.messages.delete(key);
    }
    for (const [key, plural] of plurals) catalog.messages.set(key, plural);
  }
}
