import { describe, it, expect } from "vitest";
// @ts-expect-error plain JS module
import { filterSources, pagesOf, sinceOf, sourcesOf, topicsOf } from "../../extension-src/sources.js";
// @ts-expect-error plain JS module
import { domainOf } from "../../extension-src/site.js";

const day = 864e5;
const now = Date.UTC(2026, 9, 13);
let n = 0;
const art = (url: string, daysAgo: number, extra: Record<string, unknown> = {}) => ({
  id: `a${++n}`, url, title: url, status: "pending", time: now - daysAgo * day, ...extra,
});
const visit = (url: string, count: number, ms = 60_000) => [url, { url, count, ms, first: now - 9 * day, last: now }];

describe("domainOf", () => {
  it("counts subdomains as the website", () => {
    expect(domainOf("m.youtube.com")).toBe("youtube.com");
    expect(domainOf("news.google.com")).toBe("google.com");
    expect(domainOf("nos.nl")).toBe("nos.nl");
  });
  it("keeps country second levels and personal sites on shared hosts apart", () => {
    expect(domainOf("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(domainOf("ann.github.io")).toBe("ann.github.io");
    expect(domainOf("bob.substack.com")).toBe("bob.substack.com");
  });
  it("leaves local hosts and IP addresses alone", () => {
    expect(domainOf("localhost")).toBe("localhost");
    expect(domainOf("192.168.1.10")).toBe("192.168.1.10");
  });
});

describe("pagesOf", () => {
  it("returns nothing for an empty library", () => {
    expect(pagesOf([])).toEqual([]);
  });
  it("shows each page once, from its newest copy", () => {
    const pages = pagesOf([art("https://a.example/x", 1), art("https://a.example/x", 5), art("https://a.example/y", 2)]);
    expect(pages).toHaveLength(2);
    const x = pages.find((p: { article: { url: string } }) => p.article.url === "https://a.example/x");
    expect(x.copies).toBe(2);
    expect(x.article.time).toBe(now - day);
    expect(x.first).toBe(now - 5 * day);
  });
  it("takes counted visits, and never fewer than the saved copies", () => {
    const items = [art("https://a.example/x", 1), art("https://a.example/x", 5), art("https://a.example/y", 2)];
    const pages = pagesOf(items, new Map([visit("https://a.example/x", 7), visit("https://a.example/y", 0)]));
    const by = Object.fromEntries(pages.map((p: { article: { url: string }; visits: number }) => [p.article.url, p.visits]));
    expect(by).toEqual({ "https://a.example/x": 7, "https://a.example/y": 1 });
  });
});

describe("sourcesOf", () => {
  it("returns nothing for no pages", () => {
    expect(sourcesOf([])).toEqual([]);
  });
  it("bundles subdomains and same-named sites into one source, ranked by visits", () => {
    const items = [
      art("https://www.google.com/search?q=a", 1, { og: { siteName: "Google" } }),
      art("https://www.google.nl/search?q=b", 2, { og: { siteName: "Google" } }),
      art("https://news.google.com/story", 3),
      art("https://nos.nl/artikel/1", 0, { site: "NOS" }),
    ];
    const visits = new Map([visit("https://www.google.com/search?q=a", 4), visit("https://nos.nl/artikel/1", 2)]);
    const sources = sourcesOf(pagesOf(items, visits));
    expect(sources.map((s: { name: string }) => s.name)).toEqual(["Google", "NOS"]);
    expect(sources[0].domains.sort()).toEqual(["google.com", "google.nl"]);
    expect(sources[0].pages).toHaveLength(3);
    expect(sources[0].visits).toBe(6); // 4 counted + one per page without a count
  });
  it("breaks a tie in visits by the most recent visit", () => {
    const sources = sourcesOf(pagesOf([art("https://old.example/a", 5), art("https://new.example/a", 1)]));
    expect(sources.map((s: { host: string }) => s.host)).toEqual(["new.example", "old.example"]);
  });
  it("adds up time and lists the most common topics of finished pages", () => {
    const done = (topics: string[]) => ({ status: "completed", analysis: { topics } });
    const items = [
      art("https://a.example/1", 1, done(["ai", "chips"])),
      art("https://a.example/2", 2, done(["ai"])),
      art("https://a.example/3", 3),
    ];
    const visits = new Map([visit("https://a.example/1", 1, 120_000), visit("https://a.example/2", 1, 30_000)]);
    const [s] = sourcesOf(pagesOf(items, visits));
    expect(s.ms).toBe(150_000);
    expect(s.topics).toEqual(["ai", "chips"]);
    expect(s.first).toBe(now - 9 * day);
  });
});
