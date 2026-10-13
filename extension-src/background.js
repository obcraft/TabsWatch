import * as db from "./db.js";
// Tabs Watch background worker
const MAX_ENTRIES = 500;
const MAX_SHOTS = 50;

async function get(key, def) {
  const r = await chrome.storage.local.get(key);
  return r[key] ?? def;
}
async function set(obj) { await chrome.storage.local.set(obj); }

async function settings() {
  return get("settings", { enabled: true, screenshots: true, intervalMin: 1, captureText: true });
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
        headings: [...document.querySelectorAll("h1,h2")].slice(0, 10).map((h) => h.innerText.trim()),
        elements: document.getElementsByTagName("*").length,
      }),
    });
    return res?.result ?? null;
  } catch { return null; }
}

async function screenshot(windowId, url) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 50 });
    const shots = await get("shots", []);
    shots.unshift({ time: Date.now(), url, dataUrl });
    await set({ shots: shots.slice(0, MAX_SHOTS) });
  } catch {}
}

async function track(tab) {
  const s = await settings();
  if (!s.enabled || !tab || !tab.url || tab.url.startsWith("chrome")) { await closeCurrent(); return; }
  const cur = await get("current", null);
  if (cur && cur.tabId === tab.id && cur.url === tab.url) {
    if (cur.title !== tab.title) { cur.title = tab.title; await set({ current: cur }); }
    return;
  }
  await closeCurrent();
  const entry = { tabId: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl, start: Date.now() };
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
  if (s.screenshots) await screenshot(tab.windowId, tab.url);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

chrome.tabs.onActivated.addListener(async () => track(await activeTab()));
chrome.tabs.onUpdated.addListener(async (id, info, tab) => {
  if (!tab.active) return;
  if (info.url || info.title) await track(tab);
  if (info.status === "complete") { await track(tab); await snapshot(tab); }
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
  if (a.name !== "monitor") return;
  const tab = await activeTab();
  if (tab && tab.url && !tab.url.startsWith("chrome")) await snapshot(tab);
});

// ---- Full-page capture: one screenshot per 100vh of scroll ----
const MAX_CAPTURES = 6;
const MAX_FRAMES = 30;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageMetrics(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      top: Math.round(window.scrollY),
      vh: window.innerHeight,
      sh: document.documentElement.scrollHeight,
      dpr: window.devicePixelRatio || 1,
    }),
  });
  return res?.result ?? null;
}

async function scrollTo(tabId, y) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => window.scrollTo(0, p),
    args: [y],
  });
}

async function badge(text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#1a8f52" });
    await chrome.action.setBadgeText({ text });
  } catch {}
}

async function fullCapture(tab) {
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return { ok: false, error: "This page can't be captured." };
  const start = await pageMetrics(tab.id);
  if (!start) return { ok: false, error: "This page can't be captured." };

  const frames = [];
  let last = start;
  let pos = 0;
  await badge("...");

  while (frames.length < MAX_FRAMES) {
    await scrollTo(tab.id, pos);
    await wait(600);
    const m = await pageMetrics(tab.id);
    if (!m) break;
    last = m;
    // Skip a final shot that only repeats most of the screen already taken.
    if (frames.length && m.top - frames[frames.length - 1].y < m.vh * 0.2) break;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 62 });
      frames.push({ y: m.top, dataUrl });
      await badge(String(frames.length));
    } catch {
      break;
    }
    if (m.top + m.vh >= m.sh - 4) break;
    pos = m.top + m.vh;
  }

  await scrollTo(tab.id, start.top);
  await badge("");
  if (!frames.length) return { ok: false, error: "Nothing was captured." };

  const capture = {
    id: Date.now(),
    url: tab.url,
    title: tab.title || tab.url,
    time: Date.now(),
    dpr: last.dpr,
    vh: last.vh,
    pageHeight: frames[frames.length - 1].y + last.vh,
    frames,
  };

  const captures = await get("captures", []);
  captures.unshift(capture);
  await set({ captures: captures.slice(0, MAX_CAPTURES) });
  return { ok: true, frames: frames.length };
}

// ---- Knowledge capture: main article only, after 5s visible ----
const DWELL_MS = 5000;
const BLOCKED = /(^|\.)(mail\.|outlook\.|bank|paypal\.|accounts?\.)|login|signin|sign-in|checkout|account|wp-admin/i;
const pendingTimers = new Map();

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "Run the local AI model" });
  } catch {}
}
async function kick(type = "process") {
  await ensureOffscreen();
  try { await chrome.runtime.sendMessage({ target: "offscreen", type }); } catch {}
}

function scheduleArticle(tab) {
  if (!tab?.id || tab.incognito || !/^https?:/i.test(tab.url || "")) return;
  clearTimeout(pendingTimers.get(tab.id));
  const url = tab.url;
  pendingTimers.set(tab.id, setTimeout(() => captureArticle(tab.id, url), DWELL_MS));
}

async function captureArticle(tabId, url) {
  const s = await settings();
  if (!s.enabled || s.knowledge === false) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const act = await activeTab();
  if (!tab || !act || act.id !== tabId || tab.url !== url || tab.incognito) return; // navigated away
  const u = new URL(url);
  if (BLOCKED.test(u.hostname + u.pathname)) return;
  const paused = (await get("pausedSites", [])).includes(u.hostname);
  if (paused) return;
  let r;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__tabsWatchExtract?.() });
  } catch { return; }
  const a = r?.result;
  if (!a?.ok) return;
  if ((await chrome.tabs.get(tabId).catch(() => null))?.url !== url) return;
  const clean = u.origin + u.pathname;
  const hash = await db.sha256(a.text);
  const versions = await db.byUrl(clean);
  if (versions.some((v) => v.hash === hash)) return; // unchanged article: no new copy
  await db.put({
    id: `${Date.now()}-${hash.slice(0, 8)}`,
    url: clean, title: a.title, site: a.site, byline: a.byline, published: a.published, lang: a.lang,
    time: Date.now(), blocks: a.blocks, text: a.text, hash, version: versions.length + 1,
    source: "dom", status: "pending",
  });
  const { model = {} } = await chrome.storage.local.get("model");
  if (model.installed) kick();
}

chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.status === "complete" && tab.active) scheduleArticle(tab); });
chrome.tabs.onActivated.addListener(async () => scheduleArticle(await activeTab()));

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.target === "offscreen") return false;
  (async () => {
    if (msg.type === "installModel") await kick("install");
    if (msg.type === "processQueue") await kick();
    if (msg.type === "snapshotNow") { const t = await activeTab(); if (t) { await track(t); await snapshot(t); } }
    if (msg.type === "fullCapture") { const t = await activeTab(); reply(await fullCapture(t)); return; }
    if (msg.type === "openDashboard") { await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }); }
    if (msg.type === "settingsChanged") { await setupAlarm(); if (!(await settings()).enabled) await closeCurrent(); }
    if (msg.type === "clear") await set({ log: [], shots: [], captures: [], current: null });
    reply({ ok: true });
  })();
  return true;
});

// Resume unfinished analyses after a browser restart.
chrome.runtime.onStartup.addListener(async () => {
  const { model = {} } = await chrome.storage.local.get("model");
  if (model.installed && (await db.byStatus("pending")).length + (await db.byStatus("processing")).length) kick();
});
