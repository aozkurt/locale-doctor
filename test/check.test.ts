import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import type { CheckResult } from "../src/model.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** One line per issue: severity, rule, locale (* for all), key. */
const outline = (result: CheckResult) =>
  result.issues.map((issue) => [issue.severity, issue.rule, issue.locale ?? "*", issue.key ?? "-"].join(" "));

describe("a Capacitor app with web catalogs and Android strings", async () => {
  const result = await check({ root: fixture("capacitor-app") });

  it("finds both layers", () => {
    expect(result.layers.map(({ kind, path, format, source, locales }) => ({ kind, path, format, source, locales }))).toEqual([
      { kind: "json", path: "src/locales", format: "i18next", source: "en", locales: ["de", "ja", "ru", "tr"] },
      { kind: "android", path: "android/app/src/main/res", format: "android", source: "values", locales: ["values-ja", "values-ru", "values-tr"] },
    ]);
  });

  it("reports every planted problem, and nothing else", () => {
    expect(outline(result)).toEqual([
      "error missing-key * settings.export",
      "warning untranslated ja app.tagline",
      "info plural-forms ja nights_*",
      "warning untranslated ru settings.reminder",
      "warning plural-implied-quantity ru nights_*",
      "warning plural-forms ru nights_*",
      "error missing-key tr settings.language",
      "error duplicate-key tr app.title",
      "warning untranslated tr app.tagline",
      "error placeholder-mismatch tr settings.reminder",
      "warning extra-key tr settings.old",
      "error placeholder-mismatch tr cart.total",
      "warning layer-coverage * -",
      "info not-translated-anywhere * app_name",
      "info not-translated-anywhere * title_activity_main",
      "warning not-translated-anywhere * background_note",
      "warning plural-forms values widget_streak",
      "warning android-escaping values-ja channel_name",
      "warning plural-forms values-ja widget_streak",
      "warning array-size values-ja weekdays",
      "error placeholder-mismatch values-ru widget_duration",
      "warning plural-forms values-ru widget_streak",
      "warning plural-implied-quantity values-ru widget_streak",
      "error missing-key values-tr widget_title",
      "error placeholder-mismatch values-tr widget_discount",
      "error android-escaping values-tr reminder_body",
    ]);
    expect(result.summary).toEqual({ errors: 9, warnings: 14, infos: 3 });
  });

  it("points at the line of each problem", () => {
    const duplicate = result.issues.find((issue) => issue.rule === "duplicate-key")!;
    expect(duplicate).toMatchObject({ file: "src/locales/tr.json", line: 4, column: 5 });
    const apostrophe = result.issues.find((issue) => issue.rule === "android-escaping" && issue.locale === "values-tr")!;
    expect(apostrophe).toMatchObject({ file: "android/app/src/main/res/values-tr/strings.xml", line: 5 });
  });

  it("explains placeholder changes in words", () => {
    const messages = result.issues.filter((issue) => issue.rule === "placeholder-mismatch").map((issue) => issue.message);
    expect(messages).toContain('Drops {{time}}; has {{tme}}, which en does not (en: "Daily reminder at {{time}}")');
    expect(messages).toContain('%2$s where values has %2$d (values: "%1$d h %2$d min")');
  });

  it("leaves brand names and Capacitor's settings alone", () => {
    const keys = result.issues.map((issue) => issue.key);
    for (const key of ["brand", "package_name", "custom_url_scheme", "privacy_url"]) expect(keys).not.toContain(key);
  });

  it("names the Android folders a missing language needs", () => {
    expect(result.issues.find((issue) => issue.rule === "layer-coverage")!.message).toBe(
      "No values-de/ — other layers have de, so Android shows the values/ text there",
    );
  });
});

describe("folder-per-locale catalogs", async () => {
  const result = await check({ root: fixture("namespaces") });

  it("reports the broken file and the missing one, without listing their keys", () => {
    expect(result.issues).toEqual([
      expect.objectContaining({ rule: "parse-error", locale: "de", file: "public/locales/de/common.json", line: 4 }),
      expect.objectContaining({ rule: "missing-file", locale: "fr", file: "public/locales/fr/home.json", message: "No home.json — en has 1 key in it" }),
    ]);
  });
});

describe("ICU messages", async () => {
  const result = await check({ root: fixture("icu") });

  it("checks plural options, arguments, tags and syntax", () => {
    expect(outline(result)).toEqual([
      "warning plural-forms ar inbox",
      "error placeholder-mismatch ar welcome",
      "error message-syntax ar rank",
      "info plural-forms fr -",
      "warning plural-forms ru inbox",
      "warning placeholder-mismatch ru welcome",
    ]);
    expect(result.issues[0]!.message).toBe("{count, plural} has no zero, two, few, many — Arabic uses zero, one, two, few, many, other");
  });
});

describe("WebExtension message catalogs", async () => {
  const result = await check({ root: fixture("webextension") });

  it("compares message values, ignores descriptions, and checks placeholders", () => {
    expect(result.layers).toEqual([
      expect.objectContaining({ kind: "json", path: "_locales", format: "webextension", source: "en", locales: ["de"] }),
    ]);
    expect(outline(result)).toEqual(["error placeholder-mismatch de count"]);
    expect(result.issues[0]!.message).toContain("$2");
    expect(result.issues[0]!.message).toContain("$1");
  });
});

describe("options", () => {
  it("finds nothing wrong in a clean project", async () => {
    const result = await check({ root: fixture("clean") });
    expect(result.issues).toEqual([]);
    expect(result.layers[0]).toMatchObject({ format: "simple", source: "en", locales: ["de"] });
  });

  it("takes the source language from the options", async () => {
    const result = await check({ root: fixture("clean"), source: "de" });
    expect(result.layers[0]).toMatchObject({ source: "de", locales: ["en"] });
  });

  it("applies the config: rule levels, ignored keys and paths", async () => {
    const result = await check({
      root: fixture("capacitor-app"),
      config: { rules: { untranslated: "off", "extra-key": "error" }, ignoreKeys: ["cart.*"], ignore: ["android/**"] },
    });
    expect(result.layers.map((layer) => layer.kind)).toEqual(["json"]);
    expect(result.issues.some((issue) => issue.rule === "untranslated")).toBe(false);
    expect(result.issues.some((issue) => issue.key === "cart.total")).toBe(false);
    expect(result.issues.find((issue) => issue.rule === "extra-key")!.severity).toBe("error");
  });

  it("lets texts stay the same when the config allows it", async () => {
    const result = await check({ root: fixture("capacitor-app"), config: { allowIdentical: ["Daily reminder at {{time}}"] } });
    expect(result.issues.some((issue) => issue.key === "settings.reminder" && issue.rule === "untranslated")).toBe(false);
  });
});

describe("a broken source file", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "locale-doctor-"));
  afterAll(() => rm(temp, { recursive: true, force: true }));

  it("is reported alone, without comparing the translations to another language", async () => {
    await mkdir(path.join(temp, "flat/locales"), { recursive: true });
    await writeFile(path.join(temp, "flat/locales/en.json"), '{ "a": "Apple" ');
    await writeFile(path.join(temp, "flat/locales/de.json"), '{ "a": "Apfel", "b": "Birne" }');
    await writeFile(path.join(temp, "flat/locales/fr.json"), '{ "a": "Pomme" }');
    const result = await check({ root: path.join(temp, "flat") });
    expect(outline(result)).toEqual(["error parse-error en -"]);
  });

  it("in a folder-per-locale layout leaves that namespace out", async () => {
    for (const locale of ["en", "de"]) await mkdir(path.join(temp, `folders/locales/${locale}`), { recursive: true });
    await writeFile(path.join(temp, "folders/locales/en/common.json"), '{ "save": "Save" ');
    await writeFile(path.join(temp, "folders/locales/en/home.json"), '{ "hi": "Hi" }');
    await writeFile(path.join(temp, "folders/locales/de/common.json"), '{ "save": "Speichern" }');
    await writeFile(path.join(temp, "folders/locales/de/home.json"), "{}");
    const result = await check({ root: path.join(temp, "folders") });
    expect(outline(result)).toEqual(["error missing-key * home:hi", "error parse-error en -"]);
  });
});

describe("outside a git repository", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "locale-doctor-"));
  afterAll(() => rm(temp, { recursive: true, force: true }));

  it("walks the folders and skips build output", async () => {
    await cp(fixture("capacitor-app"), temp, { recursive: true });
    // A copy of the web build, as Capacitor leaves it in the Android project, must not count.
    await cp(path.join(temp, "src/locales"), path.join(temp, "android/app/src/main/assets/public/locales"), { recursive: true });
    await cp(path.join(temp, "src/locales"), path.join(temp, "node_modules/some-lib/locales"), { recursive: true });
    const result = await check({ root: temp });
    expect(result.layers.map((layer) => layer.path)).toEqual(["src/locales", "android/app/src/main/res"]);
    expect(result.summary).toEqual({ errors: 9, warnings: 14, infos: 3 });
  });
});
