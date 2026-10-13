import { describe, it, expect } from "vitest";
// @ts-expect-error plain JS module
import { buildRecaps } from "../../extension-src/recap.js";

const now = Date.UTC(2026, 9, 13);
const art = (id: string, daysAgo: number, points: string[], topics = ["laptops"]) => ({
  id, title: id, status: "completed", time: now - daysAgo * 864e5,
  analysis: { summary: `${id} summary`, topics, points: points.map((point) => ({ point, block: 1, quote: "q" })) },
});

describe("topic recap", () => {
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
  it("links an article older than 14 days as earlier", () => {
    const r = buildRecaps([art("a", 1, ["one"]), art("b", 2, ["two"]), art("old", 30, ["three"])], { now })[0];
    expect(r.earlier.id).toBe("old");
    expect(r.articles).toHaveLength(2);
  });
});
