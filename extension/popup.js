const $ = (id) => document.getElementById(id);
let view = "log";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dur = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h"; };
const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };

async function render() {
  const { log = [], shots = [], current, settings = { enabled: true, screenshots: true, intervalMin: 1, captureText: true } } =
    await chrome.storage.local.get(["log", "shots", "current", "settings"]);
  for (const k of ["enabled", "screenshots", "captureText"]) $(k).checked = settings[k];
  $("intervalMin").value = settings.intervalMin;
  $("now").innerHTML = current
    ? `<div class="t"><b>${esc(current.title)}</b></div><div class="muted t">${esc(current.url)}</div>
       <div class="muted">Viewing for ${dur(Date.now() - current.start)}${current.page ? ` · ${current.page.elements} elements` : ""}</div>
       ${current.page?.headings?.length ? `<div class="muted t">H: ${esc(current.page.headings.slice(0, 3).join(" · "))}</div>` : ""}`
    : `<span class="muted">Not tracking right now</span>`;
  const list = $("list");
  if (view === "log") {
    list.innerHTML = log.map((e) => `<li><div class="t">${esc(e.title)}</div><div class="muted t">${esc(host(e.url))} · ${dur(e.durationMs)} · ${new Date(e.start).toLocaleTimeString()}</div></li>`).join("") || `<li class="muted">No history yet</li>`;
  } else if (view === "shots") {
    list.innerHTML = shots.map((s) => `<li><div class="muted t">${new Date(s.time).toLocaleString()} · ${esc(host(s.url))}</div><img src="${s.dataUrl}"></li>`).join("") || `<li class="muted">No screenshots yet</li>`;
  } else {
    const totals = {};
    for (const e of log) totals[host(e.url)] = (totals[host(e.url)] || 0) + e.durationMs;
    list.innerHTML = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([h, ms]) => `<li style="display:flex;justify-content:space-between"><span class="t">${esc(h)}</span><b>${dur(ms)}</b></li>`).join("") || `<li class="muted">No data yet</li>`;
  }
}

async function saveSettings() {
  const settings = { enabled: $("enabled").checked, screenshots: $("screenshots").checked, captureText: $("captureText").checked, intervalMin: Number($("intervalMin").value) || 1 };
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: "settingsChanged" });
}
["enabled", "screenshots", "captureText", "intervalMin"].forEach((id) => $(id).addEventListener("change", saveSettings));

$("snap").onclick = async () => { await chrome.runtime.sendMessage({ type: "snapshotNow" }); render(); };
$("clear").onclick = async () => { if (confirm("Delete all saved data?")) { await chrome.runtime.sendMessage({ type: "clear" }); render(); } };
$("export").onclick = async () => {
  const data = await chrome.storage.local.get(["log", "shots", "current"]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `tab-watcher-${Date.now()}.json`;
  a.click();
};
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); view = b.dataset.v; render();
}));
chrome.storage.onChanged.addListener(render);
render();
