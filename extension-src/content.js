// Injected into the page. Reads the already-loaded DOM: the main article when there is one
// (Readability on a COPY of the document, so the page itself is never changed), otherwise the
// page's own visible text without menus, cookie notices and ads.
import { Readability } from "@mozilla/readability";

const ARTICLE_CHARS = 800; // less than this from Readability means it didn't find a real article
const MIN_CHARS = 200; // pages with less text than this aren't worth keeping
const MAX_PAGE_CHARS = 60000; // endless feeds: keep the first screens, not the whole scroll
const MAX_LINK_SHARE = 0.6; // pages that are mostly links (menus, result lists) aren't content

// Page furniture around the content.
const SKIP = [
  "nav,header,footer,aside,form,dialog,menu,template",
  "[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[role=dialog],[role=alert]",
  "[aria-hidden=true],[aria-modal=true]",
  "[class*=cookie],[id*=cookie],[class*=consent],[id*=consent],[class*=gdpr],[id*=gdpr]",
  "[class*=advert],[id*=advert],[class*=sponsor],[class*=newsletter],[class*=paywall],[class*=promo]",
].join(",");
const BLOCKS = "p,li,h1,h2,h3,h4,blockquote,pre,td,dd,figcaption,div";
const NOISE =
  /cookie|consent|accept all|privacy (policy|settings)|subscribe|newsletter|sign (in|up)|log ?in|advertis|all rights reserved/i;

const clean = (t) => t.replace(/\s+/g, " ").trim();

function pageBlocks() {
  const seen = new Set();
  const blocks = [];
  let used = 0;
  let linkChars = 0;
  for (const el of document.body?.querySelectorAll(BLOCKS) || []) {
    // Only the innermost text blocks, outside page furniture, that are actually shown.
    if (el.querySelector(BLOCKS) || el.closest(SKIP) || !el.getClientRects().length) continue;
    const t = clean(el.innerText || "");
    if (t.length <= 30 || seen.has(t) || (t.length < 200 && NOISE.test(t))) continue;
    if (used + t.length > MAX_PAGE_CHARS) break;
    seen.add(t);
    blocks.push(t);
    used += t.length;
    for (const a of el.querySelectorAll("a")) linkChars += clean(a.innerText || "").length;
  }
  return { blocks, linkShare: used ? linkChars / used : 0 };
}

function extract() {
  try {
    if (document.querySelector("input[type=password]")) return { ok: false, reason: "login" };
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav?.responseStatus >= 400) return { ok: false, reason: "error-page" };
    if (document.querySelector("meta[http-equiv=refresh i]"))
      return { ok: false, reason: "redirect" };
    const art = new Readability(document.cloneNode(true), { charThreshold: 500 }).parse();
    // Split into numbered paragraph blocks (plain text only — never stored as HTML).
    const div = document.createElement("div");
    div.innerHTML = art?.content || "";
    let blocks = [...div.querySelectorAll("p,li,h2,h3,blockquote")]
      .map((e) => clean(e.textContent))
      .filter((t) => t.length > 30);
    const isArticle = blocks.join("").length >= ARTICLE_CHARS;
    if (!isArticle) {
      const page = pageBlocks();
      if (page.linkShare > MAX_LINK_SHARE) return { ok: false, reason: "mostly-links" };
      blocks = page.blocks;
    }
    const text = blocks.join("\n\n");
    if (text.length < MIN_CHARS) return { ok: false, reason: "too-short" };
    const meta = (n) =>
      document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content || null;
    // Only a web address is kept for the preview image (no data: or javascript: URLs).
    const image = (() => {
      const src = meta("og:image") || meta("twitter:image");
      if (!src) return null;
      try {
        const u = new URL(src, location.href);
        return /^https?:$/.test(u.protocol) ? u.href : null;
      } catch {
        return null;
      }
    })();
    return {
      ok: true,
      title: (isArticle && art?.title) || document.title || location.hostname,
      byline: (isArticle && art?.byline) || null,
      site: art?.siteName || location.hostname,
      published: (isArticle && art?.publishedTime) || meta("article:published_time"),
      lang: art?.lang || document.documentElement.lang || null,
      excerpt: (isArticle && art?.excerpt) || meta("description") || meta("og:description"),
      canonical: document.querySelector("link[rel=canonical]")?.href || null,
      og: {
        title: meta("og:title"),
        description: meta("og:description"),
        siteName: meta("og:site_name"),
        type: meta("og:type"),
        image,
      },
      blocks,
      text,
    };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

window.__tabsWatchExtract = extract;
