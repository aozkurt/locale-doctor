export interface IcuPlural {
  /** The counted argument: "count" in {count, plural, ...}. */
  argument: string;
  ordinal: boolean;
  /** The option selectors in order: "one", "other", "=0". */
  options: string[];
  /** The options whose text shows no number (no # and no {count}). */
  optionsWithoutNumber: string[];
}

export interface IcuMessage {
  /** Every argument name, nested ones included. */
  arguments: string[];
  /** Rich-text tags such as <b> and <link>, as formatjs and next-intl use them. */
  tags: string[];
  plurals: IcuPlural[];
}

export class IcuSyntaxError extends Error {}

const TAG = /^<(\/?)([A-Za-z0-9][\w.:-]*)\s*\/?>/;

/** Reads an ICU MessageFormat string far enough to know its arguments, tags and plural options. */
export function parseIcu(message: string): IcuMessage {
  const names = new Set<string>();
  const tags = new Set<string>();
  const plurals: IcuPlural[] = [];
  let i = 0;

  const fail = (problem: string): never => {
    throw new IcuSyntaxError(problem);
  };
  // What stands at the current position, for "unexpected …" errors.
  const unexpected = (after: string): never =>
    fail(i < message.length ? `an unexpected ${JSON.stringify(message[i])} after ${after}` : "a { that is never closed");
  const space = () => {
    while (i < message.length && /\s/.test(message[i]!)) i++;
  };
  const word = (): string => {
    const start = i;
    while (i < message.length && !/[\s,{}]/.test(message[i]!)) i++;
    return message.slice(start, i);
  };

  // Reads text up to the end of the message or, inside an option, up to the option's closing brace.
  // Returns whether the text shows the number counted by `counted`.
  const text = (nested: boolean, counted: string | undefined): boolean => {
    let showsNumber = false;
    while (i < message.length) {
      const c = message[i]!;
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") {
          i += 2;
        } else if (next === "{" || next === "}" || next === "<" || (counted !== undefined && next === "#")) {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? message.length : end + 1;
        } else {
          i++;
        }
        continue;
      }
      if (c === "{") {
        if (argument(counted)) showsNumber = true;
        continue;
      }
      if (c === "}") {
        if (nested) return showsNumber;
        fail("a } without a matching {");
      }
      if (c === "#" && counted !== undefined) {
        showsNumber = true;
      } else if (c === "<") {
        const tag = TAG.exec(message.slice(i));
        if (tag) {
          if (!tag[1]) tags.add(tag[2]!);
          i += tag[0].length;
          continue;
        }
      }
      i++;
    }
    if (nested) fail("a { that is never closed");
    return showsNumber;
  };

  // Reads one argument, from its { to its }. Returns whether it shows the number counted by `counted`.
  const argument = (counted: string | undefined): boolean => {
    i++;
    space();
    const name = word();
    if (!name) {
      if (message[i] === "}") fail("an empty {}");
      unexpected("{");
    }
    names.add(name);
    space();
    if (message[i] === "}") {
      i++;
      return name === counted;
    }
    if (message[i] !== ",") unexpected(`{${name}`);
    i++;
    space();
    const type = word();
    space();
    if (message[i] === "}") {
      i++;
      return name === counted;
    }
    if (message[i] !== ",") unexpected(`{${name}, ${type}`);
    i++;

    if (type !== "plural" && type !== "selectordinal" && type !== "select") {
      // A style such as {price, number, ::currency/EUR}: skip to the closing brace.
      let depth = 0;
      while (i < message.length) {
        const c = message[i++];
        if (c === "{") depth++;
        else if (c === "}" && depth-- === 0) return name === counted;
      }
      return fail(`{${name}, ${type}, …} is never closed`);
    }

    const options: string[] = [];
    const withoutNumber: string[] = [];
    const inside = type === "select" ? counted : name;
    for (;;) {
      space();
      if (i >= message.length) fail(`{${name}, ${type}, …} is never closed`);
      if (message[i] === "}") {
        i++;
        break;
      }
      const selector = word();
      if (!selector) fail(`an option without a name in {${name}, ${type}, …}`);
      if (type !== "select" && selector.startsWith("offset:")) continue;
      space();
      if (message[i] !== "{") fail(`no {…} after "${selector}" in {${name}, ${type}, …}`);
      i++;
      const shows = text(true, inside);
      i++;
      options.push(selector);
      if (!shows) withoutNumber.push(selector);
    }
    if (options.length === 0) fail(`{${name}, ${type}} has no options`);
    if (type !== "select") {
      plurals.push({ argument: name, ordinal: type === "selectordinal", options, optionsWithoutNumber: withoutNumber });
      return name === counted;
    }
    // A select inside a plural option shows the number when each of its options does.
    return counted !== undefined && withoutNumber.length === 0;
  };

  text(false, undefined);
  return { arguments: [...names], tags: [...tags], plurals };
}
