// Injected into the page. Extracts only the main article from the already-loaded DOM,
// using Readability on a COPY of the document so the page itself is never changed.
import { Readability, isProbablyReaderable } from "@mozilla/readability";

const MIN_CHARS = 800;

function extract() {
  try {
    if (!isProbablyReaderable(document)) return { ok: false, reason: "no-article" };
    if (document.querySelector("input[type=password]")) return { ok: false, reason: "login" };
    const clone = document.cloneNode(true);
    const art = new Readability(clone, { charThreshold: 500 }).parse();
    if (!art || !art.textContent) return { ok: false, reason: "no-article" };
    // Split into numbered paragraph blocks (plain text only — never stored as HTML).
    const div = document.createElement("div");
    div.innerHTML = art.content || "";
    const blocks = [...div.querySelectorAll("p,li,h2,h3,blockquote")]
      .map((e) => e.textContent.replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 30);
    const text = blocks.join("\n\n");
    if (text.length < MIN_CHARS) return { ok: false, reason: "too-short" };
    const meta = (n) => document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content || null;
    return {
      ok: true,
      title: art.title || document.title,
      byline: art.byline || null,
      site: art.siteName || location.hostname,
      published: art.publishedTime || meta("article:published_time"),
      lang: art.lang || document.documentElement.lang || null,
      excerpt: art.excerpt || null,
      blocks,
      text,
    };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

window.__tabsWatchExtract = extract;
