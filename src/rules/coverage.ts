import { androidFolder, localeKey } from "../locale.js";
import type { Issue, Layer } from "../model.js";
import { needsTranslation, OPTIONAL_ANDROID } from "./layer.js";

/**
 * Compares the languages of the layers: a language the web catalogs have and the Android
 * strings do not means notifications, widgets and the like stay in the source language.
 */
export function checkCoverage(layers: Layer[]): Issue[] {
  if (layers.length < 2) return [];
  const all = new Map<string, string>();
  const perLayer = layers.map((layer) => {
    const keys = new Set<string>();
    for (const catalog of [layer.source, ...layer.targets]) {
      const key = localeKey(catalog.locale);
      keys.add(key);
      if (!all.has(key)) all.set(key, catalog.locale);
    }
    return keys;
  });

  const issues: Issue[] = [];
  layers.forEach((layer, index) => {
    // An Android layer with nothing but the app name and Capacitor's settings needs no translations.
    if (layer.kind === "android" && ![...layer.source.messages.values()].some((m) => m.translatable && !OPTIONAL_ANDROID.has(m.key) && needsTranslation(m))) {
      return;
    }
    const missing = [...all].filter(([key]) => !perLayer[index]!.has(key)).map(([, locale]) => locale);
    if (missing.length === 0) return;
    const them = missing.length === 1 ? "it" : "them";
    issues.push({
      rule: "layer-coverage",
      severity: "warning",
      layer: layer.path,
      message:
        layer.kind === "android"
          ? `No ${missing.map((locale) => `${androidFolder(locale)}/`).join(", ")} — other layers have ${missing.join(", ")}, so Android shows the ${layer.source.label}/ text there`
          : `No ${missing.join(", ")} — other layers have ${them}`,
    });
  });
  return issues;
}
