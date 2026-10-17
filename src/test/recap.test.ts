import { describe, it, expect } from "vitest";
// @ts-expect-error plain JS module
import { buildRecaps } from "../../extension-src/recap.js";

const now = Date.UTC(2026, 9, 13);
const art = (id: string, daysAgo: number, points: string[], topics = ["laptops"], url = `https://${id}.example/page`) => ({
  id, url, title: id, status: "completed", time: now - daysAgo * 864e5,
  analysis: { summary: `${id} summary`, topics, points: points.map((point) => ({ point, block: 1, quote: "q" })) },
});

describe("topic recap", () => {
  it("returns nothing for an empty library", () => {
    expect(buildRecaps([], { now })).toEqual([]);
  });
  it("treats an article exactly 14 days old as recent", () => {
    expect(buildRecaps([art("a", 14, ["one"]), art("b", 1, ["two"])], { now })[0].articles).toHaveLength(2);
  });
  it("needs at least two recent articles on a topic", () => {
    expect(buildRecaps([art("a", 1, ["x"])], { now })).toHaveLength(0);
  });
  it("puts repeated points in the core once and unique ones in adds", () => {
    const r = buildRecaps([
      art("a", 1, ["Battery lasts twelve hours under testing", "Ports limited to USB-C only"]),
      art("b", 2, ["Battery lasts twelve hours during testing"]),
    ], { now })[0];
    expect(r.core).toHaveLength(1);
    expect(r.core[0].sources).toBe(2);
    expect(r.adds.map((p: { point: string }) => p.point)).toEqual(["Ports limited to USB-C only"]);
  });
  it("counts an older copy of the same page once, not as another source", () => {
    const url = "https://news.example/story";
    const point = "Battery lasts twelve hours under testing";
    const recaps = buildRecaps([
      art("a2", 1, [point], undefined, url),
      art("a1", 3, [point], undefined, url),
      art("b", 2, ["Ports limited to USB-C only"]),
    ], { now });
    expect(recaps[0].articles.map((a: { id: string }) => a.id)).toEqual(["a2", "b"]);
    expect(recaps[0].core.every((p: { sources: number }) => p.sources === 1)).toBe(true);
  });
  it("counts two pages of one website as one source", () => {
    const r = buildRecaps([
      art("a", 1, ["Battery lasts twelve hours under testing"], undefined, "https://www.site.example/a"),
      art("b", 2, ["Battery lasts twelve hours during testing"], undefined, "https://m.site.example/b"),
    ], { now })[0];
    expect(r.articles).toHaveLength(2);
    expect(r.core[0].sources).toBe(1);
  });
  it("links an article older than 14 days as earlier", () => {
    const r = buildRecaps([art("a", 1, ["one"]), art("b", 2, ["two"]), art("old", 30, ["three"])], { now })[0];
    expect(r.earlier.id).toBe("old");
    expect(r.articles).toHaveLength(2);
  });
});
