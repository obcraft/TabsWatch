// The sources table on the new tab: every page once, bundled by website and ranked by how often
// you visited it. Pure + local, like the recap.
import { domainOf, host } from "./site.js";

// One entry per page. A page whose text changed is saved again as a new copy; the newest copy is
// shown, and the newest finished copy gives its topics. `visits` maps an address to its record.
export function pagesOf(items, visits = new Map()) {
  const by = new Map();
  for (const a of items) {
    if (!by.has(a.url)) by.set(a.url, { article: a, done: null, copies: 0, first: a.time });
    const p = by.get(a.url);
    p.copies++;
    if (a.time > p.article.time) p.article = a;
    if (a.status === "completed" && a.analysis && !(p.done?.time > a.time)) p.done = a;
    p.first = Math.min(p.first, a.time);
  }
  return [...by.values()]
    .map((p) => {
      const v = visits.get(p.article.url);
      return {
        ...p,
        // Visits are counted when you leave a page; every saved copy stands for at least one.
        visits: Math.max(v?.count || 0, p.copies),
        ms: v?.ms || 0,
        first: Math.min(p.first, v?.first ?? Infinity),
        last: Math.max(p.article.time, v?.last || 0),
      };
    })
    .sort((a, b) => b.last - a.last);
}

const sum = (list, key) => list.reduce((n, x) => n + x[key], 0);

// Pages bundled by website: subdomains are the site, and websites that go by the same name are
// one source (google.com and google.nl as “Google”). The name is the one the site gives itself
// most often (og:site_name or Readability's), else its address.
export function sourcesOf(pages) {
  const by = new Map();
  for (const p of pages) {
    const h = host(p.article.url);
    const d = domainOf(h);
    if (!by.has(d)) by.set(d, { host: d, domains: [d], pages: [], names: {} });
    const s = by.get(d);
    s.pages.push(p);
    const n = (p.article.og?.siteName || p.article.site || "").trim();
    const bare = n.replace(/^www\./, "").toLowerCase();
    if (n && n.length <= 60 && bare !== h && bare !== d) s.names[n] = (s.names[n] || 0) + 1;
  }
  const named = new Map();
  for (const s of [...by.values()].sort((a, b) => b.pages.length - a.pages.length)) {
    const name = Object.entries(s.names).sort((a, b) => b[1] - a[1])[0]?.[0];
    const key = (name || s.host).toLowerCase();
    const same = named.get(key);
    if (same) {
      same.pages.push(...s.pages);
      same.domains.push(s.host);
    } else named.set(key, { ...s, name: name || s.host });
  }
  return [...named.values()]
    .map((s) => {
      const pages = s.pages.sort((a, b) => b.visits - a.visits || b.last - a.last);
      const topics = {};
      for (const p of pages)
        for (const t of p.done?.analysis.topics || []) topics[t] = (topics[t] || 0) + 1;
      return {
        host: s.host,
        domains: s.domains,
        name: s.name,
        pages,
        visits: sum(pages, "visits"),
        ms: sum(pages, "ms"),
        first: Math.min(...pages.map((p) => p.first)),
        last: Math.max(...pages.map((p) => p.last)),
        topics: Object.entries(topics)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t),
      };
    })
    .sort((a, b) => b.visits - a.visits || b.last - a.last);
}

// The filters above the sources table: when you last visited, a topic, and the order.
export const SORTS = {
  visits: (a, b) => b.visits - a.visits || b.last - a.last,
  recent: (a, b) => b.last - a.last,
  time: (a, b) => b.ms - a.ms || b.visits - a.visits,
  pages: (a, b) => b.pages.length - a.pages.length || b.visits - a.visits,
  name: (a, b) => a.name.localeCompare(b.name),
};
export function sinceOf(period, now = Date.now()) {
  if (period === "today") return new Date(now).setHours(0, 0, 0, 0);
  const days = Number(period);
  return days > 0 ? now - days * 864e5 : 0; // "all" or anything unknown: no limit
}
const hasTopic = (s, t) => s.pages.some((p) => p.done?.analysis.topics?.includes(t));
export function filterSources(sources, { period = "all", topic = "", sort = "visits", now } = {}) {
  const since = sinceOf(period, now);
  return sources
    .filter((s) => s.last >= since && (!topic || hasTopic(s, topic)))
    .sort(SORTS[sort] || SORTS.visits);
}
// Every topic of finished pages, by how many sources it appears in.
export function topicsOf(sources) {
  const n = {};
  for (const s of sources)
    for (const t of new Set(s.pages.flatMap((p) => p.done?.analysis.topics || [])))
      n[t] = (n[t] || 0) + 1;
  return Object.entries(n)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}
