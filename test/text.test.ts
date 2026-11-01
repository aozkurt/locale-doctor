import { describe, expect, it } from "vitest";
import { androidText, escapingProblems } from "../src/android.js";
import { analyze, words } from "../src/text.js";

const ids = (text: string, format: Parameters<typeof analyze>[1], formatted = true) => analyze(text, format, formatted).tokens.map((token) => token.id);

describe("analyze", () => {
  it("reads i18next placeholders, nesting and Trans tags", () => {
    expect(ids("Hi {{ name }}, $t(common.app) <1>{{count, number}}</1><br/>", "i18next")).toEqual([
      "{{name}}",
      "{{count}}",
      "$t(common.app)",
      "<1>",
      "<br>",
    ]);
  });

  it("reads simple braces, Rails and printf placeholders", () => {
    expect(ids("{0} of %{total}: %s and %1$d", "simple")).toEqual(["{0}", "{total}", "%s", "%1$d"]);
  });

  it("reads ICU arguments inside plural options, and rich text tags", () => {
    const analysis = analyze("{count, plural, one {# item from {seller}} other {# items}} <b>{total, number}</b>", "icu");
    expect(analysis.tokens.map((token) => token.id)).toEqual(["{count}", "{seller}", "{total}", "<b>"]);
    expect(analysis.icu!.plurals).toEqual([{ argument: "count", ordinal: false, options: ["one", "other"], optionsWithoutNumber: [] }]);
  });

  it("knows which ICU plural options show the number", () => {
    expect(analyze("{n, plural, one {one day} other {# days}}", "icu").icu!.plurals[0]!.optionsWithoutNumber).toEqual(["one"]);
    expect(analyze("{n, plural, one {{n} day} other {# days}}", "icu").icu!.plurals[0]!.optionsWithoutNumber).toEqual([]);
  });

  it("leaves quoted ICU text alone", () => {
    expect(ids("It''s '{literal}' {name}", "icu")).toEqual(["{name}"]);
  });

  it.each([
    ["{count, plural, one {x}", "{count, plural, …} is never closed"],
    ["Hello {name", "a { that is never closed"],
    ["Hello }", "a } without a matching {"],
    ["{n, plural, one x other {y}}", 'no {…} after "one" in {n, plural, …}'],
  ])("reports the ICU syntax error in %j", (text, error) => {
    expect(analyze(text, "icu").syntaxError).toBe(error);
  });

  it("numbers Android format specifiers the way java.util.Formatter does", () => {
    expect(ids("%d of %s", "android")).toEqual(["%1$d", "%2$s"]);
    expect(ids("%2$s, %1$d", "android")).toEqual(["%2$s", "%1$d"]);
    expect(ids("%.1f km, %x", "android")).toEqual(["%1$f", "%2$d"]);
  });

  it("finds % signs that are not format specifiers", () => {
    expect(analyze("Get %1$d% off", "android").strayPercents).toBe(1);
    expect(analyze("%50 indirim, %1$d gün", "android").strayPercents).toBe(1);
    expect(analyze("Get %1$d%% off", "android").strayPercents).toBe(0);
    expect(analyze("100%", "android", false).strayPercents).toBe(0);
  });
});

describe("androidText", () => {
  it.each([
    ["  Hello   world ", "Hello world"],
    ['"  spaced  out  "', "  spaced  out  "],
    ["it\\'s", "it's"],
    ["\\u00e7a", "ça"],
    ["one\\ntwo", "one\ntwo"],
    ['Say \\"hi\\"', 'Say "hi"'],
  ])("shows %j as %j", (raw, text) => {
    expect(androidText(raw)).toBe(text);
  });
});

describe("escapingProblems", () => {
  it.each([
    ["it's", ["apostrophe"]],
    ["it\\'s", []],
    ['"it\'s"', []],
    ['Say "hi"', ["quote"]],
    ['Say \\"hi\\"', []],
    ["@string/app_name", []],
    ["@user is online", ["reference"]],
  ])("finds %j → %j", (raw, problems) => {
    expect(escapingProblems(raw)).toEqual(problems);
  });
});

describe("words", () => {
  it("leaves out placeholders, tags, links and plural keywords", () => {
    expect(words("Hello {{name}}, see https://x.io <b>now</b> %1$d")).toEqual(["Hello", "see", "now"]);
    expect(words("{count, plural, one {# night} other {# nights}}")).toEqual(["night", "nights"]);
  });
});
