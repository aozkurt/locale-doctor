import { describe, expect, it } from "vitest";
import { androidFolder, androidLocale, expectedScript, localeKey, pluralCategories, toLocale } from "../src/locale.js";

describe("toLocale", () => {
  it.each([
    ["en", "en"],
    ["pt_BR", "pt-BR"],
    ["pt-br", "pt-BR"],
    ["zh-Hans", "zh-Hans"],
    ["sr-Latn", "sr-Latn"],
    ["in", "id"],
  ])("reads %s as %s", (name, locale) => {
    expect(toLocale(name)).toBe(locale);
  });

  it.each(["src", "app", "tsconfig", "index", "data", "ui", "lib", "package"])("does not take %s for a language", (name) => {
    expect(toLocale(name)).toBeUndefined();
  });
});

describe("androidLocale", () => {
  it.each([
    ["values", null],
    ["values-tr", "tr"],
    ["values-pt-rBR", "pt-BR"],
    ["values-b+zh+Hans", "zh-Hans"],
    ["values-b+sr+Latn", "sr-Latn"],
    ["values-in", "id"],
    ["values-mcc310-en", "en"],
  ])("reads %s as %s", (folder, locale) => {
    expect(androidLocale(folder)).toBe(locale);
  });

  it.each(["values-night", "values-v21", "values-car", "values-de-land", "values-sw600dp", "drawable"])("skips %s", (folder) => {
    expect(androidLocale(folder)).toBeUndefined();
  });
});

describe("androidFolder", () => {
  it.each([
    ["de", "values-de"],
    ["pt-BR", "values-pt-rBR"],
    ["zh-Hans", "values-b+zh+Hans"],
    ["id", "values-in"],
    ["he", "values-iw"],
  ])("puts %s in %s", (locale, folder) => {
    expect(androidFolder(locale)).toBe(folder);
  });
});

describe("localeKey", () => {
  it("is equal for tags of the same language", () => {
    expect(localeKey("zh-CN")).toBe(localeKey("zh-Hans"));
    expect(localeKey("pt")).toBe(localeKey("pt-BR"));
    expect(localeKey("in")).toBe(localeKey("id"));
    expect(localeKey("en")).not.toBe(localeKey("en-GB"));
  });
});

describe("pluralCategories", () => {
  it("lists the categories with the numbers that pick them", () => {
    const russian = pluralCategories("ru");
    expect(russian.map((info) => info.category)).toEqual(["one", "few", "many", "other"]);
    expect(pluralCategories("ar").map((info) => info.category)).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(russian.find((info) => info.category === "one")!.examples.slice(0, 4)).toEqual([1, 21, 31, 41]);
    expect(pluralCategories("ja").map((info) => info.category)).toEqual(["other"]);
  });

  it("knows that French uses many only for millions", () => {
    expect(pluralCategories("fr").find((info) => info.category === "many")!.examples[0]).toBe(1_000_000);
  });
});

describe("expectedScript", () => {
  it.each([
    ["ru", "Cyrillic"],
    ["ja", "Japanese"],
    ["zh-Hant", "Chinese"],
    ["hi", "Devanagari"],
  ])("expects %s in %s", (locale, name) => {
    expect(expectedScript(locale)?.name).toBe(name);
  });

  it("has nothing to say about languages written in Latin", () => {
    expect(expectedScript("de")).toBeUndefined();
    expect(expectedScript("sr-Latn")).toBeUndefined();
  });
});
