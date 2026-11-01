import { describe, expect, it } from "vitest";
import { ModuleSyntaxError, parseModule, type ModuleValue } from "../src/parsers/module.js";

/** What the parser made of each key: its text (with its plurals and parameters), the reason it was skipped, or its type. */
function read(source: string): Record<string, string> {
  const { value } = parseModule(source);
  if (!value) throw new Error("no exported object");
  const out: Record<string, string> = {};
  const visit = (node: ModuleValue, key: string) => {
    switch (node.type) {
      case "object":
        for (const part of node.unread) out[`${key || "(top)"} unread`] = part.what;
        for (const entry of node.entries) visit(entry.value, key ? `${key}.${entry.key}` : entry.key);
        break;
      case "array":
        node.items.forEach((item, index) => visit(item, `${key}.${index}`));
        break;
      case "text": {
        const plurals = node.plurals.map((plural) => {
          const forms = [...plural.forms].map(([category, form]) => `${category}: ${form.text}`).join(", ");
          return ` [${plural.name || "plural"}${plural.count ? ` ${plural.count}` : ""}: ${forms}]`;
        });
        out[key] = `${node.text}${plurals.join("")}${node.params ? ` (${node.params.join(", ")})` : ""}`;
        break;
      }
      case "skipped":
        out[key] = `skipped: ${node.what}`;
        break;
      default:
        out[key] = node.type;
    }
  };
  visit(value, "");
  return out;
}

describe("parseModule", () => {
  it.each([
    ["export default", 'export default { a: "x" };'],
    ["export const with a type", 'import type { M } from "./m";\nexport const messages: Record<string, M<string, number>> = { a: "x" } as const satisfies M;\nexport type X = typeof messages;'],
    ["a const exported by name", 'const de = { a: "x" };\nconst other = { b: 1 };\nexport default de;'],
    ["module.exports", 'module.exports = { a: "x" };'],
    ["export { … as default }", 'const m = { a: "x" };\nexport { m as default };'],
    ["a call around the object", 'export default defineMessages({ a: "x" });'],
    ["export =", 'export = { a: "x" };'],
  ])("finds the object of %s", (_, source) => {
    expect(read(source)).toEqual({ a: "x" });
  });

  it("takes the biggest exported object, and none from a module without one", () => {
    expect(read('export const meta = { dir: "ltr" };\nexport const messages = { a: "x", b: { c: "y" } };')).toEqual({ a: "x", "b.c": "y" });
    expect(parseModule('export function f() { return { a: "x" }; }').value).toBeUndefined();
  });

  it("reads strings, template literals, numbers and nested objects and arrays", () => {
    const source = [
      "#!/usr/bin/env node",
      "// a comment",
      "export default {",
      `  a: 'it\\'s', b: "tab\\tx \\u00e7 \\u{1F600}", "quoted-key": "q", 42: "n",`,
      "  c: `two",
      "lines`,",
      "  /* more */ n: 5, neg: -1, t: true, z: null, list: ['x', \"y\"],",
      "};",
    ].join("\n");
    expect(read(source)).toEqual({
      a: "it's",
      b: "tab\tx ç 😀",
      "quoted-key": "q",
      "42": "n",
      c: "two\nlines",
      n: "number",
      neg: "number",
      t: "boolean",
      z: "null",
      "list.0": "x",
      "list.1": "y",
    });
  });

  it("reads functions and writes the parameters they use as placeholders", () => {
    const source = `export default {
      a: n => \`\${n} days\`,
      b: (n: number, unit?: string): string => \`\${n} \${unit}\`,
      c(name) { return \`Hi \${name}\`; },
      d: function (x) { return "X: " + x },
      e: ({ first, last: family }: Person) => \`\${first} \${family}\`,
      f: (label: string) => \`Undo \${label.toLowerCase()}\`,
      g: () => \`\${APP_NAME} \${t("app.title")}\`,
      h: (x) => { const y = x * 2; return \`\${y}\`; },
    }`;
    expect(read(source)).toEqual({
      a: "{n} days (n)",
      b: "{n} {unit} (n, unit)",
      c: "Hi {name} (name)",
      d: "X: {x} (x)",
      e: "{first} {family} (first, family)",
      f: "Undo {label} (label)",
      g: '{APP_NAME} {t("app.title")} ()',
      h: "skipped: a function with more than a return statement",
    });
  });

  it("reads plural calls, with # as the number, and objects of plural forms", () => {
    const source = `export const messages = {
      a: (n: number) => plural(n, { one: "# day", other: "# days" }),
      b: (done, total) => plural(total, { one: \`\${done} of # set\`, other: \`\${done} of # sets\` }),
      c: (a, b) => \`So far \${plural(a, { one: '# day', other: '# days' })} and \${plural(b, { other: '# x' })}\`,
      d: { one: "# apple", other: "# apples" },
      e: { one: "First", two: "Second" },
      f: (items) => i18n.plural(items.length, { few: "#", other: "# items" }),
    }`;
    expect(read(source)).toEqual({
      a: "{n} days [plural {n}: one: {n} day, other: {n} days] (n)",
      b: "{done} of {total} sets [plural {total}: one: {done} of {total} set, other: {done} of {total} sets] (done, total)",
      c: "So far {a} days and {b} x [plural(a, …) {a}: one: {a} day, other: {a} days] [plural(b, …) {b}: other: {b} x] (a, b)",
      d: "# apples [plural: one: # apple, other: # apples]",
      // Without a call, an object is plural forms only when it has `other`.
      "e.one": "First",
      "e.two": "Second",
      f: "{items} items [plural {items}: few: {items}, other: {items} items] (items)",
    });
  });

  it("joins the texts of a condition, and reads + between strings", () => {
    const source = `export default {
      a: (week, weeks) => weeks > 1 ? \`\${week}, \${plural(weeks, { few: "# a", other: "# b" })}\` : \`\${week}\`,
      b: (rpe, earlier) => \`\${earlier ? "Last logged RPE" : "Last set"} (RPE \${rpe})\`,
      c: (month) => \`Bilan \${/^[aeiouy]/i.test(month) ? 'd’' : 'de '}\${month}\`,
      d: (terms) => 'I agree to the ' + terms + '.',
      e: (x) => x?.name ?? "none",
    }`;
    expect(read(source)).toEqual({
      a: "{week}, {weeks} b | {week} [plural(weeks, …) {weeks}: few: {weeks} a, other: {weeks} b] (week, weeks)",
      b: "[Last logged RPE | Last set] (RPE {rpe}) (rpe, earlier)",
      c: "Bilan [d’ | de ]{month} (month)",
      d: "I agree to the {terms}. (terms)",
      e: "{x} (x)",
    });
  });

  it("keeps what it cannot read, with what it is", () => {
    const source = `const base = { a: 1 };
export default {
  ...base,
  [KEY]: "x",
  title: BRAND,
  label: getLabel(),
  either: a || "b",
  shorthand,
  sub: { ...other, x: "y" },
}`;
    expect(read(source)).toEqual({
      "(top) unread": "[KEY] is a computed key",
      title: "skipped: BRAND comes from elsewhere",
      label: "skipped: getLabel(…) is a call, not text",
      either: 'skipped: a||"b" is not a string, template literal or plural() call',
      shorthand: "skipped: shorthand comes from elsewhere",
      "sub unread": "...other is a spread, so the keys it adds are not checked",
      "sub.x": "y",
    });
    expect(parseModule(source).value!.unread.map((part) => part.what)).toEqual([
      "...base is a spread, so the keys it adds are not checked",
      "[KEY] is a computed key",
    ]);
  });

  it("keeps duplicate keys and where each key and plural form is", () => {
    const { value, position } = parseModule('export default {\n  a: "1",\n  a: (n) => plural(n, {\n    other: "#",\n  }),\n};');
    expect(value!.entries.map((entry) => [entry.key, position(entry.offset)])).toEqual([
      ["a", { line: 2, column: 3 }],
      ["a", { line: 3, column: 3 }],
    ]);
    const text = value!.entries[1]!.value;
    if (text.type !== "text") throw new Error("expected text");
    expect(position(text.plurals[0]!.offset)).toEqual({ line: 3, column: 13 });
    expect(position(text.plurals[0]!.forms.get("other")!.offset)).toEqual({ line: 4, column: 5 });
  });

  it("reports code it cannot split into tokens", () => {
    expect(() => parseModule('export default {\n  a: "x\n}')).toThrow(ModuleSyntaxError);
    expect(() => parseModule('export default {\n  a: "x\n}')).toThrow(expect.objectContaining({ message: "A string that is never closed", line: 2, column: 6 }));
    expect(() => parseModule("export default { a: `x ${y }")).toThrow("A template literal that is never closed");
  });
});
