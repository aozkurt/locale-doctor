/**
 * The text Android shows for a string resource: double quotes keep their content as it is,
 * backslash escapes are resolved, and whitespace outside quotes collapses to one space.
 */
export function androidText(text: string): string {
  let out = "";
  let quoted = false;
  let space = false;
  const write = (value: string) => {
    if (space && out.length > 0) out += " ";
    space = false;
    out += value;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\") {
      const escaped = text[++i];
      if (escaped === undefined) break;
      if (escaped === "n") write("\n");
      else if (escaped === "t") write("\t");
      else if (escaped === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
        write(String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)));
        i += 4;
      } else write(escaped);
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && /\s/.test(c)) {
      space = true;
    } else {
      write(c);
    }
  }
  return out;
}

export type EscapingProblem = "apostrophe" | "quote" | "reference";

const REFERENCE = /^@(?:\+?[\w.]+:)?\+?[\w.]+\/[\w.]+$|^@null$/;

/** Characters Android needs escaped in a string resource: ' and ", and a leading @. */
export function escapingProblems(text: string): EscapingProblem[] {
  const problems = new Set<EscapingProblem>();
  const trimmed = text.trim();
  if (trimmed.startsWith("@") && !REFERENCE.test(trimmed)) problems.add("reference");
  let quoted = false;
  let quotes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"') {
      quoted = !quoted;
      quotes++;
    } else if (c === "'" && !quoted) problems.add("apostrophe");
  }
  // Quotes around the whole text are how Android keeps apostrophes and spaces; any others are dropped.
  const wrapsAll = quotes === 2 && trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.endsWith('\\"');
  if (quotes > 0 && !wrapsAll) problems.add("quote");
  return [...problems];
}

/** A resource reference such as @string/app_name, whose text lives in another string. */
export function isReference(text: string): boolean {
  return REFERENCE.test(text.trim());
}
