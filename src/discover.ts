import { androidLocale, toLocale } from "./locale.js";

export interface LocaleFiles {
  /** What the project calls the locale: "pt-BR", "pt_BR", "values-pt-rBR". */
  label: string;
  files: string[];
}

export interface JsonGroup {
  kind: "json";
  /** The folder holding the locale files (src/locales/en.json) or the locale folders (public/locales/en/common.json). */
  dir: string;
  layout: "files" | "folders";
  locales: Map<string, LocaleFiles>;
}

export interface AndroidGroup {
  kind: "android";
  /** The res folder. */
  dir: string;
  /** Locale of each values folder; null for the default one. */
  values: Map<string | null, LocaleFiles>;
}

export type Group = JsonGroup | AndroidGroup;

/** Finds the translation files among `files` (paths relative to the checked folder). */
export function discover(files: string[]): Group[] {
  const flat = new Map<string, Map<string, LocaleFiles>>();
  const folders = new Map<string, Map<string, LocaleFiles>>();
  const android = new Map<string, Map<string | null, LocaleFiles>>();

  for (const file of files) {
    const parts = file.split("/");
    const name = parts[parts.length - 1]!;
    const parent = parts[parts.length - 2];
    if (/\.json$/i.test(name)) {
      const stem = name.slice(0, -5);
      const locale = toLocale(stem);
      if (locale) add(flat, parts.slice(0, -1).join("/"), locale, stem, file);
      else if (parent !== undefined) {
        const folderLocale = toLocale(parent);
        if (folderLocale) add(folders, parts.slice(0, -2).join("/"), folderLocale, parent, file);
      }
    } else if (/\.xml$/i.test(name) && parent?.startsWith("values") && parts[parts.length - 3] === "res") {
      const locale = androidLocale(parent);
      if (locale !== undefined) add(android, parts.slice(0, -2).join("/"), locale, parent, file);
    }
  }

  const groups: Group[] = [];
  for (const [dir, locales] of flat) {
    if (locales.size >= 2) groups.push({ kind: "json", dir, layout: "files", locales });
  }
  for (const [dir, locales] of folders) {
    // Locale folders share file names (en/common.json, de/common.json); unrelated folders that
    // happen to be named like languages do not.
    const names = [...locales.values()].flatMap(({ files }) => [...new Set(files.map((f) => f.split("/").pop()))]);
    const shared = names.some((name, index) => names.indexOf(name) !== index);
    if (locales.size >= 2 && shared) groups.push({ kind: "json", dir, layout: "folders", locales });
  }
  for (const [dir, values] of android) {
    if (values.has(null)) groups.push({ kind: "android", dir, values });
  }
  return groups.sort((a, b) => (a.kind === b.kind ? a.dir.localeCompare(b.dir) : a.kind === "json" ? -1 : 1));
}

function add<K>(groups: Map<string, Map<K, LocaleFiles>>, dir: string, locale: K, label: string, file: string) {
  let locales = groups.get(dir);
  if (!locales) groups.set(dir, (locales = new Map()));
  const entry = locales.get(locale);
  if (entry) entry.files.push(file);
  else locales.set(locale, { label, files: [file] });
}
