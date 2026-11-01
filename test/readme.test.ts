import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { main } from "../src/main.js";

// The README shows real output, and scripts/demo.mjs draws docs/demo.svg from the same lines.
it("shows only lines that locale-doctor really prints", async () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const block = readme.slice(readme.indexOf("<!-- demo:start -->"), readme.indexOf("<!-- demo:end -->"));
  const shown = block
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "" && line.trim() !== "…" && !line.startsWith("```"));
  expect(shown.length).toBeGreaterThan(20);

  let stdout = "";
  await main(["test/fixtures/capacitor-app"], {
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: () => undefined },
    env: {},
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    platform: "linux",
  });
  const normalize = (line: string) => line.replace(/\d+\.\ds\)$/, "0.0s)");
  const printed = new Set(stdout.split("\n").map(normalize));
  for (const line of shown) expect(printed, line).toContain(normalize(line));
});
