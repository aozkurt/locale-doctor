import { androidText, isReference } from "../android.js";
import type { AndroidGroup } from "../discover.js";
import { readText } from "../files.js";
import type { Catalog, Form, Issue, Layer, Location, Message, PluralCategory } from "../model.js";
import { innerText, parseXml, XmlSyntaxError, type XmlElement } from "../parsers/xml.js";
import type { Position } from "../parsers/position.js";

// Strings the Capacitor template adds to values/strings.xml without translatable="false".
const CAPACITOR_CONFIG = new Set(["package_name", "custom_url_scheme"]);

const QUANTITIES = new Set<string>(["zero", "one", "two", "few", "many", "other"]);

/** Reads an Android res folder into a layer: values/ is the source, values-xx/ the translations. */
export async function loadAndroidLayer(root: string, group: AndroidGroup, sourceLocale: string): Promise<Layer | undefined> {
  const issues: Issue[] = [];
  const targets: Catalog[] = [];
  let source: Catalog | undefined;

  for (const [locale, { label, files }] of group.values) {
    const catalog: Catalog = {
      locale: locale ?? sourceLocale,
      label,
      file: files.find((file) => file.endsWith("/strings.xml")) ?? files[0]!,
      messages: new Map(),
      broken: false,
    };
    for (const file of files) {
      const text = await readText(root, file);
      if (text === undefined) continue;
      let parsed;
      try {
        parsed = parseXml(text);
      } catch (error) {
        if (!(error instanceof XmlSyntaxError)) throw error;
        issues.push({
          rule: "parse-error",
          severity: "error",
          layer: group.dir,
          locale: label,
          file,
          line: error.line,
          column: error.column,
          message: `Not valid XML: ${error.message}`,
        });
        catalog.broken = true;
        continue;
      }
      if (parsed.root.name !== "resources") continue;
      for (const child of parsed.root.children) {
        if (child.type !== "element") continue;
        const message = toMessage(child, file, parsed.position);
        if (!message) continue;
        const first = catalog.messages.get(message.key);
        if (first) {
          issues.push({
            rule: "duplicate-key",
            severity: "error",
            layer: group.dir,
            locale: label,
            key: message.key,
            file,
            line: message.loc.line,
            column: message.loc.column,
            message: `Defined twice (also in ${first.loc.file.split("/").slice(-2).join("/")}:${first.loc.line}) — the build fails on duplicate resources`,
          });
          continue;
        }
        catalog.messages.set(message.key, message);
      }
    }
    if (locale === null) source = catalog;
    else targets.push(catalog);
  }

  if (!source || source.messages.size === 0) return undefined;
  return {
    kind: "android",
    path: group.dir,
    format: "android",
    source,
    targets: targets.sort((a, b) => a.label.localeCompare(b.label)),
    issues,
  };
}

function toMessage(element: XmlElement, file: string, position: (offset: number) => Position): Message | undefined {
  const name = element.attributes.get("name");
  if (!name) return undefined;
  const loc: Location = { file, ...position(element.offset) };
  const form = (item: XmlElement): Form => {
    const raw = innerText(item);
    return { text: androidText(raw), raw, loc: { file, ...position(item.offset) } };
  };
  const base = {
    key: name,
    loc,
    translatable:
      element.attributes.get("translatable") !== "false" &&
      !CAPACITOR_CONFIG.has(name) &&
      !/\bMissingTranslation\b/.test(element.attributes.get("tools:ignore") ?? ""),
    formatted: element.attributes.get("formatted") !== "false",
  };
  const items = element.children.filter((child): child is XmlElement => child.type === "element" && child.name === "item");

  switch (element.name) {
    case "string": {
      const raw = innerText(element);
      return { ...base, translatable: base.translatable && !isReference(raw), kind: "text", text: androidText(raw), raw };
    }
    case "plurals": {
      const forms = new Map<PluralCategory, Form>();
      for (const item of items) {
        const quantity = item.attributes.get("quantity");
        if (quantity && QUANTITIES.has(quantity)) forms.set(quantity as PluralCategory, form(item));
      }
      return { ...base, kind: "plural", style: "android", base: name, ordinal: false, forms };
    }
    case "string-array":
      return { ...base, kind: "array", items: items.map(form) };
    default:
      return undefined;
  }
}
