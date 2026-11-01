// Draws docs/demo.svg, the terminal picture at the top of the README: the colored output of
// locale-doctor on test/fixtures/capacitor-app, cut down to the lines the README shows as text
// between <!-- demo:start --> and <!-- demo:end -->. Run it with `npm run demo`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const COLUMNS = 96;
const FONT_SIZE = 14;
const CHAR_WIDTH = 8.45;
const LINE_HEIGHT = 21;
const PADDING = 24;
const TOP = 56;

const COLORS = { 31: "r", 32: "g", 33: "y", 36: "c" };
const ICONS = new Set(["✖", "▲", "●", "✔", "•"]);

const run = spawnSync(process.execPath, ["dist/cli.js", "test/fixtures/capacitor-app", "--color"], {
  encoding: "utf8",
  env: { ...process.env, FORCE_COLOR: "1" },
});
if (run.status !== 1) throw new Error(`Expected the fixture to have errors (exit code 1), got ${run.status}: ${run.stderr}`);

const plain = (text) => text.replace(/\u001b\[\d+m/g, "");
const normalize = (text) => text.replace(/\d+\.\ds\)$/, "0.0s)");
const output = run.stdout.split("\n");

const readme = readFileSync("README.md", "utf8");
const start = readme.indexOf("<!-- demo:start -->");
const end = readme.indexOf("<!-- demo:end -->");
if (start === -1 || end === -1) throw new Error("README.md has no <!-- demo:start --> … <!-- demo:end --> block");
const wanted = readme
  .slice(start, end)
  .split("\n")
  .slice(1)
  .filter((line) => !line.startsWith("```") && !line.startsWith("<!--"));
while (wanted.at(-1) === "") wanted.pop();

const lines = [cellsOf("\u001b[2m$\u001b[22m npx locale-doctor"), []];
for (const line of wanted) {
  if (line.trim() === "…") {
    lines.push(cellsOf(`${line.slice(0, line.indexOf("…"))}\u001b[2m…\u001b[22m`));
    continue;
  }
  const match = output.find((candidate) => normalize(plain(candidate)) === normalize(line));
  if (match === undefined) throw new Error(`This README demo line is not in the output:\n${line}`);
  lines.push(...wrap(cellsOf(match)));
}

const width = Math.ceil(COLUMNS * CHAR_WIDTH + 2 * PADDING);
const height = TOP + lines.length * LINE_HEIGHT + PADDING - 6;
const rows = lines.map((cells, index) => `  <text x="${PADDING}" y="${TOP + index * LINE_HEIGHT}">${spans(cells)}</text>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">locale-doctor on a Capacitor app: missing keys, broken placeholders, missing plural forms and Android escaping bugs</title>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: ${FONT_SIZE}px; fill: #e6edf3; white-space: pre; }
    .b { font-weight: 700; } .d { fill: #8b949e; } .r { fill: #ff7b72; } .g { fill: #3fb950; } .y { fill: #e3b341; } .c { fill: #79c0ff; }
  </style>
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="#30363d"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="42" cy="20" r="6" fill="#febc2e"/>
  <circle cx="62" cy="20" r="6" fill="#28c840"/>
${rows.join("\n")}
</svg>
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/demo.svg", svg);
console.log(`docs/demo.svg: ${lines.length} lines, ${width}×${height}`);

/** Splits a line with ANSI color codes into characters, each with its style. */
function cellsOf(line) {
  const cells = [];
  const style = { bold: false, dim: false, color: undefined };
  for (const part of line.split(/(\u001b\[\d+m)/)) {
    const code = /^\u001b\[(\d+)m$/.exec(part);
    if (!code) {
      for (const char of part) cells.push({ char, style: { ...style } });
      continue;
    }
    const n = Number(code[1]);
    if (n === 1) style.bold = true;
    else if (n === 2) style.dim = true;
    else if (n === 22) style.bold = style.dim = false;
    else if (n === 39) style.color = undefined;
    else if (n >= 30 && n <= 37) style.color = n;
  }
  return cells;
}

/** Breaks a long line at spaces, indenting what follows under the text after the icon. */
function wrap(cells) {
  const leading = cells.findIndex((cell) => cell.char !== " ");
  const indent = leading + (ICONS.has(cells[leading]?.char) ? 2 : 0) + 2;
  const lines = [];
  let rest = cells;
  while (rest.length > COLUMNS) {
    let cut = COLUMNS;
    while (cut > indent && rest[cut].char !== " ") cut--;
    if (cut <= indent) cut = COLUMNS;
    lines.push(rest.slice(0, cut));
    let next = rest.slice(cut);
    while (next[0]?.char === " ") next = next.slice(1);
    rest = [...Array.from({ length: indent }, () => ({ char: " ", style: {} })), ...next];
  }
  lines.push(rest);
  return lines;
}

function spans(cells) {
  let out = "";
  let i = 0;
  while (i < cells.length) {
    const name = className(cells[i].style);
    let text = "";
    while (i < cells.length && className(cells[i].style) === name) text += cells[i++].char;
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    out += name ? `<tspan class="${name}">${escaped}</tspan>` : escaped;
  }
  return out;
}

function className(style) {
  return [style.bold ? "b" : "", style.dim ? "d" : COLORS[style.color] ?? ""].filter(Boolean).join(" ");
}
