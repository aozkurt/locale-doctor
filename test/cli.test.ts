import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

async function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: { write: (text: string) => (stdout += text), isTTY: false },
    stderr: { write: (text: string) => (stderr += text) },
    env,
    cwd: fixtures,
    platform: "linux",
  });
  return { code, stdout, stderr };
}

describe("locale-doctor", () => {
  it("exits with 1 and a summary when there are errors", async () => {
    const { code, stdout } = await run(["capacitor-app"]);
    expect(code).toBe(1);
    expect(stdout).toContain("✖ 9 errors  ▲ 14 warnings  ● 3 notes  (2 layers, 5 languages");
    expect(stdout).toContain("✖ widget_discount  Has a % that is not part of a format specifier");
    expect(stdout).toContain("android/app/src/main/res/values-tr/strings.xml:4:5 · placeholder-mismatch");
  });

  it("exits with 0 for a clean project", async () => {
    const { code, stdout } = await run(["clean"]);
    expect(code).toBe(0);
    expect(stdout).toContain("✔ No problems in en and its 1 translation");
    expect(stdout).toContain("✔ No problems found");
  });

  it("fails on warnings only with --strict", async () => {
    expect((await run(["warnings"])).code).toBe(0);
    expect((await run(["warnings", "--strict"])).code).toBe(1);
  });

  it("shows only errors with --quiet", async () => {
    const { stdout } = await run(["icu", "--quiet"]);
    expect(stdout).not.toContain("▲");
    expect(stdout).toContain("✔ No errors in fr, ru");
  });

  it("exits with 2 when there is nothing to check", async () => {
    const { code, stderr } = await run(["none"]);
    expect(code).toBe(2);
    expect(stderr).toContain("found no translation files");
  });

  it("prints the result as JSON", async () => {
    const { stdout } = await run(["capacitor-app", "--format", "json"]);
    const report = JSON.parse(stdout);
    expect(report.summary).toEqual({ errors: 9, warnings: 14, infos: 3 });
    expect(Object.keys(report.issues[0])).toEqual(["rule", "severity", "message", "layer", "key", "file", "line", "column"]);
  });

  it("prints GitHub annotations with paths from the working folder", async () => {
    const { stdout } = await run(["capacitor-app", "-f", "github"]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe(
      '::error file=capacitor-app/src/locales/en.json,line=10,col=5,title=locale-doctor (missing-key)::settings.export: Missing in all 4 translations (en: "Export your sleep data")',
    );
    expect(lines).toContain(
      "::error file=capacitor-app/android/app/src/main/res/values-tr/strings.xml,line=4,col=5,title=locale-doctor (placeholder-mismatch)::values-tr · widget_discount: Has a %25 that is not part of a format specifier — String.format throws on it or misreads it; write %25%25 for a percent sign",
    );
    expect(lines.at(-1)).toBe("locale-doctor: 9 errors, 14 warnings, 3 notes in 2 layers");
  });

  it("colors the output only when asked or in a terminal", async () => {
    expect((await run(["clean"])).stdout).not.toContain("\u001b[");
    expect((await run(["clean"], { FORCE_COLOR: "1" })).stdout).toContain("\u001b[32m");
    expect((await run(["clean", "--color"])).stdout).toContain("\u001b[");
  });

  it("rejects bad options", async () => {
    expect(await run(["--bogus"])).toMatchObject({ code: 2, stderr: expect.stringContaining("Unknown option '--bogus'") });
    expect(await run(["-f", "xml"])).toMatchObject({ code: 2, stderr: expect.stringContaining("--format must be pretty, json or github") });
    expect(await run(["-s", "nope"])).toMatchObject({ code: 2, stderr: expect.stringContaining("--source must be a language code") });
    expect(await run(["a", "b"])).toMatchObject({ code: 2, stderr: expect.stringContaining("expected one folder") });
  });

  it("shows help and the version", async () => {
    expect((await run(["--help"])).stdout).toContain("Usage\n  npx locale-doctor [folder] [options]");
    expect((await run(["-v"])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
