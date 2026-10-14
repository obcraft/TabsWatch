// Injected into the page. Reads the already-loaded DOM: the main article when there is one
// (Readability on a COPY of the document, so the page itself is never changed), otherwise the
// page's visible text.
import { Readability } from "@mozilla/readability";

const ARTICLE_CHARS = 800; // less than this from Readability means it didn't find a real article
const MIN_CHARS = 200; // pages with less text than this aren't worth keeping
const MAX_PAGE_CHARS = 60000; // endless feeds: keep the first screens, not the whole scroll

const clean = (t) => t.replace(/\s+/g, " ").trim();

function pageBlocks() {
  const seen = new Set();
  const blocks = [];
  let used = 0;
  for (const line of (document.body?.innerText || "").split(/\n+/)) {
    const t = clean(line);
    if (t.length <= 30 || seen.has(t)) continue; // menus, buttons and repeated lines
    if (used + t.length > MAX_PAGE_CHARS) break;
    seen.add(t);
    blocks.push(t);
    used += t.length;
  }
  return blocks;
}

function extract() {
  try {
    if (document.querySelector("input[type=password]")) return { ok: false, reason: "login" };
    const art = new Readability(document.cloneNode(true), { charThreshold: 500 }).parse();
    // Split into numbered paragraph blocks (plain text only — never stored as HTML).
    const div = document.createElement("div");
    div.innerHTML = art?.content || "";
    let blocks = [...div.querySelectorAll("p,li,h2,h3,blockquote")]
      .map((e) => clean(e.textContent))
      .filter((t) => t.length > 30);
    const isArticle = blocks.join("").length >= ARTICLE_CHARS;
    if (!isArticle) blocks = pageBlocks();
    const text = blocks.join("\n\n");
    if (text.length < MIN_CHARS) return { ok: false, reason: "too-short" };
    const meta = (n) =>
      document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content || null;
    return {
      ok: true,
      title: (isArticle && art?.title) || document.title || location.hostname,
      byline: (isArticle && art?.byline) || null,
      site: art?.siteName || location.hostname,
      published: (isArticle && art?.publishedTime) || meta("article:published_time"),
      lang: art?.lang || document.documentElement.lang || null,
      excerpt: (isArticle && art?.excerpt) || meta("description") || meta("og:description"),
      blocks,
      text,
    };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

window.__tabsWatchExtract = extract;
