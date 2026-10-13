import * as db from "./db.js";
import { buildRecaps } from "./recap.js";

const $ = (id) => document.getElementById(id);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const day = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) e.append(k);
  return e;
};

let items = [];
let topic = "";
let open = null;

function matches(a, q) {
  if (!q) return true;
  const hay = [a.title, a.site, a.analysis?.summary, ...(a.analysis?.topics || []), ...(a.analysis?.entities || []), a.text].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function filtered() {
  const q = $("q").value.trim();
  const days = Number($("period").value);
  const site = $("site").value;
  const since = days ? Date.now() - days * 864e5 : 0;
  return items.filter((a) => a.time >= since && (!site || host(a.url) === site) && (!topic || a.analysis?.topics?.includes(topic)) && matches(a, q));
}

function summaryText(a) {
  if (a.status === "completed") return a.analysis.summary;
  if (a.status === "failed") return "Analysis not available.";
  return a.status === "processing" ? "Summarising…" : (a.excerpt || a.blocks?.find((b) => b.length > 120) || "").slice(0, 220);
}

function renderTopics() {
  const count = {};
  for (const a of items) for (const t of a.analysis?.topics || []) count[t] = (count[t] || 0) + 1;
  const top = Object.entries(count).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 24);
  $("topics").replaceChildren(...(top.length ? top.map(([t, n]) => {
    const c = el("button", { className: "chip" + (t === topic ? " on" : "") }, t, el("small", { textContent: n }));
    c.onclick = () => { topic = topic === t ? "" : t; render(); };
    return c;
  }) : [el("span", { className: "muted", textContent: "Topics appear once articles are summarised." })]));
}

function renderRecaps() {
  const recaps = buildRecaps(items);
  $("recapWrap").hidden = !recaps.length;
  const src = (p) => {
    const a = el("a", { textContent: `${p.article.title} · ${host(p.article.url)}${p.quote ? ` — “${p.quote}”` : ""}` });
    a.onclick = () => show(p.article);
    return a;
  };
  $("recaps").replaceChildren(...recaps.map((r) => el("div", { className: "rc" },
    el("h3", { textContent: r.topic }),
    el("div", { className: "m", textContent: `${r.articles.length} articles opened · last ${day(r.latest)}` }),
    el("h5", { textContent: "This is the core" }),
    ...r.core.map((p) => el("div", { className: "rp" }, p.point + (p.sources > 1 ? ` (in ${p.sources} sources)` : ""), src(p))),
    r.adds.length ? el("h5", { textContent: "This adds something" }) : null,
    ...r.adds.map((p) => el("div", { className: "rp alt" }, p.point, src(p))),
    r.earlier ? el("h5", { textContent: "Connects to earlier" }) : null,
    r.earlier ? el("div", { className: "rp alt" }, `You read about ${r.topic} before, on ${day(r.earlier.time)}.`, src({ article: r.earlier })) : null)));
}

function render() {
  const sites = [...new Set(items.map((a) => host(a.url)))].sort();
  const cur = $("site").value;
  $("site").replaceChildren(el("option", { value: "", textContent: "All sites" }), ...sites.map((s) => el("option", { value: s, textContent: s })));
  $("site").value = sites.includes(cur) ? cur : "";
  renderRecaps();
  renderTopics();
  const list = filtered();
  $("listTitle").textContent = topic ? `Related articles · ${topic}` : $("q").value ? `Results (${list.length})` : "Recently viewed";
  if (!list.length) {
    $("grid").replaceChildren(items.length
      ? el("div", { className: "empty", style: "grid-column:1/-1" }, el("b", { textContent: "Nothing matches" }), "Try another search.")
      : el("div", { className: "hero", style: "grid-column:1/-1" },
          el("h3", { textContent: "Your reading, in one calm place." }),
          el("p", { textContent: "Just browse. Articles you read for a few seconds appear here, summarised on this computer. Nothing leaves your device." }),
          el("div", { className: "steps" },
            el("div", {}, el("b", { textContent: "1 · Read" }), el("span", { textContent: "Open articles as you normally would." })),
            el("div", {}, el("b", { textContent: "2 · Summarised offline" }), el("span", { textContent: "The local model works through them one by one." })),
            el("div", {}, el("b", { textContent: "3 · Recap" }), el("span", { textContent: "The core per topic shows up on every new tab." })))));
    return;
  }
  $("grid").replaceChildren(...list.map((a) => {
    const c = el("button", { className: "card" },
      el("div", { className: "t", textContent: a.title }),
      el("div", { className: "m", textContent: `${host(a.url)} · opened ${day(a.time)}` }),
      el("div", { className: "s", textContent: summaryText(a) }),
      el("div", { className: "tags" }, ...(a.analysis?.topics || []).slice(0, 4).map((t) => el("span", { textContent: t }))));
    c.onclick = () => show(a);
    return c;
  }));
}

function show(a) {
  open = a;
  $("detail").hidden = false;
  document.body.classList.add("locked");
  const an = a.analysis;
  const src = el("div", { className: "src" }, ...a.blocks.map((t, i) => el("p", { id: `b${i + 1}` }, el("b", { textContent: i + 1 }), t)));
  const left = el("div", {},
    el("h3", { textContent: a.title }),
    el("div", { className: "m", textContent: `${a.site || host(a.url)}${a.byline ? " · " + a.byline : ""} · opened ${new Date(a.time).toLocaleString()}${a.published ? " · published " + day(a.published) : ""}` }),
    el("h4", { textContent: "Summary" }),
    el("p", { textContent: an ? an.summary : summaryText(a) }),
    an ? el("h4", { textContent: "Key points" }) : null,
    ...(an?.points || []).map((p) => {
      const q = p.quote ? el("q", { textContent: `${p.quote} — block ${p.block}` }) : el("q", { textContent: "Source not verified" });
      if (p.block) q.onclick = () => {
        document.querySelectorAll(".src p.hl").forEach((x) => x.classList.remove("hl"));
        const b = $(`b${p.block}`); b.classList.add("hl"); b.scrollIntoView({ block: "center", behavior: "smooth" });
      };
      return el("div", { className: "pt" }, p.point, q);
    }),
    an?.entities?.length ? el("h4", { textContent: "Mentioned" }) : null,
    an?.entities?.length ? el("div", { className: "tags" }, ...an.entities.map((t) => el("span", { textContent: t }))) : null,
    el("h4", { textContent: "About this source" }),
    el("div", { className: "muted", textContent: `${an?.coverage === "partial" ? "Summary based on the first part of the article" : "Full article text"} · read from page text · version ${a.version}${a.modelId ? " · " + a.modelId : ""}` }));
  $("dbody").replaceChildren(left, el("div", {}, el("h4", { textContent: "Saved article text", style: "margin-top:0" }), src));
}

function closeDetail() { open = null; $("detail").hidden = true; document.body.classList.remove("locked"); }

async function renderModel() {
  const { model = {}, settings = {} } = await chrome.storage.local.get(["model", "settings"]);
  const on = settings.enabled !== false && settings.knowledge !== false;
  $("dot").classList.toggle("on", on);
  const pending = items.filter((a) => a.status === "pending" || a.status === "processing").length;
  $("stat").textContent = (on ? "Saving articles" : "Paused") + (model.working ? ` · Summarising “${model.working.slice(0, 40)}” · ${model.waiting} waiting` : pending && model.installed ? ` · ${pending} in queue` : "");
  const show = !model.installed || model.state === "downloading" || model.state === "error";
  $("setup").hidden = !show;
  if (model.state === "downloading") {
    $("bar").hidden = false;
    const pct = model.total ? Math.round((model.loaded / model.total) * 100) : 0;
    $("barFill").style.width = pct + "%";
    $("setupText").textContent = `Downloading… ${(model.loaded / 1e9 || 0).toFixed(2)} of ${(model.total / 1e9 || 0).toFixed(2)} GB (${pct}%). You can keep browsing.`;
    $("install").hidden = true;
  } else if (model.state === "error") {
    $("bar").hidden = true;
    $("setupText").textContent = `The model couldn't start: ${model.error}`;
    $("install").hidden = false;
    $("install").textContent = "Try again";
  }
}

async function load() {
  items = await db.all();
  if (open) open = items.find((a) => a.id === open.id) || null;
  render();
  renderModel();
  if (open) show(open);
}

$("install").onclick = () => { $("install").hidden = true; chrome.runtime.sendMessage({ type: "installModel" }); };
$("q").oninput = render;
$("period").onchange = render;
$("site").onchange = render;
$("back").onclick = closeDetail;
$("orig").onclick = () => open && chrome.tabs.create({ url: open.url });
$("del").onclick = async () => { if (open && confirm("Delete this article and its summary?")) { await db.del(open.id); closeDetail(); load(); } };
$("retry").onclick = async () => {
  if (!open) return;
  await db.put({ ...open, status: "pending", analysis: null, error: null });
  chrome.runtime.sendMessage({ type: "processQueue" });
  load();
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

chrome.storage.onChanged.addListener(renderModel);
setInterval(load, 4000); // pick up new captures/summaries (no AI runs on opening a tab)
load();
