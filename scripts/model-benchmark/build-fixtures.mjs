// Turns articles-*.txt into articles.json (paragraph blocks, as the extension stores them) and
// into plain HTML pages, so the same text can be benchmarked directly or through the page reader.
// Usage: node scripts/model-benchmark/build-fixtures.mjs [htmlOutDir]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const dir = new URL("./", import.meta.url);
const articles = [];
for (const lang of ["en", "nl"])
  for (const part of readFileSync(new URL(`articles-${lang}.txt`, dir), "utf8")
    .split(/^### /m)
    .slice(1)) {
    const [head, ...lines] = part.trim().split("\n");
    const [id, title] = head.split(" | ");
    const blocks = lines.map((l) => l.trim()).filter(Boolean);
    articles.push({ id, lang, title, blocks, words: blocks.join(" ").split(/\s+/).length });
  }
// Extra-long reads (over the 2,048-token input budget, to exercise chunking): the long, medium and
// short article of a language back to back.
for (const lang of ["en", "nl"]) {
  const parts = ["long", "medium", "short"].map((n) =>
    articles.find((a) => a.id === `${lang}-${n}`),
  );
  const blocks = parts.flatMap((a) => a.blocks);
  articles.push({
    id: `${lang}-xl`,
    lang,
    title: parts[0].title + (lang === "nl" ? " (en meer)" : " (and more)"),
    blocks,
    words: blocks.join(" ").split(/\s+/).length,
  });
}
writeFileSync(new URL("articles.json", dir), JSON.stringify(articles, null, 1) + "\n");
const out = process.argv[2];
if (out) {
  mkdirSync(out, { recursive: true });
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  for (const a of articles)
    writeFileSync(
      `${out}/${a.id}.html`,
      `<!doctype html><html lang="${a.lang}"><head><meta charset="utf-8"><title>${esc(a.title)}</title></head><body><article><h1>${esc(a.title)}</h1>${a.blocks.map((b) => `<p>${esc(b)}</p>`).join("")}</article></body></html>`,
    );
}
for (const a of articles)
  console.log(a.id.padEnd(10), String(a.words).padStart(5), "words", a.blocks.length, "blocks");
