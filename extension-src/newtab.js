import * as db from "./db.js";
import { buildRecaps } from "./recap.js";
import { domainOf, host, hue, siteIcon } from "./site.js";
import { pagesOf, sourcesOf } from "./sources.js";
import { initTheme, normalizeTheme } from "./theme.js";
import { pageKey } from "./url.js";

const $ = (id) => document.getElementById(id);
const day = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
const stamp = (t) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null && k !== false) e.append(k);
  return e;
};
const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;
const kb = (n) =>
  n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dur(ms) {
  const min = Math.round(ms / 6e4);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}
const icon = (paths, size = 34) => {
  const t = document.createElement("template");
  t.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return t.content.firstChild;
};
const BOOK =
  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>';
const PAGE =
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>';
const CHECK = '<path d="M5 12.5l4.5 4.5L19 7"/>';
const CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';

function ago(t) {
  const min = Math.round((Date.now() - t) / 6e4);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (sameDay(t, Date.now())) return `${Math.round(min / 60)} h ago`;
  if (sameDay(t, Date.now() - 864e5)) return "Yesterday";
  return day(t);
}

function seg(box, value, pick) {
  for (const b of box.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.v === String(value)));
    b.onclick = () => pick(b.dataset.v);
  }
}

let items = []; // every saved copy, newest first
let visits = new Map(); // page address → { count, ms, first, last }
let pages = []; // each page once (see sources.js)
let captures = [];
let groups = [];
let model = {};
let prefs = { name: "", showRecap: true };
let lib = "sources";
let source = null; // the website whose links are shown, or null for all sources
let lastSig = "";
let openArticle = null;
let openPage = null;
let pageMode = "page";
let pageUrl = null;

// The address bar keeps the view (#saved, #source=example.org), so Back returns to it.
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  lib = h === "saved" ? "saved" : "sources";
  source = h.startsWith("source=") ? h.slice(7) : null;
}
function go(hash) {
  history.pushState(null, "", hash ? `#${hash}` : location.pathname);
  readHash();
  render();
  if ($("library").getBoundingClientRect().top < 0) $("library").scrollIntoView();
}

const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
function matches(a, q) {
  const hay = [
    a.title,
    a.site,
    a.url,
    a.og?.description,
    a.analysis?.summary,
    ...(a.analysis?.topics || []),
    ...(a.analysis?.entities || []),
    a.text,
  ]
    .join(" ")
    .toLowerCase();
  return words(q).every((w) => hay.includes(w));
}

// The source of a page, or of an address from #source= (a site merged into another still finds it).
const sourceOf = (domain) => groups.find((s) => s.domains.includes(domain));
const sourceName = (url) => sourceOf(domainOf(host(url)))?.name || host(url);

function state(a) {
  if (a.status === "completed") return { cls: "ready", text: "Summary ready" };
  if (a.status === "processing") return { cls: "working", text: "Summarising…" };
  if (a.status === "failed") return { cls: "failed", text: "No summary" };
  if (a.nextTryAt > Date.now()) return { cls: "waiting", text: "Trying again soon" };
  return { cls: "waiting", text: model.installed ? "In queue" : "Waiting for model" };
}

// One plain paragraph about the page: the on-device summary, else the page's own description.
const flat = (t) =>
  String(t || "")
    .replace(/\s*\n+\s*(?:[-•*·]\s+|\d+[.)]\s+)?/g, " ")
    .trim();
function clip(t, n = 320) {
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = cut.lastIndexOf(". ");
  return end > n / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}
function summaryText(a) {
  if (a.status === "completed" && a.analysis?.summary) return flat(a.analysis.summary);
  return clip(flat(a.og?.description || a.excerpt || a.blocks?.find((b) => b.length > 120) || ""));
}

const empty = (paths, title, text) =>
  el(
    "div",
    { className: "empty" },
    paths && icon(paths, 28),
    el("b", { textContent: title }),
    el("span", { textContent: text }),
  );

function heading(title, sub, { back = false, tabs = true, fav = null } = {}) {
  $("libTitle").replaceChildren(...[fav, el("span", { textContent: title })].filter(Boolean));
  $("libSub").textContent = sub || "";
  $("back").hidden = !back;
  $("libTabs").hidden = !tabs;
}

function renderHero() {
  const name = prefs.name.trim();
  $("greeting").textContent = `Welcome back${name ? ", " + name : ""}.`;
  const today = pages.filter((p) => sameDay(p.last, Date.now())).length;
  $("subtitle").textContent = !pages.length
    ? "Read something worth keeping. It will show up right here."
    : [
        plural(pages.length, "link"),
        `from ${plural(groups.length, "source")}`,
        today && `· ${today} today`,
      ]
        .filter(Boolean)
        .join(" ");
}

function renderRecaps() {
  const recaps = prefs.showRecap ? buildRecaps(items) : [];
  // Above the library, so switching its tabs keeps the topics in place; a source or search hides them.
  $("recapWrap").hidden = !recaps.length || !!source || !!$("q").value.trim();
  $("recaps").replaceChildren(
    ...recaps.map((r) => {
      const t = el(
        "button",
        { className: "tile topic-tile" },
        el(
          "div",
          { className: "src-line" },
          el("span", { className: "topic-mark" }),
          el("span", { textContent: plural(r.articles.length, "article") }),
          el("time", { textContent: `last ${day(r.latest)}` }),
        ),
        el("div", { className: "tile-title", textContent: r.topic }),
        r.core[0] && el("p", { className: "tile-sum", textContent: r.core[0].point }),
        el(
          "div",
          { className: "tile-foot" },
          el("span", { className: "more", textContent: "Open recap" }),
        ),
      );
      t.style.setProperty("--h", hue(r.topic));
      t.onclick = () => showRecap(r);
      return t;
    }),
  );
}

// Sources as one table, most visited first. The whole row opens the source; the name is the
// button, so the table works from the keyboard too.
const COLS = [
  ["#", "rank"],
  ["Source", "c-source"],
  ["Visits", "num c-visits"],
  ["Pages", "num c-pages"],
  ["Time", "num c-time"],
  ["Topics", "c-topics"],
  ["First seen", "c-first"],
  ["Last visit", "c-last"],
];
function sourceTable(list) {
  const top = Math.max(1, ...list.map((s) => s.visits));
  return el(
    "div",
    { className: "table-wrap" },
    el(
      "table",
      { className: "sources-table" },
      el(
        "thead",
        {},
        el("tr", {}, ...COLS.map(([t, c]) => el("th", { scope: "col", className: c, textContent: t }))),
      ),
      el("tbody", {}, ...list.map((s, i) => sourceRow(s, i + 1, top))),
    ),
  );
}

function sourceRow(s, rank, top) {
  const also = s.domains.length > 1 ? ` +${s.domains.length - 1}` : "";
  const tr = el(
    "tr",
    {},
    el("td", { className: "rank", textContent: rank }),
    el(
      "td",
      { className: "c-source" },
      el(
        "button",
        { className: "source-btn", title: s.domains.join(", ") },
        siteIcon(s.pages[0].article.url),
        el(
          "span",
          { className: "grow" },
          el("span", { className: "source-name", textContent: s.name }),
          el("span", { className: "source-meta", textContent: s.host + also }),
        ),
      ),
    ),
    el(
      "td",
      { className: "num c-visits" },
      el(
        "span",
        { className: "visits" },
        el("b", { textContent: s.visits }),
        el("span", { className: "meter" }, el("i", { style: `width:${(s.visits / top) * 100}%` })),
      ),
    ),
    el("td", { className: "num c-pages", textContent: s.pages.length }),
    el("td", { className: "num c-time", textContent: s.ms ? dur(s.ms) : "–" }),
    el(
      "td",
      { className: "c-topics" },
      s.topics.length
        ? el("span", { className: "labels" }, ...s.topics.map((t) => el("span", { textContent: t })))
        : "–",
    ),
    el("td", { className: "c-first" }, el("time", { textContent: day(s.first) })),
    el("td", { className: "c-last" }, el("time", { textContent: ago(s.last) })),
  );
  tr.onclick = () => go(`source=${s.host}`);
  return tr;
}

function linkRow(p, withIcon) {
  const a = p.article;
  const s = state(a);
  const b = el(
    "button",
    { className: "link" },
    withIcon && siteIcon(a.url),
    el(
      "span",
      { className: "link-main" },
      el("span", { className: "link-title", textContent: a.title }),
      el("span", { className: "link-sum", textContent: summaryText(a) || host(a.url) }),
    ),
    el(
      "span",
      { className: "link-side" },
      s.cls !== "ready" && el("span", { className: `state ${s.cls}`, textContent: s.text }),
      el("span", { className: "visit-n", textContent: plural(p.visits, "visit") }),
      el("time", { textContent: ago(p.last) }),
    ),
  );
  b.onclick = () => showArticle(a);
  return b;
}

function renderLibrary() {
  const q = $("q").value.trim();
  const body = $("libBody");
  const s = source && sourceOf(source);
  seg($("libTabs"), lib, (v) => go(v === "saved" ? "saved" : ""));
  $("nSources").textContent = groups.length || "";
  $("nSaved").textContent = captures.filter((c) => c.html).length || "";
  if (lib === "saved") return renderSaved(q);
  if (q) {
    const list = pages.filter((p) => matches(p.article, q));
    heading("Results", `${plural(list.length, "match", "matches")} for “${q}”`, { back: !!s });
    return body.replaceChildren(
      list.length
        ? el("div", { className: "links" }, ...list.map((p) => linkRow(p, true)))
        : empty(null, "No matches.", "Try another word."),
    );
  }
  if (s) {
    heading(
      s.name,
      [plural(s.pages.length, "link"), plural(s.visits, "visit"), s.domains.join(", ")].join(" · "),
      { back: true, tabs: false, fav: siteIcon(s.pages[0].article.url) },
    );
    return body.replaceChildren(
      el("div", { className: "links" }, ...s.pages.map((p) => linkRow(p, false))),
    );
  }
  heading("Sources", groups.length ? "Every website you read, most visited first" : "");
  body.replaceChildren(
    groups.length
      ? sourceTable(groups)
      : empty(
          BOOK,
          "No sources yet.",
          "Spend a few seconds on any page and it shows up here, grouped by website.",
        ),
  );
}

function renderSaved(q) {
  const pages = captures.filter((c) => c.html);
  const list = pages.filter(
    (c) => !q || words(q).every((w) => `${c.title} ${c.url}`.toLowerCase().includes(w)),
  );
  heading(
    "Saved pages",
    q ? `${plural(list.length, "match", "matches")} for “${q}”` : "Full copies you chose to keep",
  );
  if (!pages.length)
    return $("libBody").replaceChildren(
      empty(
        PAGE,
        "No saved pages yet.",
        "Click “Save page HTML” in the Tabs Watch popup to keep a full copy of any page.",
      ),
    );
  if (!list.length)
    return $("libBody").replaceChildren(empty(null, "No matches.", "Try another word."));
  $("libBody").replaceChildren(
    el(
      "div",
      { className: "links" },
      ...list.map((c) => {
        const b = el(
          "button",
          { className: "link" },
          siteIcon(c.url),
          el(
            "span",
            { className: "link-main" },
            el("span", { className: "link-title", textContent: c.title }),
            el("span", {
              className: "link-sum",
              textContent: [host(c.url), kb(c.size || c.html.length), c.truncated && "cut off"]
                .filter(Boolean)
                .join(" · "),
            }),
          ),
          el("span", { className: "link-side" }, el("time", { textContent: ago(c.time) })),
        );
        b.onclick = () => showPage(c);
        return b;
      }),
    ),
  );
}

function render() {
  pages = pagesOf(items, visits);
  groups = sourcesOf(pages);
  renderHero();
  renderLibrary();
  renderRecaps();
}

/* Link sheet: one short paragraph about the page, its preview image and details */

function showArticle(a) {
  openArticle = a;
  drawArticle();
  $("aScroll").scrollTop = 0;
  if (!$("articleDlg").open) $("articleDlg").showModal();
}

function drawArticle() {
  const a = openArticle;
  if (!a) return;
  $("aSite").replaceChildren(siteIcon(a.url), el("span", { textContent: sourceName(a.url) }));
  // The preview image comes from the website itself, so it only shows once it has loaded.
  const img = $("aImg");
  const src = a.og?.image || "";
  if (img.dataset.src !== src) {
    img.dataset.src = src;
    img.hidden = true;
    img.onload = () => (img.hidden = img.dataset.src !== src);
    if (src) img.src = src;
    else img.removeAttribute("src");
  }
  $("aTitle").textContent = a.title;
  $("aMeta").textContent = [a.byline, `Read ${ago(a.time).toLowerCase()}`]
    .filter(Boolean)
    .join(" · ");
  const u = new URL(a.url);
  $("aAddr").textContent = (u.hostname + u.pathname).replace(/^www\./, "").replace(/\/$/, "");
  const saved = captureFor(a);
  $("aSaved").hidden = !saved;
  $("aSaved").onclick = () => {
    $("articleDlg").close();
    showPage(saved);
  };
  $("aContent").replaceChildren(...articleBody(a));
}

function articleBody(a) {
  const text = summaryText(a);
  const og = a.og || {};
  const desc = flat(og.description);
  const published = a.published && !isNaN(new Date(a.published)) ? day(a.published) : null;
  const facts = [
    ["Site", og.siteName || sourceName(a.url)],
    ["Type", og.type && og.type[0].toUpperCase() + og.type.slice(1)],
    ["Preview title", og.title && og.title !== a.title && og.title],
    ["Published", published],
    ["Read", stamp(a.time)],
  ].filter(([, v]) => v);
  return [
    text && el("p", { className: "lead", textContent: text }),
    a.status !== "completed" && status(a),
    desc && desc !== text && el("h4", { textContent: "From the page" }),
    desc && desc !== text && el("p", { className: "og-desc", textContent: clip(desc, 400) }),
    el("h4", { textContent: "Details" }),
    el(
      "dl",
      { className: "facts" },
      ...facts.map(([k, v]) =>
        el("div", {}, el("dt", { textContent: k }), el("dd", { textContent: v })),
      ),
    ),
  ].filter(Boolean);
}

// While a page waits for its summary the paragraph is the page's own description; say so.
function status(a) {
  const why =
    a.status === "failed"
      ? "The on-device model couldn’t summarise this page, so this is its own description."
      : a.status === "processing"
        ? "The on-device model is reading this page right now."
        : model.installed
          ? "This page is in line for a summary."
          : "Download the on-device model in Settings to get summaries.";
  return el(
    "div",
    { className: "a-status" },
    el("span", { className: `state ${state(a).cls}`, textContent: state(a).text }),
    el("span", { textContent: why }),
    inQueue(a) && model.installed && liveBar(a),
  );
}

/* Recap sheet */

function showRecap(r) {
  const src = (p) => {
    const b = el("button", {
      className: "quote",
      textContent: `${p.article.title} · ${host(p.article.url)}${p.quote ? ` — “${p.quote}”` : ""}`,
    });
    b.onclick = () => {
      $("recapDlg").close();
      showArticle(p.article);
    };
    return b;
  };
  const item = (p, extra = "") => el("li", {}, el("p", { textContent: p.point + extra }), src(p));
  $("rBody").replaceChildren(
    ...[
      el(
        "div",
        { className: "a-head" },
        el(
          "div",
          { className: "src-line" },
          el("span", { className: "topic-mark", style: `--h:${hue(r.topic)}` }),
          el("span", {
            textContent: `${plural(r.articles.length, "article")} · last opened ${day(r.latest)}`,
          }),
        ),
        el("h3", { id: "rTitle", textContent: r.topic }),
      ),
      el("h4", { textContent: "This is the core" }),
      el(
        "ol",
        { className: "points" },
        ...r.core.map((p) => item(p, p.sources > 1 ? ` (in ${p.sources} sources)` : "")),
      ),
      r.adds.length && el("h4", { textContent: "This adds something" }),
      r.adds.length && el("ol", { className: "points alt" }, ...r.adds.map((p) => item(p))),
      r.earlier && el("h4", { textContent: "Connects to earlier" }),
      r.earlier &&
        el(
          "ol",
          { className: "points alt" },
          item({
            point: `You read about ${r.topic} before, on ${day(r.earlier.time)}.`,
            article: r.earlier,
          }),
        ),
    ].filter(Boolean),
  );
  $("rBody").scrollTop = 0;
  $("recapDlg").showModal();
}

/* Saved page sheet */

// The library copy of a saved page (same address), which carries its summary, and back.
const articleFor = (c) => items.find((a) => a.url === pageKey(c.url));
const captureFor = (a) => captures.find((c) => c.html && pageKey(c.url) === a.url);

function showPage(c) {
  openPage = c;
  pageMode = "page";
  const a = articleFor(c);
  $("pSummary").hidden = !a;
  $("pSummary").onclick = () => {
    $("pageDlg").close();
    showArticle(a);
  };
  $("pSite").replaceChildren(siteIcon(c.url), el("span", { textContent: sourceName(c.url) }));
  $("pTitle").textContent = c.title;
  $("pMeta").textContent = [
    `Saved ${stamp(c.time)}`,
    kb(c.size || c.html.length),
    c.elements && `${c.elements} elements`,
    c.truncated && "cut off",
  ]
    .filter(Boolean)
    .join(" · ");
  if (pageUrl) URL.revokeObjectURL(pageUrl);
  pageUrl = URL.createObjectURL(new Blob([c.html], { type: "text/html" }));
  Object.assign($("pDownload"), { href: pageUrl, download: `${host(c.url)}-${c.id}.html` });
  drawPage();
  $("pageDlg").showModal();
}

function drawPage() {
  const c = openPage;
  if (!c) return;
  seg($("pTabs"), pageMode, (v) => {
    pageMode = v;
    drawPage();
  });
  if (pageMode === "page") {
    // Saved HTML is rendered in a sandboxed frame: no scripts run.
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "");
    f.title = c.title;
    f.srcdoc = c.html;
    $("pBody").replaceChildren(f);
  } else
    $("pBody").replaceChildren(
      el("pre", { textContent: pageMode === "html" ? c.html : c.text || "" }),
    );
}

/* Confirm alert */

function confirmBox(title, text, ok = "Delete") {
  const d = $("confirmDlg");
  $("cTitle").textContent = title;
  $("cText").textContent = text;
  $("cOk").textContent = ok;
  d.showModal();
  // Resolve on the button press itself: Chrome defers a dialog's "close" event while the tab is hidden.
  return new Promise((res) => {
    const form = d.querySelector("form");
    const done = (ok) => {
      form.removeEventListener("submit", submit);
      d.removeEventListener("cancel", cancel);
      res(ok);
    };
    const submit = (e) => done(e.submitter?.value === "ok");
    const cancel = () => done(false);
    form.addEventListener("submit", submit);
    d.addEventListener("cancel", cancel);
  });
}

/* Errors: storage and IndexedDB failures are shown to the reader instead of failing silently */

let toastTimer;
function report(what, err) {
  console.error(`Tabs Watch: couldn't ${what}`, err);
  const t = $("toast");
  t.textContent = `Couldn't ${what}. ${err?.message || err || ""}`.trim();
  if (t.matches(":popover-open")) t.hidePopover();
  t.showPopover(); // popover = top layer, so it also shows above an open sheet
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidePopover(), 6000);
}

const guard =
  (what, fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      report(what, err);
    }
  };

/* Settings */

const themeSeg = (v = document.documentElement.dataset.theme) =>
  seg($("prefTheme"), normalizeTheme(v), (t) =>
    chrome.storage.local.set({ newTabTheme: t }).catch((err) => report("change the theme", err)),
  );

async function showSettings() {
  const { settings = { enabled: true, intervalMin: 1, captureText: true } } =
    await chrome.storage.local.get("settings");
  $("setEnabled").checked = settings.enabled !== false;
  $("setText").checked = !!settings.captureText;
  $("setInterval").value = settings.intervalMin ?? 1;
  $("setIdle").value = String(settings.modelIdleMin ?? 5);
  $("prefName").value = prefs.name;
  $("prefRecap").checked = prefs.showRecap;
  $("ver").textContent = chrome.runtime.getManifest().version;
  themeSeg();
  renderModel();
  $("settingsDlg").showModal();
}

async function saveSettings() {
  const { settings: prev = { enabled: true, intervalMin: 1, captureText: true } } =
    await chrome.storage.local.get("settings");
  const intervalMin = Math.max(0.5, Number($("setInterval").value) || 1);
  await chrome.storage.local.set({
    settings: {
      ...prev,
      enabled: $("setEnabled").checked,
      captureText: $("setText").checked,
      intervalMin,
      modelIdleMin: Number($("setIdle").value) || 5,
    },
  });
  await chrome.runtime.sendMessage({ type: "settingsChanged" });
}

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  chrome.storage.local
    .set({ newTabPrefs: prefs })
    .catch((err) => report("save your homepage settings", err));
  render();
}

async function renderModel() {
  let m, settings;
  try {
    ({ model: m = {}, settings = {} } = await chrome.storage.local.get(["model", "settings"]));
  } catch (err) {
    console.error("Tabs Watch: couldn't read the model status", err); // status line only; retried every 4 s
    return;
  }
  const changed = m.installed !== model.installed;
  model = m;
  const on = settings.enabled !== false && settings.knowledge !== false;
  $("dot").classList.toggle("on", on);
  $("stat").textContent = on ? "Saving what you read" : "Paused";
  $("setup").hidden = m.installed && m.state !== "downloading" && m.state !== "error";
  const waiting = items.filter(inQueue).length;
  let text =
    (waiting ? `${plural(waiting, "page")} waiting for a summary. ` : "") +
    "One-time download · about 1.4 GB. Summaries stay on this computer.";
  let button = "Download";
  let pct = null;
  const share = () => (m.total ? Math.round((m.loaded / m.total) * 100) : 0);
  if (m.state === "downloading") {
    pct = share();
    text = `Downloading… ${(m.loaded / 1e9 || 0).toFixed(2)} of ${(m.total / 1e9 || 0).toFixed(2)} GB (${pct}%). You can keep browsing; if it stops, it picks up where it was.`;
    button = null;
  } else if (m.state === "error") {
    text = m.installed
      ? `The model couldn't start: ${m.error}`
      : `The download stopped: ${m.error} What is already downloaded is kept.`;
    button = m.installed ? "Try again" : "Continue download";
  } else if (m.state === "verifying") {
    pct = share();
    text = "Checking the model files…";
    button = null;
  } else if (m.state === "loading") {
    pct = share();
    text = "Starting on this computer…";
    button = null;
  } else if (m.installed) {
    text = `Ready. Summaries run offline on this computer${m.bytes ? ` (${(m.bytes / 1e9).toFixed(1)} GB, ${m.dtype})` : ""}.`;
    button = null;
  }
  for (const [t, b, bar, fill] of [
    ["setupText", "install", "bar", "barFill"],
    ["mText", "mInstall", "mBar", "mFill"],
  ]) {
    $(t).textContent = text;
    $(b).hidden = !button;
    if (button) $(b).textContent = button;
    $(bar).hidden = pct == null;
    $(fill).style.width = (pct || 0) + "%";
  }
  if (changed) render();
  renderActivity();
}

/* Activity: what the on-device model is doing right now, and what is waiting for it */

const inQueue = (a) => a.status === "pending" || a.status === "processing";
let finished = null; // the last page summarised while this tab was open, shown for a moment
let finishedTimer;
let idleSince = 0; // when the queue was last seen waiting with nothing running
let nowId = null;
let nextSig = null;

// What is happening to a queued page and how far along it is
// (pct null: working, no measure yet; pct undefined: not started, so no bar).
function progressOf(a) {
  const m = model;
  const files = m.total ? m.loaded / m.total : null;
  if (m.state === "verifying") return { text: "Checking the model files…", pct: files };
  if (m.state === "loading") return { text: "Starting the model…", pct: files };
  if (m.state === "downloading") return { text: "Downloading the model…", pct: files };
  if (a && m.workingId === a.id) {
    // Long pages are read in parts, then the parts are combined into one summary.
    const of = m.parts > 1 ? ` part ${Math.min(m.part || 1, m.parts - 1)} of ${m.parts - 1}` : "";
    if (m.stage === "merging") return { text: "Combining the parts…", pct: m.progress ?? null };
    return m.stage === "writing"
      ? { text: of ? `Summarising${of}…` : "Writing the summary…", pct: m.progress ?? 0 }
      : { text: of ? `Reading${of}…` : "Reading…", pct: null };
  }
  if (a?.nextTryAt > Date.now())
    return {
      text: `Trying again in ${Math.max(1, Math.round((a.nextTryAt - Date.now()) / 6e4))} min`,
    };
  return { text: "In line" };
}

// Progress shown inside an open article while it waits or is summarised; renderActivity updates it.
function liveBar(a) {
  const { pct } = progressOf(a);
  if (pct === undefined) return null;
  const bar = el("span", { className: "bar", id: "aBar" }, el("i"));
  setBar(bar, pct);
  return bar;
}

function setBar(bar, pct) {
  bar.classList.toggle("indet", pct == null);
  bar.firstElementChild.style.width = pct == null ? "" : `${Math.round(pct * 100)}%`;
}

function actRow(a, right) {
  const b = el(
    "button",
    { className: "act-item" },
    el(
      "span",
      { className: "act-line" },
      siteIcon(a.url),
      el("span", { className: "t", textContent: a.title }),
      el("small", { textContent: right }),
    ),
  );
  b.onclick = () => showArticle(a);
  return b;
}

function showNow(a, stage, pct) {
  if (nowId !== a.id) {
    nowId = a.id;
    $("actFav").replaceChildren(siteIcon(a.url));
  }
  $("actName").textContent = a.title;
  $("actStage").textContent = stage;
  $("actBar").hidden = pct === undefined;
  if (pct !== undefined) setBar($("actBar"), pct);
  $("actNow").onclick = () => showArticle(a);
}

function renderActivity() {
  const queue = items.filter(inQueue).sort((a, b) => a.time - b.time);
  const running =
    !!model.workingId || ["verifying", "loading", "downloading"].includes(model.state);
  idleSince = running || !queue.length ? 0 : idleSince || Date.now();
  const sheetBar = openArticle && $("aBar");
  if (sheetBar) {
    const { pct } = progressOf(openArticle);
    if (pct !== undefined) setBar(sheetBar, pct);
  }
  // Without the model (or when it failed) the banner above says how many pages are waiting.
  const box = $("activity");
  box.hidden = !model.installed || model.state === "error" || (!queue.length && !finished);
  if (box.hidden) return;
  if (!queue.length) {
    const ok = finished.status === "completed";
    $("actIcon").replaceChildren(icon(ok ? CHECK : CLOCK, 22));
    $("actTitle").textContent = "All caught up.";
    $("actText").textContent = ok
      ? "The latest summary is ready."
      : "The last page couldn’t be summarised.";
    $("actStart").hidden = true;
    showNow(finished, ok ? "Summary ready" : "No summary");
    nextSig = "";
    $("actNext").replaceChildren();
    return;
  }
  const cur = queue.find((a) => a.id === model.workingId) || queue[0];
  const stalled = idleSince && Date.now() - idleSince > 15000;
  $("actIcon").replaceChildren(stalled ? icon(CLOCK, 22) : el("span", { className: "spin" }));
  $("actTitle").textContent = stalled
    ? `${plural(queue.length, "page")} waiting for a summary`
    : `Summarising ${plural(queue.length, "page")}`;
  $("actText").textContent = stalled
    ? "The on-device model hasn’t started yet."
    : "On this computer. You can keep browsing.";
  $("actStart").hidden = !stalled;
  const p = progressOf(cur);
  showNow(cur, p.text, p.pct);
  const next = queue.filter((a) => a !== cur);
  const sig = next.map((a) => a.id).join();
  if (sig === nextSig) return; // unchanged: don't rebuild rows (and reload their icons) every tick
  nextSig = sig;
  $("actNext").replaceChildren(
    ...(next.length
      ? [
          el("h4", { textContent: "Up next" }),
          ...next
            .slice(0, 4)
            .map((a) => actRow(a, a.nextTryAt > Date.now() ? progressOf(a).text : ago(a.time))),
          next.length > 4 &&
            el("p", { className: "act-more", textContent: `+ ${next.length - 4} more` }),
        ].filter(Boolean)
      : []),
  );
}

function noteFinished(a) {
  finished = a;
  clearTimeout(finishedTimer);
  finishedTimer = setTimeout(() => {
    finished = null;
    renderActivity();
  }, 8000);
}

let loadFailed = false;
async function load(force = false) {
  try {
    const before = new Map(items.map((a) => [a.id, a]));
    const [all, seen] = await Promise.all([db.all(), db.visits()]);
    items = all;
    visits = new Map(seen.map((v) => [v.url, v]));
    loadFailed = false;
    for (const a of items)
      if (before.has(a.id) && inQueue(before.get(a.id)) && !inQueue(a)) noteFinished(a);
  } catch (err) {
    if (!loadFailed) report("read your saved articles", err); // once, not every 4 s
    loadFailed = true;
    if (!force) return; // keep what is on screen; a forced load still renders the rest of the page
  }
  const sig =
    items.map((a) => `${a.id}:${a.status}`).join("|") +
    `|${[...visits.values()].reduce((n, v) => n + v.last, 0)}`;
  if (force || sig !== lastSig) {
    lastSig = sig;
    render();
  }
  renderModel();
  if (openArticle) {
    const fresh = items.find((a) => a.id === openArticle.id);
    if (!fresh) $("articleDlg").close();
    else if (fresh.status !== openArticle.status) {
      openArticle = fresh;
      drawArticle();
    }
  }
}

for (const d of document.querySelectorAll("dialog.sheet")) {
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  }); // backdrop click
  for (const b of d.querySelectorAll("[data-close]")) b.onclick = () => d.close();
}
$("articleDlg").addEventListener("close", () => {
  openArticle = null;
});
$("pageDlg").addEventListener("close", () => {
  openPage = null;
  $("pBody").replaceChildren();
});

$("aOpen").onclick = guard(
  "open the original",
  () => openArticle && chrome.tabs.create({ url: openArticle.url }),
);
$("pOpen").onclick = guard(
  "open the original",
  () => openPage && chrome.tabs.create({ url: openPage.url }),
);
$("openSettings").onclick = guard("open settings", showSettings);
$("actStart").onclick = guard("start the summaries", async () => {
  idleSince = Date.now(); // give the model a moment before offering the button again
  renderActivity();
  await chrome.runtime.sendMessage({ type: "processQueue" });
});
for (const id of ["setEnabled", "setText", "setInterval", "setIdle"])
  $(id).addEventListener("change", guard("save your settings", saveSettings));
$("prefName").addEventListener("input", () =>
  savePrefs({ name: $("prefName").value.slice(0, 40) }),
);
$("prefRecap").addEventListener("change", () => savePrefs({ showRecap: $("prefRecap").checked }));
for (const id of ["install", "mInstall"])
  $(id).onclick = () => {
    $(id).hidden = true;
    chrome.runtime.sendMessage({ type: "installModel" }).catch((err) => {
      $(id).hidden = false;
      report("start the model download", err);
    });
  };
$("exportData").onclick = guard("export your data", async () => {
  const data = {
    articles: await db.all(),
    visits: await db.visits(),
    ...(await chrome.storage.local.get(["log", "captures", "settings"])),
  };
  const a = el("a", {
    href: URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    download: `tabs-watch-${Date.now()}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
});
$("wipeData").onclick = guard("delete everything", async () => {
  if (
    !(await confirmBox(
      "Delete everything?",
      "All articles, summaries, saved pages and history will be removed from this computer. The model stays installed.",
      "Delete all",
    ))
  )
    return;
  await db.clearAll();
  await chrome.runtime.sendMessage({ type: "clear" });
  load(true);
});

$("q").oninput = render;
$("q").onkeydown = (e) => {
  if (e.key === "Escape" && $("q").value) {
    $("q").value = "";
    render();
  }
};
$("back").onclick = () => go("");
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !document.querySelector("dialog[open]") &&
    !e.target.closest?.("input,textarea,select")
  ) {
    e.preventDefault();
    $("q").focus();
  }
});
addEventListener("popstate", () => {
  readHash();
  render();
});
addEventListener("scroll", () => $("top").classList.toggle("scrolled", scrollY > 8), {
  passive: true,
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.captures) {
    captures = changes.captures.newValue || [];
    render();
  }
  if (changes.newTabPrefs) {
    prefs = { ...prefs, ...changes.newTabPrefs.newValue };
    render();
  }
  if (changes.newTabTheme) themeSeg(changes.newTabTheme.newValue);
  if (changes.model || changes.settings) renderModel();
});

initTheme(chrome.storage, document.documentElement, $("themeToggle")).catch((err) =>
  report("load your theme", err),
);
try {
  const stored = await chrome.storage.local.get(["captures", "newTabPrefs"]);
  captures = stored.captures || [];
  prefs = { ...prefs, ...stored.newTabPrefs };
} catch (err) {
  report("load saved pages and homepage settings", err); // keep going with defaults
}
readHash();
await load(true);
if (lib === "saved" || source) $("library").scrollIntoView();
if (location.hash === "#settings") {
  // Opened from the popup's settings button.
  history.replaceState(null, "", location.pathname);
  guard("open settings", showSettings)();
}
db.onChange(() => load()); // a page was saved or a summary finished
setInterval(load, 4000); // fallback poll for new pages/summaries (no AI runs on opening a tab)
