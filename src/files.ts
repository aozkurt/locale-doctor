import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const ALWAYS_SKIPPED = new Set(["node_modules", ".git", ".hg", ".svn"]);

// Without git there is no .gitignore to go by, so skip the folders that hold builds and dependencies.
const SKIPPED_WHEN_WALKING = new Set([
  ...ALWAYS_SKIPPED,
  ".angular",
  ".cache",
  ".expo",
  ".gradle",
  ".idea",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "DerivedData",
  "dist",
  "out",
  "Pods",
  "target",
  "vendor",
  "www",
]);

// Capacitor copies the web build into the native projects; those copies are not sources.
const GENERATED = [/(?:^|\/)src\/main\/assets\/public\//, /(?:^|\/)App\/App\/public\//];

/**
 * The JSON, XML, JavaScript and TypeScript files under `root`, as forward-slash paths relative to
 * it. Inside a git repository this is what git tracks or would track (so .gitignore applies), else
 * a folder walk.
 */
export async function listFiles(root: string, ignore: string[] = []): Promise<string[]> {
  const files = (await gitFiles(root)) ?? (await walk(root));
  const ignored = ignore.map(globToRegExp);
  return files
    .filter((file) => /\.(?:json|xml|[cm]?[jt]s)$/i.test(file))
    .filter((file) => !file.split("/").some((part) => ALWAYS_SKIPPED.has(part)))
    .filter((file) => !GENERATED.some((pattern) => pattern.test(file)))
    .filter((file) => !ignored.some((pattern) => pattern.test(file)))
    .sort();
}

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      maxBuffer: 1 << 28,
      windowsHide: true,
    });
    return [...new Set(stdout.split("\0").filter(Boolean))];
  } catch {
    return undefined;
  }
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (folder: string, relative: string) => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_WHEN_WALKING.has(entry.name)) await visit(path.join(folder, entry.name), child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  };
  await visit(root, "");
  return files;
}

/** Reads a file of the checked folder; undefined when it is gone (git still lists deleted files). */
export async function readText(root: string, file: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(root, file), "utf8");
  } catch {
    return undefined;
  }
}

/** A path glob: * within a folder name, ** across folders. A pattern also covers what is inside a matched folder. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  const source = glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "*" && source[i + 1] === "*") {
      i++;
      if (source[i + 1] === "/") {
        i++;
        pattern += "(?:.*/)?";
      } else pattern += ".*";
    } else if (c === "*") pattern += "[^/]*";
    else if (c === "?") pattern += "[^/]";
    else pattern += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}(?:/.*)?$`);
}
