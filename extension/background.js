// Tab Watcher background worker
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

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    if (msg.type === "snapshotNow") { const t = await activeTab(); if (t) { await track(t); await snapshot(t); } }
    if (msg.type === "settingsChanged") { await setupAlarm(); if (!(await settings()).enabled) await closeCurrent(); }
    if (msg.type === "clear") await set({ log: [], shots: [], current: null });
    reply({ ok: true });
  })();
  return true;
});
