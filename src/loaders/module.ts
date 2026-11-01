import type { ModuleGroup } from "../discover.js";
import { readText } from "../files.js";
import type { Catalog, Issue, Layer, Location, Message, PluralCategory, PluralMessage } from "../model.js";
import { ModuleSyntaxError, parseModule, type ModulePlural, type ModuleValue, type ParsedModule } from "../parsers/module.js";
import { detectFormat, groupPlurals, pickSource } from "./json.js";

/** Something a module has that locale-doctor could not read, noted once for all the locales that have it. */
interface Note {
  key: string;
  what: string;
  /** Where each locale has it. */
  locs: Map<string, Location>;
}

/**
 * Reads a folder of JavaScript or TypeScript catalogs (en.ts, de.ts) into a layer: one catalog per
 * locale, keys flattened to "a.b.c" as in JSON. Undefined when fewer than two of the modules export
 * an object, so other code that happens to be named like a language is left alone.
 */
export async function loadModuleLayer(root: string, group: ModuleGroup, preferredSource?: string): Promise<Layer | undefined> {
  const layerPath = group.dir || ".";
  const issues: Issue[] = [];
  const catalogs: Catalog[] = [];
  const unreadable: Array<{ catalog: Catalog; issue: Issue }> = [];
  const notes = new Map<string, Note>();

  for (const [locale, { label, files }] of group.locales) {
    const file = files[0]!;
    const text = await readText(root, file);
    if (text === undefined) continue;
    const catalog: Catalog = { locale, label, file, messages: new Map(), broken: false, unread: new Set() };
    // A note, not an error: the code may well be fine and only beyond what locale-doctor reads.
    const fail = (message: string, line?: number, column?: number) => {
      catalog.broken = true;
      unreadable.push({ catalog, issue: { rule: "parse-error", severity: "info", layer: layerPath, locale: label, file, line, column, message } });
    };
    let parsed: ParsedModule;
    try {
      parsed = parseModule(text);
    } catch (error) {
      if (!(error instanceof ModuleSyntaxError)) throw error;
      fail(`Could not read this module (${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}), so ${label} is not checked`, error.line, error.column);
      continue;
    }
    if (!parsed.value) {
      fail(`Exports no object literal (export default { … }), so ${label} is not checked`);
      continue;
    }
    catalogs.push(catalog);
    flatten(catalog, file, parsed, layerPath, issues, notes);
  }

  // Translations share their keys; objects in code files named like languages (is.ts, os.ts) do not.
  if (!catalogs.some((a, index) => catalogs.slice(index + 1).some((b) => sharedKeys(a, b) >= 0.5))) return undefined;
  for (const { catalog, issue } of unreadable) {
    catalogs.push(catalog);
    issues.push(issue);
  }

  const source = pickSource(catalogs, preferredSource);
  if (!source) return undefined;
  for (const note of notes.values()) issues.push(noteIssue(note, layerPath, catalogs.length, source.label));
  const detected = detectFormat(source);
  const format = detected === "simple" ? "module" : detected;
  if (format !== "icu") groupPlurals(catalogs, source);

  return {
    kind: "module",
    path: layerPath,
    format,
    source,
    targets: catalogs.filter((catalog) => catalog !== source).sort((a, b) => a.label.localeCompare(b.label)),
    issues,
  };
}

function flatten(catalog: Catalog, file: string, parsed: ParsedModule, layerPath: string, issues: Issue[], notes: Map<string, Note>) {
  const at = (offset: number): Location => ({ file, ...parsed.position(offset) });
  const set = (message: Message) => catalog.messages.set(message.key, message);
  const note = (key: string, what: string, loc: Location) => {
    catalog.unread!.add(key);
    const id = `${key}|${what}`;
    const entry = notes.get(id) ?? { key, what, locs: new Map<string, Location>() };
    entry.locs.set(catalog.label, loc);
    notes.set(id, entry);
  };

  const visit = (value: ModuleValue, key: string, offset: number) => {
    const loc = at(offset);
    const base = { key, loc, translatable: true, formatted: true };
    switch (value.type) {
      case "object": {
        for (const part of value.unread) note(key, part.what, at(part.offset));
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
              key: child,
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
      case "text": {
        const plurals = value.plurals.map((plural) => toPlural(plural, key, at));
        set({ ...base, kind: "text", text: value.text, raw: value.raw, ...(value.params ? { params: value.params } : {}), ...(plurals.length > 0 ? { plurals } : {}) });
        break;
      }
      case "skipped":
        note(key, value.what, loc);
        break;
      default:
        set({ ...base, kind: "value", valueType: value.type });
    }
  };

  visit(parsed.value!, "", parsed.value!.offset);
}

function toPlural(plural: ModulePlural, key: string, at: (offset: number) => Location): PluralMessage {
  const forms = new Map<PluralCategory, { text: string; raw: string; loc: Location }>();
  for (const [category, form] of plural.forms) forms.set(category, { text: form.text, raw: form.raw, loc: at(form.offset) });
  return {
    kind: "plural",
    style: "module",
    key,
    base: plural.name,
    ...(plural.count !== undefined ? { count: plural.count } : {}),
    ordinal: false,
    forms,
    loc: at(plural.offset),
    translatable: true,
    formatted: true,
  };
}

/** The share of the smaller catalog's keys that the other one has too. */
function sharedKeys(a: Catalog, b: Catalog): number {
  const [small, big] = a.messages.size <= b.messages.size ? [a, b] : [b, a];
  if (small.messages.size === 0) return 0;
  let shared = 0;
  for (const key of small.messages.keys()) if (big.messages.has(key)) shared++;
  return shared / small.messages.size;
}

// One note for every locale that has the same code at the same key, pointing at the source's.
function noteIssue(note: Note, layerPath: string, locales: number, source: string): Issue {
  const labels = [...note.locs.keys()];
  const loc = note.locs.get(source) ?? note.locs.values().next().value!;
  const where = labels.length === 1 ? "" : labels.length === locales ? ` in all ${locales} locales` : ` in ${labels.join(", ")}`;
  return {
    rule: "dynamic-value",
    severity: "info",
    layer: layerPath,
    ...(labels.length === 1 ? { locale: labels[0] } : {}),
    ...(note.key ? { key: note.key } : {}),
    file: loc.file,
    line: loc.line,
    column: loc.column,
    message: `Not read${where}: ${note.what}`,
  };
}
