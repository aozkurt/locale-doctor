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

  it("matches keys and placeholders case-insensitively, ignores descriptions, and reports duplicates", () => {
    expect(result.layers).toEqual([
      expect.objectContaining({ kind: "json", path: "_locales", format: "webextension", source: "en", locales: ["de"] }),
    ]);
    expect(outline(result)).toEqual([
      "error placeholder-mismatch de count",
      "error duplicate-key en casekey",
    ]);
    expect(result.issues.find((issue) => issue.key === "greeting")).toBeUndefined();
    expect(result.issues.find((issue) => issue.key === "casekey" && issue.rule === "extra-key")).toBeUndefined();
  });
});

describe("catalogs written as TypeScript modules", async () => {
  const result = await check({ root: fixture("modules") });

  it("reads them as a module layer", () => {
    expect(result.layers).toEqual([
      expect.objectContaining({ kind: "module", path: "src/i18n/messages", format: "module", source: "en", locales: ["de", "fr", "ja", "pl", "ru"], keys: 14 }),
    ]);
  });

  it("reports every planted problem, and nothing else", () => {
    expect(outline(result)).toEqual([
      "error missing-key de settings.export",
      "info dynamic-value de common",
      "info dynamic-value de settings.title",
      "error type-mismatch de settings.reminder",
      "warning extra-key de settings.old",
      "info plural-forms fr -",
      "info dynamic-value ja common",
      "info plural-forms ja -",
      "warning untranslated ja settings.export",
      "error plural-forms pl home.workouts",
      "error placeholder-mismatch pl home.planned",
      "info plural-forms pl home.streak",
      "info plural-forms ru home.planned",
      "warning plural-implied-quantity ru home.days",
    ]);
  });

  it("leaves out the plural forms a module may skip on purpose, but not other", () => {
    const plurals = result.issues.filter((issue) => issue.rule === "plural-forms" && issue.key);
    expect(plurals.map(({ severity, locale, key, message }) => `${severity} ${locale} ${key}: ${message}`)).toEqual([
      "error pl home.workouts: Missing other — Polish uses one, few, many, other",
      "info pl home.streak: Missing one in plural(weeks, …) — Polish uses one, few, many, other",
      "info ru home.planned: Missing few, many — Russian uses one, few, many, other",
    ]);
    // Russian "# фото" has only `other`: a word that never changes.
    expect(result.issues.some((issue) => issue.locale === "ru" && issue.key === "home.photos")).toBe(false);
  });

  it("reads template literals and # as placeholders, by the parameters they use", () => {
    const find = (rule: string, locale: string) => result.issues.find((issue) => issue.rule === rule && issue.locale === locale)!;
    expect(find("placeholder-mismatch", "pl").message).toBe('The few form drops {done} (other: "Zapisano {done} z {total} zaplanowanej serii")');
    expect(find("plural-implied-quantity", "ru")).toMatchObject({
      file: "src/i18n/messages/ru.ts",
      line: 19,
      message: 'The one form of plural(rest, …) has no number, but Russian uses it for 1, 21, 31, 41… — they would all read "день отдыха"',
    });
    // en has ${label.toLowerCase()} where de has ${label}: the same parameter.
    expect(result.issues.some((issue) => issue.key === "home.undo")).toBe(false);
  });

  it("notes what it cannot read, and does not report the keys it may hold", () => {
    expect(result.issues.filter((issue) => issue.rule === "dynamic-value").map((issue) => issue.message)).toEqual([
      "Not read: [SECRET_KEY] is a computed key",
      "Not read: APP_TITLE comes from elsewhere",
      "Not read: ...shared is a spread, so the keys it adds are not checked",
    ]);
    // ja has no common.cancel of its own, but its ...shared may; de's settings.title is a name from elsewhere.
    const missing = result.issues.filter((issue) => issue.rule === "missing-key").map((issue) => issue.key);
    expect(missing).toEqual(["settings.export"]);
  });

  it("knows text moved to the part the source leaves empty", () => {
    expect(result.issues.some((issue) => issue.rule === "empty-value")).toBe(false);
  });
});

describe("catalogs written as JavaScript modules", async () => {
  const result = await check({ root: fixture("modules-js") });

  it("reads export default and module.exports", () => {
    expect(result.layers[0]).toMatchObject({ kind: "module", path: "locales", format: "module", source: "en", locales: ["de", "ko"] });
    expect(outline(result)).toEqual(["error placeholder-mismatch de today", "error duplicate-key de title"]);
    expect(result.issues[0]!.message).toBe('Drops {band}; has {bnd}, which en does not (en: "Today: {band}")');
  });
});

describe("modules with i18next plural keys", async () => {
  const result = await check({ root: fixture("modules-i18next") });

  it("groups the plural keys and keeps the module rules for them", () => {
    expect(result.layers[0]).toMatchObject({ kind: "module", format: "i18next", source: "en", locales: ["ja", "ru"], keys: 4 });
    expect(outline(result)).toEqual(["info plural-forms ja -", "info plural-forms ru recap.logged_*", "error placeholder-mismatch ru recap.greeting"]);
    expect(result.issues[0]!.message).toBe("Japanese never uses the one form, which 2 plurals have: nav.streak_one, recap.logged_one");
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

describe("modules named like languages", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "locale-doctor-"));
  afterAll(() => rm(temp, { recursive: true, force: true }));

  it("are left alone when their objects share no keys", async () => {
    await mkdir(path.join(temp, "code/src/utils"), { recursive: true });
    await writeFile(path.join(temp, "code/src/utils/is.ts"), "export const is = { text: (x: unknown) => typeof x === 'string' };");
    await writeFile(path.join(temp, "code/src/utils/os.ts"), "export default { platform: 'android', version: 14 };");
    expect((await check({ root: path.join(temp, "code") })).layers).toEqual([]);
  });

  it("get a note for a module that cannot be read, whose keys are not reported", async () => {
    await mkdir(path.join(temp, "broken/i18n"), { recursive: true });
    await writeFile(path.join(temp, "broken/i18n/en.ts"), 'export default { a: "Apple", b: "Pear" };');
    await writeFile(path.join(temp, "broken/i18n/de.ts"), 'export default { a: "Apfel", b: "Birne" };');
    await writeFile(path.join(temp, "broken/i18n/fr.ts"), 'export default {\n  a: "Pomme\n};');
    const result = await check({ root: path.join(temp, "broken") });
    expect(result.layers[0]).toMatchObject({ kind: "module", locales: ["de", "fr"] });
    expect(result.issues).toEqual([
      expect.objectContaining({
        rule: "parse-error",
        severity: "info",
        locale: "fr",
        line: 2,
        column: 6,
        message: "Could not read this module (a string that is never closed), so fr is not checked",
      }),
    ]);
  });
});

describe("layers that translate from text in the code", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "locale-doctor-"));
  afterAll(() => rm(temp, { recursive: true, force: true }));

  it("note the language the others translate from instead of warning about it", async () => {
    for (const folder of ["locales", "guides", "android/app/src/main/res/values", "android/app/src/main/res/values-de"]) {
      await mkdir(path.join(temp, folder), { recursive: true });
    }
    await writeFile(path.join(temp, "locales/en.json"), '{ "title": "Workouts", "open": "Open the guide" }');
    await writeFile(path.join(temp, "locales/de.json"), '{ "title": "Trainings", "open": "Anleitung öffnen" }');
    // The guides' English is in the code; only their translations are files, de the first of them.
    await writeFile(path.join(temp, "guides/de.ts"), 'export const steps = { squat: ["Stell dich hin.", "Geh in die Hocke."] };');
    await writeFile(path.join(temp, "guides/fr.ts"), 'export const steps = { squat: ["Tiens-toi droit.", "Accroupis-toi."] };');
    await writeFile(path.join(temp, "android/app/src/main/res/values/strings.xml"), '<resources><string name="widget">Today\\\'s workout</string></resources>');
    await writeFile(path.join(temp, "android/app/src/main/res/values-de/strings.xml"), '<resources><string name="widget">Heutiges Training</string></resources>');
    const result = await check({ root: temp });
    expect(result.layers.map(({ kind, source }) => `${kind} ${source}`)).toEqual(["json en", "module de", "android values"]);
    expect(result.issues.map(({ severity, layer, message }) => `${severity} ${layer}: ${message}`)).toEqual([
      "warning locales: No fr — other layers have it",
      "info guides: No en, which the other layers translate from — fine if this layer's en text is in the code",
      "warning android/app/src/main/res: No values-fr/ — other layers have fr, so Android shows the values/ text there",
    ]);
  });
});

describe("text left the same as the source", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "locale-doctor-"));
  afterAll(() => rm(temp, { recursive: true, force: true }));

  it("is fine when the language writes those words itself, and a % sequence is text without printf in the source", async () => {
    await mkdir(path.join(temp, "locales"), { recursive: true });
    await writeFile(
      path.join(temp, "locales/en.json"),
      JSON.stringify({ inApp: "In Google Drive", open: "Open Google Drive", night: "Sleep in the night", export: "Export your workouts", points: "{n} points" }),
    );
    await writeFile(
      path.join(temp, "locales/de.json"),
      JSON.stringify({ inApp: "In Google Drive", open: "Google Drive öffnen", night: "Schlaf in der Nacht", export: "Export your workouts", points: "{n} Punkte" }),
    );
    await writeFile(
      path.join(temp, "locales/fr.json"),
      JSON.stringify({ inApp: "Dans Google Drive", open: "Ouvrir Google Drive", night: "Dormir la nuit", export: "Exporter tes séances", points: "{n} points" }),
    );
    await writeFile(
      path.join(temp, "locales/ko.json"),
      JSON.stringify({ inApp: "Google Drive에서", open: "Google Drive 열기", night: "밤에 자기", export: "운동 내보내기", points: "{n}%p" }),
    );
    const result = await check({ root: temp });
    expect(outline(result)).toEqual(["warning untranslated de export"]);
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
