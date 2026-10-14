const $ = (id) => document.getElementById(id);
let view = "log";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dur = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h"; };
const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };

async function render() {
  const { log = [], current, model = {}, settings = { enabled: true, intervalMin: 1, captureText: true } } =
    await chrome.storage.local.get(["log", "current", "settings", "model"]);
  for (const k of ["enabled", "captureText"]) $(k).checked = settings[k];
  const mt = $("modelText"), mb = $("install");
  if (model.state === "downloading") { mt.textContent = `Downloading model… ${Math.round(((model.loaded || 0) / (model.total || 1)) * 100)}% of ~2.2 GB`; mb.hidden = true; }
  else if (model.installed) { mt.textContent = "Local AI model ready · runs offline"; mb.hidden = true; }
  else { mt.textContent = model.state === "error" ? `Model failed: ${model.error}` : "Local AI model · one-time download, about 2.2 GB"; mb.hidden = false; mb.textContent = model.state === "error" ? "Try again" : "Download model"; }
  // What the on-device model is doing right now (pages are summarised in the background).
  const pct = model.stage === "writing" && model.progress != null ? ` · ${Math.round(model.progress * 100)}%` : "";
  $("queueText").textContent = model.working
    ? `Summarising “${model.working}”${pct}${model.waiting ? ` · ${model.waiting} waiting` : ""}`
    : model.state === "loading" ? "Starting the model to summarise your pages…" : "";
  $("queueText").hidden = !$("queueText").textContent;
  $("intervalMin").value = settings.intervalMin;
  $("now").innerHTML = current
    ? `<div class="t"><b>${esc(current.title)}</b></div><div class="muted t">${esc(current.url)}</div>
       <div class="muted">Viewing for ${dur(Date.now() - current.start)}${current.page ? ` · ${current.page.elements} elements` : ""}</div>
       ${current.page?.headings?.length ? `<div class="muted t">H: ${esc(current.page.headings.slice(0, 3).join(" · "))}</div>` : ""}`
    : `<span class="muted">Not tracking right now</span>`;
  const list = $("list");
  if (view === "log") {
    list.innerHTML = log.map((e) => `<li><div class="t">${esc(e.title)}</div><div class="muted t">${esc(host(e.url))} · ${dur(e.durationMs)} · ${new Date(e.start).toLocaleTimeString()}</div></li>`).join("") || `<li class="muted">No history yet</li>`;
  } else {
    const totals = {};
    for (const e of log) totals[host(e.url)] = (totals[host(e.url)] || 0) + e.durationMs;
    list.innerHTML = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([h, ms]) => `<li style="display:flex;justify-content:space-between"><span class="t">${esc(h)}</span><b>${dur(ms)}</b></li>`).join("") || `<li class="muted">No data yet</li>`;
  }
}

async function saveSettings() {
  const settings = { enabled: $("enabled").checked, captureText: $("captureText").checked, intervalMin: Number($("intervalMin").value) || 1 };
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: "settingsChanged" });
}
["enabled", "captureText", "intervalMin"].forEach((id) => $(id).addEventListener("change", saveSettings));

$("snap").onclick = async () => { await chrome.runtime.sendMessage({ type: "snapshotNow" }); render(); };
$("install").onclick = () => { $("install").hidden = true; chrome.runtime.sendMessage({ type: "installModel" }); };
$("dash").onclick = () => chrome.runtime.sendMessage({ type: "openDashboard" });
$("full").onclick = async () => {
  const b = $("full");
  b.disabled = true;
  b.textContent = "Saving…";
  const r = await chrome.runtime.sendMessage({ type: "fullCapture" }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  b.disabled = false;
  if (!r?.ok) {
    b.textContent = "Save page HTML";
    alert(r?.error || "Capture failed.");
  } else {
    const { model = {} } = await chrome.storage.local.get("model").catch(() => ({}));
    b.textContent = !r.queued ? "Saved ✓" : model.installed ? "Saved ✓ · summarising" : "Saved ✓ · summary after model download";
    setTimeout(() => (b.textContent = "Save page HTML"), 2500);
  }
  render();
};
$("clear").onclick = async () => { if (confirm("Delete all saved data?")) { await chrome.runtime.sendMessage({ type: "clear" }); render(); } };
$("export").onclick = async () => {
  const data = await chrome.storage.local.get(["log", "captures", "current"]);
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
