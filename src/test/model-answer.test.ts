import { describe, it, expect } from "vitest";
// @ts-expect-error plain JS module
import { firstJsonObject, closestBlock } from "../../extension-src/answer.js";

const parse = (raw: string) => JSON.parse(firstJsonObject(raw));

describe("firstJsonObject", () => {
  it("returns a complete answer, ignoring text around it", () => {
    expect(parse('Here you go:\n```json\n{"summary": "S", "points": []}\n```')).toEqual({
      summary: "S",
      points: [],
    });
  });

  it("keeps the summary and finished points of an answer cut off mid-point", () => {
    const raw =
      '{\n  "summary": "Cities add bike lanes.",\n  "points": [\n    {"point": "Paris added 1,000 km", "block": 2, "quote": "1,000 kilometres"},\n    {"point": "Utrecht built a garage", "block": 3, "quo';
    expect(parse(raw)).toEqual({
      summary: "Cities add bike lanes.",
      points: [{ point: "Paris added 1,000 km", block: 2, quote: "1,000 kilometres" }],
    });
  });

  it("keeps finished lists when the cut falls in a later list", () => {
    const raw = '{"summary": "S", "points": [], "topics": ["cycling", "cities"], "entities": ["Par';
    expect(parse(raw)).toEqual({ summary: "S", points: [], topics: ["cycling", "cities"] });
  });

  it("isn't fooled by brackets and escaped quotes inside strings", () => {
    const raw =
      '{"summary": "A \\"quoted\\" [bracket] {brace}", "points": [{"point": "p"}], "topics": ["x';
    expect(parse(raw)).toEqual({
      summary: 'A "quoted" [bracket] {brace}',
      points: [{ point: "p" }],
    });
  });

  it("keeps the finished items of a list that was cut off", () => {
    const raw = '{"summary": "S", "keyPoints": ["one.", "two.", "thr';
    expect(parse(raw)).toEqual({ summary: "S", keyPoints: ["one.", "two."] });
  });

  it("closes a list the model forgot to close", () => {
    const raw = '{\n"summary": "S",\n"keyPoints": [\n"one.",\n"two."\n}';
    expect(parse(raw)).toEqual({ summary: "S", keyPoints: ["one.", "two."] });
  });

  it("drops trailing commas and brackets that close nothing", () => {
    expect(parse('{"summary": "S", "topics": ["a", "b",], }]')).toEqual({
      summary: "S",
      topics: ["a", "b"],
    });
  });

  it("returns null when there is nothing to keep", () => {
    expect(firstJsonObject("no json here")).toBeNull();
    expect(firstJsonObject('{"summary": "cut off before any')).toBeNull();
  });
});

describe("closestBlock", () => {
  const blocks = [
    "Over the past decade, a growing number of European cities have redesigned their main streets.",
    "Paris added more than 1,000 kilometres of cycle routes between 2019 and 2024.",
    "Engineers in Copenhagen argue separated tracks attract riders who would never cycle next to traffic.",
  ];

  it("finds the paragraph a paraphrased point comes from", () => {
    expect(
      closestBlock(
        "Paris added over 1,000 kilometres of cycle routes between 2019 and 2024.",
        blocks,
      ),
    ).toBe(1);
    expect(
      closestBlock("Copenhagen says separated tracks attract riders who avoid traffic.", blocks),
    ).toBe(2);
  });

  it("gives up when no paragraph shares at least half the words", () => {
    expect(closestBlock("Rome banned scooters from its historic centre.", blocks)).toBe(-1);
    expect(closestBlock("", blocks)).toBe(-1);
  });
});
