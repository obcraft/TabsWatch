// Builds the per-topic recap shown on the new tab. Pure + local: reuses saved analyses, no model calls.
const words = (s) => new Set(String(s).toLowerCase().match(/\p{L}{4,}/gu) || []);
export function similar(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}
const SAME = 0.35;

export function buildRecaps(items, { now = Date.now(), windowDays = 14, max = 6 } = {}) {
  const since = now - windowDays * 864e5;
  const done = items.filter((a) => a.status === "completed" && a.analysis);
  const groups = {};
  for (const a of done) for (const t of a.analysis.topics || []) (groups[t] ||= []).push(a);
  const recaps = [];
  for (const [topic, all] of Object.entries(groups)) {
    const recent = all.filter((a) => a.time >= since).sort((a, b) => b.time - a.time);
    if (recent.length < 2) continue;
    const pts = recent.flatMap((a) => (a.analysis.points || []).map((p) => ({ ...p, article: a })));
    const others = (p) => pts.filter((q) => q.article.id !== p.article.id);
    const core = [], adds = [];
    for (const p of pts) {
      const echoes = others(p).filter((q) => similar(p.point, q.point) >= SAME);
      if (echoes.length) {
        if (!core.some((c) => similar(c.point, p.point) >= SAME)) core.push({ ...p, sources: 1 + new Set(echoes.map((e) => e.article.id)).size });
      } else adds.push(p);
    }
    if (!core.length && recent[0].analysis.summary) core.push({ point: recent[0].analysis.summary, article: recent[0], sources: 1 });
    const earlier = all.filter((a) => a.time < since).sort((a, b) => b.time - a.time)[0] || null;
    recaps.push({ topic, articles: recent, core: core.slice(0, 3), adds: adds.slice(0, 2), earlier, latest: recent[0].time });
  }
  return recaps.sort((a, b) => b.latest - a.latest).slice(0, max);
}
