import * as db from "./db.js";
import { pageKey } from "./url.js";
// Tabs Watch background worker
const MAX_ENTRIES = 500;
const MAX_SHOTS = 50;

async function get(key, def) {
  const r = await chrome.storage.local.get(key);
  return r[key] ?? def;
}
async function set(obj) {
  await chrome.storage.local.set(obj);
}

async function settings() {
  return get("settings", { enabled: true, intervalMin: 1, captureText: true });
}

async function closeCurrent() {
  const cur = await get("current", null);
  if (!cur) return;
  cur.end = Date.now();
  cur.durationMs = cur.end - cur.start;
  const log = await get("log", []);
  log.unshift(cur);
  await set({ log: log.slice(0, MAX_ENTRIES), current: null });
}

async function grabText(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        text: (document.body?.innerText || "").slice(0, 5000),
        headings: [...document.querySelectorAll("h1,h2")]
          .slice(0, 10)
          .map((h) => h.innerText.trim()),
        elements: document.getElementsByTagName("*").length,
      }),
    });
    return res?.result ?? null;
  } catch {
    return null;
  }
}

async function track(tab) {
  const s = await settings();
  if (!s.enabled || !tab || !tab.url || tab.url.startsWith("chrome")) {
    await closeCurrent();
    return;
  }
  const cur = await get("current", null);
  if (cur && cur.tabId === tab.id && cur.url === tab.url) {
    if (cur.title !== tab.title) {
      cur.title = tab.title;
      await set({ current: cur });
    }
    return;
  }
  await closeCurrent();
  const entry = {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    start: Date.now(),
  };
  await set({ current: entry });
  if (tab.status === "complete") await snapshot(tab);
}

async function snapshot(tab) {
  const s = await settings();
  if (!s.enabled) return;
  const cur = await get("current", null);
  if (s.captureText && cur && cur.tabId === tab.id) {
    cur.page = await grabText(tab.id);
    cur.title = tab.title;
    await set({ current: cur });
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

chrome.tabs.onActivated.addListener(async () => track(await activeTab()));
chrome.tabs.onUpdated.addListener(async (id, info, tab) => {
  if (!tab.active) return;
  if (info.url || info.title) await track(tab);
  if (info.status === "complete") {
    await track(tab);
    await snapshot(tab);
  }
});
chrome.windows.onFocusChanged.addListener(async (w) => {
  if (w === chrome.windows.WINDOW_ID_NONE) await closeCurrent();
  else await track(await activeTab());
});

async function setupAlarm() {
  const s = await settings();
  await chrome.alarms.clear("monitor");
  chrome.alarms.create("monitor", { periodInMinutes: Math.max(0.5, s.intervalMin) });
}
chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(setupAlarm);
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "summaries") return kick(); // a page's pause after a failed try is over
  if (a.name !== "monitor") return;
  const tab = await activeTab();
  if (tab && tab.url && !tab.url.startsWith("chrome")) await snapshot(tab);
});

// ---- Page capture: the rendered DOM as HTML (no screenshots) ----
const MAX_CAPTURES = 20;
const MAX_HTML = 4_000_000;

async function badge(text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#1a8f52" });
    await chrome.action.setBadgeText({ text });
  } catch {}
}

async function fullCapture(tab) {
  if (!tab || !tab.url || !/^https?:/i.test(tab.url))
    return { ok: false, error: "This page can't be captured." };
  await badge("...");
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Serialise the live, rendered DOM; copy current form values into attributes.
        const clone = document.documentElement.cloneNode(true);
        const live = document.querySelectorAll("input,textarea,select");
        const copy = clone.querySelectorAll("input,textarea,select");
        live.forEach((el, i) => {
          const c = copy[i];
          if (!c) return;
          if (el.tagName === "TEXTAREA") c.textContent = el.value;
          else if (el.tagName === "SELECT")
            [...c.options].forEach((o, j) =>
              o.toggleAttribute("selected", el.options[j]?.selected),
            );
          else if (el.type === "checkbox" || el.type === "radio")
            c.toggleAttribute("checked", el.checked);
          else if (el.type !== "password") c.setAttribute("value", el.value);
        });
        clone.querySelectorAll("script,noscript,input[type=password]").forEach((n) => n.remove());
        const head = clone.querySelector("head");
        if (head) {
          const base = document.createElement("base");
          base.href = location.href;
          head.prepend(base);
        }
        return {
          html: "<!doctype html>\n" + clone.outerHTML,
          text: (document.body?.innerText || "").slice(0, 200000),
          elements: document.getElementsByTagName("*").length,
          pageHeight: document.documentElement.scrollHeight,
        };
      },
    });
  } catch {
    await badge("");
    return { ok: false, error: "This page can't be captured." };
  }
  await badge("");
  const r = res?.result;
  if (!r?.html) return { ok: false, error: "Nothing was captured." };
  const capture = {
    id: Date.now(),
    url: tab.url,
    title: tab.title || tab.url,
    time: Date.now(),
    html: r.html.slice(0, MAX_HTML),
    truncated: r.html.length > MAX_HTML,
    size: r.html.length,
    text: r.text,
    elements: r.elements,
    pageHeight: r.pageHeight,
  };
  const captures = await get("captures", []);
  captures.unshift(capture);
  await set({ captures: captures.slice(0, MAX_CAPTURES) });
  // The reader chose to keep this page, so it is also summarised like an article they read.
  const article = await saveArticle(tab.id, tab.url, { force: true }).catch((e) => {
    console.warn("Tabs Watch: couldn't queue the saved page for a summary", e);
    return null;
  });
  return { ok: true, queued: !!article };
}

// ---- Knowledge capture: every page you stay on for 5 s (the article, or the page's text) ----
const DWELL_MS = 5000;
const RECAPTURE_MS = 30 * 60 * 1000; // a page you keep returning to is saved again at most every 30 min
const BLOCKED =
  /(^|\.)(mail\.|outlook\.|bank|paypal\.|accounts?\.)|login|signin|sign-in|checkout|account|wp-admin/i;
const pendingTimers = new Map();

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run the local AI model",
    });
  } catch {}
}
// The offscreen document can't touch chrome.storage, so it reports model state here.
// Writes are chained so rapid progress updates can't overwrite each other.
let modelWrite = Promise.resolve();
function patchModel(patch) {
  modelWrite = modelWrite
    .then(async () => set({ model: { ...(await get("model", {})), ...patch } }))
    // Catching keeps the chain alive so one failed write doesn't block later ones.
    .catch((e) => console.warn("Tabs Watch: couldn't save model state", patch, e));
  return modelWrite;
}

async function kick(type = "process") {
  try {
    const model = await get("model", {});
    // Never start the model download unless the user asked for it ("install" or earlier consent).
    if (type === "process" && !model.installed) return;
    const allowDownload = type === "install" || !!(model.consented || model.installed);
    const { modelIdleMin = 5 } = await settings();
    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type,
      allowDownload,
      idleMin: modelIdleMin,
    });
  } catch (e) {
    console.warn("Tabs Watch: couldn't reach the local model", e);
  }
}

// The offscreen document freed the model after its idle time: close it so nothing keeps running.
async function closeOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument();
  } catch (e) {
    console.warn("Tabs Watch: couldn't close the model document", e);
  }
}

function scheduleArticle(tab) {
  if (!tab?.id || tab.incognito || !/^https?:/i.test(tab.url || "")) return;
  clearTimeout(pendingTimers.get(tab.id));
  const url = tab.url;
  pendingTimers.set(
    tab.id,
    setTimeout(() => captureArticle(tab.id, url), DWELL_MS),
  );
}

async function captureArticle(tabId, url) {
  const s = await settings();
  if (!s.enabled || s.knowledge === false) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const act = await activeTab();
  if (!tab || !act || act.id !== tabId || tab.url !== url || tab.incognito) return; // navigated away
  if (tab.status !== "complete") return; // still loading: the "complete" event schedules it again
  const u = new URL(url);
  if (BLOCKED.test(u.hostname + u.pathname)) return;
  const paused = (await get("pausedSites", [])).includes(u.hostname);
  if (paused) return;
  await saveArticle(tabId, url);
}

const site = (host) => host.replace(/^www\./, "");
function canonicalKey(canonical, url) {
  if (!canonical) return null; // new URL(null, url) would be ".../null"
  try {
    const c = new URL(canonical, url);
    if (!/^https?:$/.test(c.protocol) || site(c.hostname) !== site(new URL(url).hostname))
      return null;
    return pageKey(c.href);
  } catch {
    return null;
  }
}

// Reads the tab's DOM into the article library and queues it for the local model.
// force: the reader saved this page themselves ("Save page"), so the re-save limit doesn't apply.
// Returns the stored article, or null when the page was skipped or had no usable text.
async function saveArticle(tabId, url, { force = false } = {}) {
  let key = pageKey(url);
  let versions = await db.byUrl(key);
  if (!force && versions.some((v) => Date.now() - v.time < RECAPTURE_MS)) return null;
  let r;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__tabsWatchExtract?.(),
    });
  } catch {
    return null;
  }
  const a = r?.result;
  if (!a?.ok) return null;
  if ((await chrome.tabs.get(tabId).catch(() => null))?.url !== url) return null;
  // The page's own canonical address (same site only) joins copies reached through other links.
  key = canonicalKey(a.canonical, url) ?? key;
  if (!force && (await db.byUrl(key)).some((v) => Date.now() - v.time < RECAPTURE_MS)) return null;
  const hash = await db.sha256(a.text);
  versions = await db.byUrl(key);
  const same = versions.find((v) => v.hash === hash);
  if (same) {
    // Unchanged page: no new copy. A saved page whose summary failed gets another try.
    if (!force || same.status !== "failed") return same;
    await db.put({ ...same, status: "pending", error: null });
    kick();
    return same;
  }
  // An older copy still waiting for its summary is replaced, not summarised as well.
  const waiting = versions.find((v) => v.status === "pending");
  const article = {
    id: waiting?.id ?? `${Date.now()}-${hash.slice(0, 8)}`,
    url: key,
    title: a.title,
    site: a.site,
    byline: a.byline,
    published: a.published,
    lang: a.lang,
    time: Date.now(),
    blocks: a.blocks,
    text: a.text,
    excerpt: a.excerpt,
    hash,
    version: waiting?.version ?? versions.length + 1,
    source: "dom",
    status: "pending",
  };
  await db.put(article);
  kick(); // no-op until the model is installed
  return article;
}

chrome.tabs.onUpdated.addListener((id, info, tab) => {
  // info.url alone: an in-app navigation (YouTube, X, Gmail…) that never fires "complete" again.
  if (tab.active && (info.status === "complete" || (info.url && tab.status === "complete")))
    scheduleArticle(tab);
});
chrome.tabs.onActivated.addListener(async () => scheduleArticle(await activeTab()));

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.target === "offscreen") return false;
  (async () => {
    if (msg.type === "modelState") await patchModel(msg.patch);
    if (msg.type === "installModel") {
      await patchModel({ consented: true, error: null }); // remembered, so a cut-off download resumes
      await kick("install");
    }
    if (msg.type === "offscreenIdle") await closeOffscreen();
    if (msg.type === "retryAt") await chrome.alarms.create("summaries", { when: msg.at });
    if (msg.type === "processQueue") await kick();
    if (msg.type === "snapshotNow") {
      const t = await activeTab();
      if (t) {
        await track(t);
        await snapshot(t);
      }
    }
    if (msg.type === "fullCapture") {
      const t = await activeTab();
      reply(await fullCapture(t));
      return;
    }
    if (msg.type === "openDashboard") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#saved") });
    }
    if (msg.type === "settingsChanged") {
      await setupAlarm();
      if (!(await settings()).enabled) await closeCurrent();
    }
    if (msg.type === "clear") await set({ log: [], shots: [], captures: [], current: null });
    reply({ ok: true });
  })();
  return true;
});

// Before 2.2 most summaries failed (answers were cut off mid-JSON), so an update gives every
// failed page one more try with the fixed model settings.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "update") return;
  try {
    const failed = await db.byStatus("failed");
    for (const a of failed)
      await db.put({ ...a, status: "pending", error: null, attempts: 0, nextTryAt: null });
    if (failed.length) await kick();
  } catch (e) {
    console.warn("Tabs Watch: couldn't queue failed summaries again", e);
  }
});

// Resume unfinished analyses after a browser restart.
chrome.runtime.onStartup.addListener(async () => {
  const { model = {} } = await chrome.storage.local.get("model");
  // A download or analysis cut off by closing the browser would otherwise show progress forever.
  if (["downloading", "verifying", "loading"].includes(model.state) || model.working)
    await patchModel({
      state: "idle",
      working: null,
      workingId: null,
      waiting: 0,
      stage: null,
      progress: null,
      part: null,
      parts: null,
    });
  // A download the user started continues where it stopped (parts already on disk are kept).
  if (model.consented && !model.installed) return kick("install");
  if (
    model.installed &&
    (await db.byStatus("pending")).length + (await db.byStatus("processing")).length
  )
    kick();
});
