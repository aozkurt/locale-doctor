import { describe, expect, it } from "vitest";
import { JsonSyntaxError, parseJson } from "../src/parsers/json.js";
import { innerText, parseXml, XmlSyntaxError, type XmlElement } from "../src/parsers/xml.js";

describe("parseJson", () => {
  it("keeps duplicate keys and where each one is", () => {
    const { value, position } = parseJson('{\n  "a": "1",\n  "a": "2"\n}');
    if (value.type !== "object") throw new Error("expected an object");
    expect(value.entries.map((entry) => entry.key)).toEqual(["a", "a"]);
    expect(position(value.entries[1]!.offset)).toEqual({ line: 3, column: 3 });
  });

  it("reads escapes, surrogate pairs and a byte order mark", () => {
    const { value } = parseJson('﻿{"k": "a\\n\\"b\\" \\u00e7 \\ud83d\\ude00", "n": -1.5e3, "t": true, "z": null, "l": [1, "x"]}');
    if (value.type !== "object") throw new Error("expected an object");
    const first = value.entries[0]!.value;
    expect(first.type === "string" && first.value).toBe('a\n"b" ç 😀');
    expect(value.entries.map((entry) => entry.value.type)).toEqual(["string", "number", "boolean", "null", "array"]);
  });

  it("counts lines in files with Windows line endings", () => {
    expect(() => parseJson('{\r\n  "a": 1,\r\n  "b": }')).toThrow(expect.objectContaining({ line: 3, column: 8 }));
  });

  it.each([
    ['{"a": "x",}', "A trailing comma before }", 1, 11],
    ['{"a": "x" // note\n}', "Comments are not allowed in JSON", 1, 11],
    ['{"a": "x\ny"}', "A line break inside a string (write \\n)", 1, 9],
    ['{"a": "x"', "Unexpected end of file, expected , or }", 1, 10],
    ['{"a": "x"} {}', 'Unexpected "{" after the end of the JSON', 1, 12],
    ["[1, 2,]", "A trailing comma before ]", 1, 7],
    ['{a: "x"}', 'Unexpected "a", expected a key in double quotes', 1, 2],
  ])("reports %j as %j at %i:%i", (text, message, line, column) => {
    expect(() => parseJson(text)).toThrow(JsonSyntaxError);
    expect(() => parseJson(text)).toThrow(expect.objectContaining({ message, line, column }));
  });
});

describe("parseXml", () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- strings -->",
    "<resources>",
    `  <string name="a" translatable='false'>Hi &amp; <b>bye</b><![CDATA[ <x> ]]></string>`,
    "  <plurals name=\"p\"><item quantity=\"one\">1</item></plurals>",
    "</resources>",
    "",
  ].join("\n");

  it("reads elements, attributes, entities, CDATA and nested tags", () => {
    const { root, position } = parseXml(xml);
    expect(root.name).toBe("resources");
    const [string, plurals] = root.children.filter((child): child is XmlElement => child.type === "element");
    expect(string!.attributes.get("translatable")).toBe("false");
    expect(string!.inner).toBe("Hi &amp; <b>bye</b><![CDATA[ <x> ]]>");
    expect(innerText(string!)).toBe("Hi & bye <x> ");
    expect(position(string!.offset)).toEqual({ line: 4, column: 3 });
    expect(plurals!.children[0]).toMatchObject({ type: "element", name: "item" });
  });

  it("reports a closing tag that does not match", () => {
    const broken = '<resources>\n  <string name="a">x</strng>\n</resources>';
    expect(() => parseXml(broken)).toThrow(XmlSyntaxError);
    expect(() => parseXml(broken)).toThrow(expect.objectContaining({ message: "</strng> closes <string>", line: 2, column: 21 }));
  });

  it("reports an element that is never closed at its start", () => {
    expect(() => parseXml('<resources>\n  <string name="a">x\n')).toThrow(expect.objectContaining({ message: "<string> is never closed", line: 2 }));
  });

  it("reports text outside the root element", () => {
    expect(() => parseXml("<resources/>\ntrailing")).toThrow("Content after the root element");
  });
});
