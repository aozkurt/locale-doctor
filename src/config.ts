import { readFile } from "node:fs/promises";
import path from "node:path";
import { toLocale } from "./locale.js";
import { RULES, type RuleId, type Severity } from "./model.js";
import { JsonSyntaxError, parseJson } from "./parsers/json.js";

export interface Config {
  /** The language the others are translated from. Default: en, or the most complete locale. */
  source?: string;
  /** Paths to leave out, as globs relative to the checked folder: "legacy/**". */
  ignore?: string[];
  /** Keys to leave out, with * as a wildcard: "debug.*". */
  ignoreKeys?: string[];
  /** Texts that may stay the same as the source in any language: "OK", "Email". */
  allowIdentical?: string[];
  /** Turns rules off or changes their severity: { "untranslated": "off" }. */
  rules?: Partial<Record<RuleId, Severity | "off">>;
}

export class ConfigError extends Error {}

export const CONFIG_FILE = "locale-doctor.config.json";

const OPTIONS = ["source", "ignore", "ignoreKeys", "allowIdentical", "rules"];
const LEVELS = ["error", "warning", "info", "off"];

/** Reads `file`, or else locale-doctor.config.json in `root`, or else "localeDoctor" in its package.json. */
export async function loadConfig(root: string, file?: string): Promise<{ config: Config; file?: string }> {
  if (file) {
    const text = await read(file);
    if (text === undefined) throw new ConfigError(`Cannot read the config file ${file}`);
    return { config: validate(parse(text, file), file), file };
  }
  const own = path.join(root, CONFIG_FILE);
  const text = await read(own);
  if (text !== undefined) return { config: validate(parse(text, CONFIG_FILE), CONFIG_FILE), file: own };

  const manifest = await read(path.join(root, "package.json"));
  if (manifest !== undefined) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(manifest);
    } catch {
      return { config: {} };
    }
    if (isObject(pkg) && "localeDoctor" in pkg) {
      return { config: validate(pkg.localeDoctor, "package.json (localeDoctor)"), file: path.join(root, "package.json") };
    }
  }
  return { config: {} };
}

async function read(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

function parse(text: string, name: string): unknown {
  try {
    parseJson(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) throw new ConfigError(`${name}:${error.line}:${error.column}: ${error.message}`);
    throw error;
  }
  return JSON.parse(text.replace(/^﻿/, ""));
}

export function validate(value: unknown, name: string): Config {
  if (!isObject(value)) throw new ConfigError(`${name}: expected an object`);
  const fail = (message: string): never => {
    throw new ConfigError(`${name}: ${message}`);
  };
  for (const key of Object.keys(value)) {
    if (key !== "$schema" && !OPTIONS.includes(key)) fail(`unknown option "${key}" — the options are ${OPTIONS.join(", ")}`);
  }
  const config: Config = {};
  if (value.source !== undefined) {
    const locale = typeof value.source === "string" ? toLocale(value.source) : undefined;
    if (!locale) fail(`"source" must be a language code such as "en" or "pt-BR"`);
    config.source = locale;
  }
  for (const option of ["ignore", "ignoreKeys", "allowIdentical"] as const) {
    const list = value[option];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) fail(`"${option}" must be a list of strings`);
    config[option] = list as string[];
  }
  if (value.rules !== undefined) {
    if (!isObject(value.rules)) fail(`"rules" must be an object such as { "untranslated": "off" }`);
    const rules: Config["rules"] = {};
    for (const [rule, level] of Object.entries(value.rules as Record<string, unknown>)) {
      if (!(RULES as readonly string[]).includes(rule)) fail(`unknown rule "${rule}" — the rules are ${RULES.join(", ")}`);
      if (typeof level !== "string" || !LEVELS.includes(level)) fail(`rule "${rule}" must be one of ${LEVELS.join(", ")}`);
      rules[rule as RuleId] = level as Severity | "off";
    }
    config.rules = rules;
  }
  return config;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
