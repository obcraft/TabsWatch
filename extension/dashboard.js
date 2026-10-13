const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };
const when = (t) => {
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};
const kb = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB");

const wrap = document.getElementById("wrap");
const detail = document.getElementById("detail");
const dbody = document.getElementById("dbody");
const ddl = document.getElementById("ddl");
let mode = "page";
let cur = null;

// Saved HTML is rendered in a sandboxed frame: no scripts run.
const frame = (html) => {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "");
  f.srcdoc = html;
  return f;
};

async function render() {
  const { captures = [] } = await chrome.storage.local.get("captures");
  const list = captures.filter((c) => c.html);
  document.getElementById("count").textContent = list.length ? `${list.length} page${list.length > 1 ? "s" : ""}` : "";
  wrap.innerHTML = "";
  if (!list.length) {
    wrap.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No saved pages yet</b>Open a page, then click <b>Save page HTML</b> in the Tabs Watch popup.</div>`;
    return;
  }
  for (const cap of list) {
    const card = document.createElement("button");
    card.className = "cap";
    card.innerHTML = `<div class="thumb"><span class="badge">${kb(cap.size || cap.html.length)}</span></div>
      <div class="t">${esc(cap.title)}</div>
      <div class="m">${esc(host(cap.url))} · ${when(cap.time)}</div>`;
    const f = frame(cap.html);
    f.className = "mini";
    f.tabIndex = -1;
    card.querySelector(".thumb").prepend(f);
    card.onclick = () => open(cap);
    wrap.appendChild(card);
  }
}

function open(cap) {
  cur = cap;
  mode = "page";
  detail.hidden = false;
  document.body.classList.add("locked");
  document.getElementById("dtitle").textContent = cap.title;
  document.getElementById("dmeta").textContent =
    `${host(cap.url)} · ${new Date(cap.time).toLocaleString()} · ${cap.elements ?? "?"} elements · ${kb(cap.size || cap.html.length)}${cap.truncated ? " · cut off" : ""}`;
  ddl.href = URL.createObjectURL(new Blob([cap.html], { type: "text/html" }));
  ddl.download = `${host(cap.url)}-${cap.id}.html`;
  ddl.hidden = false;
  draw();
}

function draw() {
  if (!cur) return;
  for (const m of ["page", "html", "text"]) document.getElementById("d" + m).classList.toggle("on", mode === m);
  dbody.innerHTML = "";
  if (mode === "page") { dbody.className = "stage"; dbody.appendChild(frame(cur.html)); }
  else { dbody.className = "stage code"; const pre = document.createElement("pre"); pre.textContent = mode === "html" ? cur.html : cur.text || ""; dbody.appendChild(pre); }
}

function close() { cur = null; detail.hidden = true; document.body.classList.remove("locked"); }

for (const m of ["page", "html", "text"]) document.getElementById("d" + m).onclick = () => { mode = m; draw(); };
document.getElementById("dback").onclick = close;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
document.getElementById("clear").onclick = async () => {
  if (confirm("Delete all saved pages?")) { await chrome.storage.local.set({ captures: [] }); render(); }
};
document.getElementById("export").onclick = async () => {
  const data = await chrome.storage.local.get(["log", "captures", "current"]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `tabs-watch-${Date.now()}.json`;
  a.click();
};
chrome.storage.onChanged.addListener((c) => { if (c.captures) render(); });
render();
