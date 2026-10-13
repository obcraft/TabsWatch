import * as db from "./db.js";
import { buildRecaps } from "./recap.js";
import { initTheme, normalizeTheme } from "./theme.js";

const $ = (id) => document.getElementById(id);
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
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
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const icon = (paths) => {
  const t = document.createElement("template");
  t.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return t.content.firstChild;
};
const BOOK =
  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>';
const PAGE =
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>';

function ago(t) {
  const min = Math.round((Date.now() - t) / 6e4);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (sameDay(t, Date.now())) return `${Math.round(min / 60)} h ago`;
  if (sameDay(t, Date.now() - 864e5)) return "Yesterday";
  return day(t);
}

// Site icon from Chrome's local favicon cache (no network request); a letter tile if that fails.
function siteIcon(url) {
  const name = host(url);
  const img = el("img", {
    className: "fav",
    alt: "",
    width: 20,
    height: 20,
    src: chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`),
  });
  img.onerror = () => {
    const mono = el("span", { className: "mono", textContent: (name[0] || "?").toUpperCase() });
    mono.style.setProperty("--h", hue(name));
    img.replaceWith(mono);
  };
  return img;
}

function seg(box, value, pick) {
  for (const b of box.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.v === String(value)));
    b.onclick = () => pick(b.dataset.v);
  }
}

let items = [];
let captures = [];
let model = {};
let prefs = { name: "", showRecap: true };
let topic = "";
let period = 0;
let lib = location.hash === "#saved" ? "saved" : "articles";
let lastSig = "";
let openArticle = null;
let articleTab = "summary";
let openPage = null;
let pageMode = "page";
let pageUrl = null;

function matches(a, q) {
  if (!q) return true;
  const hay = [
    a.title,
    a.site,
    a.analysis?.summary,
    ...(a.analysis?.topics || []),
    ...(a.analysis?.entities || []),
    a.text,
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

function filtered() {
  const q = $("q").value.trim();
  const site = $("site").value;
  const since = period ? Date.now() - period * 864e5 : 0;
  return items.filter(
    (a) =>
      a.time >= since &&
      (!site || host(a.url) === site) &&
      (!topic || a.analysis?.topics?.includes(topic)) &&
      matches(a, q),
  );
}

function state(a) {
  if (a.status === "completed") return { cls: "ready", text: "Summary ready" };
  if (a.status === "processing") return { cls: "working", text: "Summarising…" };
  if (a.status === "failed") return { cls: "failed", text: "No summary" };
  return { cls: "waiting", text: model.installed ? "In queue" : "Waiting for model" };
}

function summaryText(a) {
  if (a.status === "completed") return a.analysis.summary;
  return (a.excerpt || a.blocks?.find((b) => b.length > 120) || "").slice(0, 260);
}

const empty = (paths, title, text) =>
  el(
    "div",
    { className: "empty" },
    paths && icon(paths),
    el("b", { textContent: title }),
    el("span", { textContent: text }),
  );
const heading = (main, sub) =>
  $("libTitle").replaceChildren(main + " ", el("span", { textContent: sub }));

function renderHero() {
  const name = prefs.name.trim();
  $("greeting").textContent = `Welcome back${name ? ", " + name : ""}.`;
  const today = items.filter((a) => sameDay(a.time, Date.now())).length;
  const week = items.filter((a) => a.time > Date.now() - 7 * 864e5).length;
  $("subtitle").textContent = !items.length
    ? "Read something worth keeping. It will show up right here."
    : today
      ? `You’ve read ${plural(today, "article")} today · ${items.length} saved in total.`
      : week
        ? `${plural(week, "article")} this week · ${items.length} saved in total.`
        : `${plural(items.length, "article")} saved on this computer.`;
}

function renderRecaps() {
  const recaps = prefs.showRecap ? buildRecaps(items) : [];
  $("recapWrap").hidden = !recaps.length;
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

function renderTopics() {
  const count = {};
  for (const a of items) for (const t of a.analysis?.topics || []) count[t] = (count[t] || 0) + 1;
  const top = Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24);
  $("topics").hidden = !top.length;
  $("topics").replaceChildren(
    ...top.map(([t, n]) => {
      const c = el("button", { className: "pill" }, t, el("small", { textContent: n }));
      c.setAttribute("aria-pressed", String(t === topic));
      c.onclick = () => {
        topic = topic === t ? "" : t;
        render();
      };
      return c;
    }),
  );
}

function articleTile(a, featured) {
  const s = state(a);
  const sum = summaryText(a);
  const t = el(
    "button",
    { className: "tile" + (featured ? " featured" : "") },
    el(
      "div",
      { className: "src-line" },
      siteIcon(a.url),
      el("span", { textContent: a.site || host(a.url) }),
      el("time", { textContent: ago(a.time) }),
    ),
    el("div", { className: "tile-title", textContent: a.title }),
    sum && el("p", { className: "tile-sum", textContent: sum }),
    el(
      "div",
      { className: "tile-foot" },
      el("span", { className: `state ${s.cls}`, textContent: s.text }),
      el(
        "span",
        { className: "labels" },
        ...(a.analysis?.topics || [])
          .slice(0, featured ? 4 : 2)
          .map((x) => el("span", { textContent: x })),
      ),
    ),
  );
  t.style.setProperty("--h", hue(host(a.url)));
  t.onclick = () => showArticle(a);
  return t;
}

function renderArticles() {
  const q = $("q").value.trim();
  const list = filtered();
  $("toolbar").hidden = !items.length;
  if (q) heading("Results.", `${plural(list.length, "match", "matches")} for “${q}”.`);
  else if (topic) heading(`${topic}.`, "Related articles.");
  else heading("The latest.", "What you’ve been reading.");
  if (!items.length)
    return $("grid").replaceChildren(
      empty(
        BOOK,
        "Nothing here yet.",
        "Spend a moment on an article and it will appear here, summarised on this computer.",
      ),
    );
  if (!list.length)
    return $("grid").replaceChildren(empty(null, "No matches.", "Try another search or filter."));
  const feature = !q && !topic && !period && !$("site").value && list.length > 2;
  $("grid").replaceChildren(...list.map((a, i) => articleTile(a, feature && i === 0)));
}

function renderSaved() {
  const q = $("q").value.trim();
  const pages = captures.filter((c) => c.html);
  const list = pages.filter(
    (c) =>
      !q ||
      q
        .toLowerCase()
        .split(/\s+/)
        .every((w) => `${c.title} ${c.url}`.toLowerCase().includes(w)),
  );
  heading(
    "Saved pages.",
    q ? `${plural(list.length, "match", "matches")} for “${q}”.` : "Full copies you chose to keep.",
  );
  if (!pages.length)
    return $("savedGrid").replaceChildren(
      empty(
        PAGE,
        "No saved pages yet.",
        "Click “Save page HTML” in the Tabs Watch popup to keep a full copy of any page.",
      ),
    );
  if (!list.length)
    return $("savedGrid").replaceChildren(empty(null, "No matches.", "Try another search."));
  $("savedGrid").replaceChildren(
    ...list.map((c) => {
      const t = el(
        "button",
        { className: "tile" },
        el(
          "div",
          { className: "src-line" },
          siteIcon(c.url),
          el("span", { textContent: host(c.url) }),
          el("time", { textContent: ago(c.time) }),
        ),
        el("div", { className: "tile-title", textContent: c.title }),
        el(
          "div",
          { className: "tile-foot" },
          el("span", { className: "state", textContent: "Full page" }),
          el("span", {
            className: "fine",
            textContent: kb(c.size || c.html.length) + (c.truncated ? " · cut off" : ""),
          }),
        ),
      );
      t.onclick = () => showPage(c);
      return t;
    }),
  );
}

function render() {
  renderHero();
  const sites = [...new Set(items.map((a) => host(a.url)))].sort();
  const cur = $("site").value;
  $("site").replaceChildren(
    el("option", { value: "", textContent: "All sites" }),
    ...sites.map((s) => el("option", { value: s, textContent: s })),
  );
  $("site").value = sites.includes(cur) ? cur : "";
  renderRecaps();
  renderTopics();
  seg($("period"), period, (v) => {
    period = Number(v);
    render();
  });
  seg($("libTabs"), lib, (v) => {
    lib = v;
    render();
  });
  $("nArticles").textContent = items.length || "";
  $("nSaved").textContent = captures.filter((c) => c.html).length || "";
  $("articlesView").hidden = lib !== "articles";
  $("savedView").hidden = lib !== "saved";
  if (lib === "saved") renderSaved();
  else renderArticles();
}

/* Article sheet */

function showArticle(a) {
  openArticle = a;
  articleTab = "summary";
  drawArticle();
  $("aScroll").scrollTop = 0;
  if (!$("articleDlg").open) $("articleDlg").showModal();
}

function drawArticle() {
  const a = openArticle;
  if (!a) return;
  seg($("aTabs"), articleTab, (v) => {
    articleTab = v;
    drawArticle();
    $("aScroll").scrollTop = 0;
  });
  $("aSite").replaceChildren(siteIcon(a.url), el("span", { textContent: a.site || host(a.url) }));
  $("aTitle").textContent = a.title;
  const published =
    a.published && !isNaN(new Date(a.published)) ? `Published ${day(a.published)}` : null;
  $("aMeta").textContent = [a.byline, `Opened ${stamp(a.time)}`, published]
    .filter(Boolean)
    .join(" · ");
  $("aRetry").hidden = a.status === "pending" || a.status === "processing";
  $("aContent").replaceChildren(...(articleTab === "text" ? [articleText(a)] : articleSummary(a)));
}

function articleSummary(a) {
  const an = a.analysis;
  if (a.status !== "completed" || !an) {
    const why =
      a.status === "failed"
        ? `The on-device model couldn’t summarise this article${a.error ? ` (${a.error})` : ""}. Try “Analyse again”.`
        : a.status === "processing"
          ? "The on-device model is reading this article right now."
          : model.installed
            ? "This article is in line for a summary."
            : "Download the on-device model in Settings to get summaries.";
    const sum = summaryText(a);
    return [
      el(
        "div",
        { className: "notice" },
        el("b", { textContent: state(a).text }),
        el("p", { textContent: why }),
      ),
      sum && el("p", { className: "lead", textContent: sum }),
    ].filter(Boolean);
  }
  const points = an.points || [];
  return [
    el("p", { className: "lead", textContent: an.summary }),
    points.length && el("h4", { textContent: "Key points" }),
    points.length &&
      el(
        "ol",
        { className: "points" },
        ...points.map((p) => el("li", {}, el("p", { textContent: p.point }), quote(p))),
      ),
    an.entities?.length && el("h4", { textContent: "Mentioned" }),
    an.entities?.length &&
      el("div", { className: "labels" }, ...an.entities.map((t) => el("span", { textContent: t }))),
    el("h4", { textContent: "About this summary" }),
    el("p", {
      className: "fine",
      textContent: `${an.coverage === "partial" ? "Based on the first part of the article" : "Based on the full article text"} · read from the page text · version ${a.version}${a.modelId ? " · " + a.modelId : ""}`,
    }),
  ].filter(Boolean);
}

function quote(p) {
  if (!p.quote) return el("span", { className: "fine", textContent: "Source not verified" });
  if (!p.block) return el("span", { className: "quote", textContent: `“${p.quote}”` });
  const b = el("button", {
    className: "quote",
    textContent: `“${p.quote}” — paragraph ${p.block}`,
  });
  b.onclick = () => {
    articleTab = "text";
    drawArticle();
    const block = $(`b${p.block}`);
    if (block) {
      block.classList.add("hl");
      block.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  return b;
}

const articleText = (a) =>
  el(
    "div",
    { className: "src" },
    ...(a.blocks || []).map((t, i) =>
      el("p", { id: `b${i + 1}` }, el("b", { textContent: i + 1 }), t),
    ),
  );

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

function showPage(c) {
  openPage = c;
  pageMode = "page";
  $("pSite").replaceChildren(siteIcon(c.url), el("span", { textContent: host(c.url) }));
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
  const pending = items.filter((a) => a.status === "pending" || a.status === "processing").length;
  $("stat").textContent =
    (on ? "Saving articles" : "Paused") +
    (m.working
      ? ` · Summarising “${m.working.slice(0, 40)}” · ${m.waiting} waiting`
      : pending && m.installed
        ? ` · ${pending} in queue`
        : "");
  $("setup").hidden = m.installed && m.state !== "downloading" && m.state !== "error";
  let text = "One-time download · about 2.2 GB. Summaries stay on this computer.";
  let button = "Download";
  let pct = null;
  if (m.state === "downloading") {
    pct = m.total ? Math.round((m.loaded / m.total) * 100) : 0;
    text = `Downloading… ${(m.loaded / 1e9 || 0).toFixed(2)} of ${(m.total / 1e9 || 0).toFixed(2)} GB (${pct}%). You can keep browsing.`;
    button = null;
  } else if (m.state === "error") {
    text = `The model couldn't start: ${m.error}`;
    button = "Try again";
  } else if (m.installed) {
    text = "Ready. Summaries run offline on this computer.";
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
}

let loadFailed = false;
async function load(force = false) {
  try {
    items = await db.all();
    loadFailed = false;
  } catch (err) {
    if (!loadFailed) report("read your saved articles", err); // once, not every 4 s
    loadFailed = true;
    if (!force) return; // keep what is on screen; a forced load still renders the rest of the page
  }
  const sig = items.map((a) => `${a.id}:${a.status}`).join("|");
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
$("aRetry").onclick = guard("queue the article again", async () => {
  if (!openArticle) return;
  const next = { ...openArticle, status: "pending", analysis: null, error: null };
  await db.put(next);
  openArticle = next;
  drawArticle();
  await chrome.runtime.sendMessage({ type: "processQueue" });
  load(true);
});
$("aDelete").onclick = guard("delete the article", async () => {
  const a = openArticle;
  if (
    !a ||
    !(await confirmBox(
      "Delete this article?",
      "Its saved text and summary will be removed from this computer.",
    ))
  )
    return;
  await db.del(a.id);
  $("articleDlg").close();
  load(true);
});
$("pOpen").onclick = guard(
  "open the original",
  () => openPage && chrome.tabs.create({ url: openPage.url }),
);
$("pDelete").onclick = guard("delete the saved page", async () => {
  const c = openPage;
  if (
    !c ||
    !(await confirmBox(
      "Delete this saved page?",
      "The full copy will be removed from this computer.",
    ))
  )
    return;
  const { captures: all = [] } = await chrome.storage.local.get("captures");
  await chrome.storage.local.set({ captures: all.filter((x) => x.id !== c.id) });
  $("pageDlg").close();
});

$("openSettings").onclick = guard("open settings", showSettings);
for (const id of ["setEnabled", "setText", "setInterval"])
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
$("site").onchange = render;
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
addEventListener("hashchange", () => {
  if (location.hash === "#saved") {
    lib = "saved";
    render();
  }
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
await load(true);
if (lib === "saved") $("library").scrollIntoView();
setInterval(load, 4000); // pick up new captures/summaries (no AI runs on opening a tab)
