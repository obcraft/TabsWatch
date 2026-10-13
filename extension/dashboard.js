const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };
const when = (t) => {
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// Stack the per-screen shots into one tall image, at each shot's scroll offset.
async function stitch(cap) {
  const imgs = await Promise.all(cap.frames.map((f) => loadImg(f.dataUrl)));
  const dpr = cap.dpr || 1;
  const w = Math.max(...imgs.map((i) => i.naturalWidth));
  const total = Math.round((cap.vh + Math.max(...cap.frames.map((f) => f.y))) * dpr);
  if (total > 15000 || w * total > 60000000) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = total;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, total);
  cap.frames.forEach((f, i) => ctx.drawImage(imgs[i], 0, Math.round(f.y * dpr)));
  return c.toDataURL("image/jpeg", 0.72);
}

const wrap = document.getElementById("wrap");
const detail = document.getElementById("detail");
const dbody = document.getElementById("dbody");
const ddl = document.getElementById("ddl");
let mode = "stitched";
let cur = null;
let token = 0;

async function render() {
  const { captures = [] } = await chrome.storage.local.get("captures");
  document.getElementById("count").textContent = captures.length ? `${captures.length} capture${captures.length > 1 ? "s" : ""}` : "";
  wrap.innerHTML = "";
  close();

  if (!captures.length) {
    wrap.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No full-page captures yet</b>Open a page, then click <b>Full-page capture</b> in the Tabs Watch popup.</div>`;
    return;
  }

  for (const cap of captures) {
    const n = cap.frames.length;
    const card = document.createElement("button");
    card.className = "cap";
    card.innerHTML = `
      <div class="thumb">
        <img src="${cap.frames[0].dataUrl}" alt="" loading="lazy">
        <span class="badge">${n} screen${n > 1 ? "s" : ""}</span>
      </div>
      <div class="t">${esc(cap.title)}</div>
      <div class="m">${esc(host(cap.url))} · ${when(cap.time)}</div>`;
    card.onclick = () => open(cap);
    wrap.appendChild(card);
  }
}

async function open(cap) {
  const my = ++token;
  mode = "stitched";
  setToggles();
  cur = { cap, stitched: null };
  detail.hidden = false;
  document.body.classList.add("locked");
  document.getElementById("dtitle").textContent = cap.title;
  document.getElementById("dmeta").textContent =
    `${host(cap.url)} · ${new Date(cap.time).toLocaleString()} · ${cap.frames.length} screens · page ${Math.round(cap.pageHeight)}px tall`;
  ddl.hidden = true;
  dbody.className = "stage";
  dbody.innerHTML = `<div class="hint">Stitching ${cap.frames.length} screens…</div>`;
  const stitched = await stitch(cap);
  if (my !== token) return;
  cur.stitched = stitched;
  draw();
}

function draw() {
  if (!cur) return;
  const { cap, stitched } = cur;
  if (mode === "frames" || !stitched) {
    dbody.className = "strip";
    dbody.innerHTML = cap.frames
      .map((f, i) => `<div class="frame"><img src="${f.dataUrl}" loading="lazy"><div>Screen ${i + 1} · y ${f.y}px</div></div>`)
      .join("");
    return;
  }
  dbody.className = "stage";
  dbody.innerHTML = `<img src="${stitched}" alt="Full page of ${esc(cap.url)}">`;
  ddl.href = stitched;
  ddl.download = `tab-watcher-${host(cap.url)}.jpg`;
  ddl.hidden = false;
}

function setToggles() {
  document.getElementById("dstitched").classList.toggle("on", mode === "stitched");
  document.getElementById("dframes").classList.toggle("on", mode === "frames");
}

function setMode(m) {
  mode = m;
  setToggles();
  draw();
}

function close() {
  token++;
  cur = null;
  detail.hidden = true;
  document.body.classList.remove("locked");
}

document.getElementById("dstitched").onclick = () => setMode("stitched");
document.getElementById("dframes").onclick = () => setMode("frames");
document.getElementById("dback").onclick = close;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

document.getElementById("clear").onclick = async () => {
  if (confirm("Delete all full-page captures?")) {
    await chrome.storage.local.set({ captures: [] });
    render();
  }
};
document.getElementById("export").onclick = async () => {
  const data = await chrome.storage.local.get(["log", "shots", "captures", "current"]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `tab-watcher-${Date.now()}.json`;
  a.click();
};

chrome.storage.onChanged.addListener(render);
render();
