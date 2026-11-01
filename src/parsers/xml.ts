import { lineCounter, type Position } from "./position.js";

export interface XmlElement {
  type: "element";
  name: string;
  attributes: Map<string, string>;
  children: XmlNode[];
  /** Offset of the "<" that opens the element. */
  offset: number;
  /** The content between the start and end tags, as written. */
  inner: string;
}

export interface XmlText {
  type: "text";
  /** As written, entities not decoded. */
  raw: string;
}

export interface XmlCdata {
  type: "cdata";
  value: string;
}

export type XmlNode = XmlElement | XmlText | XmlCdata;

export class XmlSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

export interface ParsedXml {
  root: XmlElement;
  position: (offset: number) => Position;
}

const NAME = /[^\s/>=<"']+/y;

/** A small XML parser for resource files: elements, attributes, text, CDATA and comments. */
export function parseXml(text: string): ParsedXml {
  const position = lineCounter(text);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string, at = i): never => {
    const { line, column } = position(at);
    throw new XmlSyntaxError(message, line, column);
  };
  const space = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const skipPast = (end: string, what: string) => {
    const at = text.indexOf(end, i);
    if (at === -1) fail(`${what} that is never closed`);
    i = at + end.length;
  };
  const name = (): string => {
    NAME.lastIndex = i;
    const match = NAME.exec(text);
    if (!match) return "";
    i += match[0].length;
    return match[0];
  };
  // Comments, processing instructions and declarations, which carry nothing a check needs.
  const skipMarkup = (): boolean => {
    if (text.startsWith("<!--", i)) skipPast("-->", "A comment");
    else if (text.startsWith("<?", i)) skipPast("?>", "A processing instruction");
    else if (text.startsWith("<!", i) && !text.startsWith("<![CDATA[", i)) {
      const bracket = text.indexOf("[", i);
      const close = text.indexOf(">", i);
      if (bracket !== -1 && bracket < close) skipPast("]", "A declaration");
      skipPast(">", "A declaration");
    } else return false;
    return true;
  };

  const element = (): XmlElement => {
    const offset = i;
    i++;
    const tag = name();
    if (!tag) fail("A tag without a name");
    const attributes = new Map<string, string>();
    for (;;) {
      space();
      if (text.startsWith("/>", i)) {
        i += 2;
        return { type: "element", name: tag, attributes, children: [], offset, inner: "" };
      }
      if (text[i] === ">") {
        i++;
        break;
      }
      const attribute = name();
      if (!attribute) fail(`Unexpected ${i < text.length ? JSON.stringify(text[i]) : "end of file"} in <${tag}>`);
      space();
      if (text[i] !== "=") fail(`The attribute ${attribute} in <${tag}> has no value`);
      i++;
      space();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail(`The value of ${attribute} in <${tag}> is not in quotes`);
      const end = text.indexOf(quote!, i + 1);
      if (end === -1) fail(`The value of ${attribute} in <${tag}> is never closed`);
      attributes.set(attribute, decodeEntities(text.slice(i + 1, end)));
      i = end + 1;
    }

    const innerStart = i;
    const children: XmlNode[] = [];
    for (;;) {
      if (i >= text.length) fail(`<${tag}> is never closed`, offset);
      if (text.startsWith("</", i)) {
        const closeAt = i;
        i += 2;
        const closing = name();
        space();
        if (text[i] !== ">") fail(`Unexpected ${JSON.stringify(text[i] ?? "")} in </${closing}>`);
        i++;
        if (closing !== tag) fail(`</${closing}> closes <${tag}>`, closeAt);
        return { type: "element", name: tag, attributes, children, offset, inner: text.slice(innerStart, closeAt) };
      }
      if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i);
        if (end === -1) fail("A CDATA section that is never closed");
        children.push({ type: "cdata", value: text.slice(i + 9, end) });
        i = end + 3;
      } else if (skipMarkup()) {
        // nothing to keep
      } else if (text[i] === "<") {
        children.push(element());
      } else {
        const next = text.indexOf("<", i);
        const end = next === -1 ? text.length : next;
        children.push({ type: "text", raw: text.slice(i, end) });
        i = end;
      }
    }
  };

  for (;;) {
    space();
    if (i >= text.length) fail("No root element");
    if (skipMarkup()) continue;
    if (text[i] !== "<") fail("Text before the root element");
    break;
  }
  const root = element();
  for (;;) {
    space();
    if (i >= text.length) break;
    if (!skipMarkup()) fail("Content after the root element");
  }
  return { root, position };
}

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

/** The text inside an element with the tags removed: <b>Hi</b> there → "Hi there". */
export function innerText(element: XmlElement): string {
  let out = "";
  for (const child of element.children) {
    if (child.type === "text") out += decodeEntities(child.raw);
    else if (child.type === "cdata") out += child.value;
    else out += innerText(child);
  }
  return out;
}
