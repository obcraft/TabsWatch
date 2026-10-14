import { host, siteIcon } from "./site.js";
import { initTheme } from "./theme.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null && k !== false) e.append(k);
  return e;
};
const dur = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const DEFAULTS = { enabled: true, intervalMin: 1, captureText: true };
const MAX_ROWS = 50;
let view = "log";
let listSig = null;

// Storage or the background worker can fail (e.g. while the extension updates): say so, don't fail silently.
function report(what, err) {
  console.error(`Tabs Watch: couldn't ${what}`, err);
  $("err").textContent = `Couldn’t ${what}. Try again.`;
  $("err").hidden = false;
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

// Same theme as the new tab; the page stays hidden until it is applied, so dark never flashes white.
initTheme(chrome.storage, document.documentElement, $("themeToggle")).catch(() => {
  document.documentElement.dataset.theme ||= "light";
});

const row = (url, title, sub, side) =>
  el(
    "li",
    { className: "link" },
    siteIcon(url),
    el(
      "span",
      { className: "link-main" },
      el("span", { className: "link-title", textContent: title }),
      sub && el("span", { className: "link-sum", textContent: sub }),
    ),
    side && el("span", { className: "link-side", textContent: side }),
  );

function renderNow(current, settings) {
  const on = settings.enabled !== false;
  $("enabled").checked = on;
  $("stat").textContent = on ? "Saving" : "Paused";
  $("nowTitle").textContent = on ? "Now reading" : "Paused.";
  $("nowText").textContent = !on
    ? "Turn saving on to keep what you read."
    : current
      ? `On this page for ${dur(Date.now() - current.start)}`
      : "Nothing to save on this page.";
  $("nowPage").hidden = !on || !current;
  if (on && current)
    $("nowPage").replaceChildren(
      row(current.url, current.title || host(current.url), host(current.url)),
    );
}

// The on-device model: shown while it needs a download or is busy, hidden when it is idle.
function modelView(m) {
  const share = m.total ? Math.round(((m.loaded || 0) / m.total) * 100) : 0;
  if (m.state === "downloading")
    return {
      title: "Downloading the model",
      text: `${share}% of about 1.4 GB. You can keep browsing.`,
      pct: share,
    };
  if (m.state === "verifying")
    return { title: "Checking the model files…", text: "Almost ready.", busy: true };
  if (m.state === "error")
    return m.installed
      ? { title: "The model couldn’t start", text: m.error, button: "Try again" }
      : {
          title: "The download stopped",
          text: `${m.error} What is already downloaded is kept.`,
          button: "Continue download",
        };
  if (!m.installed)
    return { title: "Turn on summaries", text: "One-time download · 1.4 GB", button: "Download" };
  if (m.working) {
    // Long pages are read in parts, then the parts are combined into one summary.
    const part =
      m.parts > 1 ? ` · part ${Math.min(m.part || 1, m.parts - 1)} of ${m.parts - 1}` : "";
    const pct =
      m.stage === "writing" && m.progress != null ? ` · ${Math.round(m.progress * 100)}%` : "";
    const waiting = m.waiting ? ` · ${m.waiting} waiting` : "";
    return { title: "Summarising", text: `“${m.working}”${part}${pct}${waiting}`, busy: true };
  }
  if (m.state === "loading")
    return { title: "Starting the model", text: "To summarise your pages.", busy: true };
  return null;
}

function renderModel(m) {
  const v = modelView(m);
  $("model").hidden = !v;
  if (!v) return;
  $("modelIcon").classList.toggle("busy", !!v.busy);
  $("modelTitle").textContent = v.title;
  $("modelText").textContent = v.text;
  $("install").hidden = !v.button;
  if (v.button) $("install").textContent = v.button;
  $("bar").hidden = v.pct == null;
  $("barFill").style.width = (v.pct || 0) + "%";
}

function renderList(log) {
  const sig = `${view}|${log.length}|${log[0]?.start}|${log[0]?.durationMs}`;
  if (sig === listSig) return; // unchanged: don't rebuild rows (and reload their icons) on every model update
  listSig = sig;
  for (const b of $("tabs").querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.v === view));
  let rows;
  if (view === "log") {
    rows = log
      .slice(0, MAX_ROWS)
      .map((e) =>
        row(e.url, e.title || host(e.url), `${host(e.url)} · ${clock(e.start)}`, dur(e.durationMs)),
      );
  } else {
    const sites = new Map();
    for (const e of log) {
      const s = sites.get(host(e.url)) || { url: e.url, ms: 0 };
      s.ms += e.durationMs;
      sites.set(host(e.url), s);
    }
    rows = [...sites]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, MAX_ROWS)
      .map(([name, s]) => row(s.url, name, null, dur(s.ms)));
  }
  $("list").replaceChildren(...rows);
  $("list").hidden = !rows.length;
  $("listEmpty").hidden = !!rows.length;
}

async function render() {
  const {
    log = [],
    current,
    model = {},
    settings = DEFAULTS,
  } = await chrome.storage.local.get(["log", "current", "settings", "model"]);
  renderNow(current, settings);
  renderModel(model);
  renderList(log);
}
const refresh = guard("load your reading", render);

$("enabled").onchange = guard("change saving", async () => {
  const { settings = DEFAULTS } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, enabled: $("enabled").checked } });
  await chrome.runtime.sendMessage({ type: "settingsChanged" });
});
$("openSettings").onclick = guard("open settings", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#settings") }),
);
$("snap").onclick = guard("save this page’s text", async () => {
  await chrome.runtime.sendMessage({ type: "snapshotNow" });
  await render();
});
$("install").onclick = guard("start the download", async () => {
  $("install").hidden = true;
  await chrome.runtime.sendMessage({ type: "installModel" }).catch((err) => {
    $("install").hidden = false;
    throw err;
  });
});
$("dash").onclick = guard("open your saved pages", () =>
  chrome.runtime.sendMessage({ type: "openDashboard" }),
);
$("full").onclick = async () => {
  const b = $("full");
  b.disabled = true;
  b.textContent = "Saving…";
  const r = await chrome.runtime
    .sendMessage({ type: "fullCapture" })
    .catch((e) => ({ ok: false, error: String(e?.message || e) }));
  b.disabled = false;
  if (!r?.ok) {
    b.textContent = "Save page HTML";
    alert(r?.error || "Capture failed.");
  } else {
    const { model = {} } = await chrome.storage.local.get("model").catch(() => ({}));
    b.textContent = !r.queued
      ? "Saved ✓"
      : model.installed
        ? "Saved ✓ · summarising"
        : "Saved ✓ · summary after download";
    setTimeout(() => (b.textContent = "Save page HTML"), 2500);
  }
  refresh();
};
$("clear").onclick = guard("clear saved data", async () => {
  if (confirm("Delete all saved data?")) {
    await chrome.runtime.sendMessage({ type: "clear" });
    await render();
  }
});
$("export").onclick = guard("export your data", async () => {
  const data = await chrome.storage.local.get(["log", "captures", "current"]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  a.download = `tab-watcher-${Date.now()}.json`;
  a.click();
});
for (const b of $("tabs").querySelectorAll("button"))
  b.onclick = () => {
    view = b.dataset.v;
    refresh();
  };
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.log || changes.current || changes.settings || changes.model))
    refresh();
});
refresh();
