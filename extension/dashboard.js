const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const host = (u) => { try { return new URL(u).hostname; } catch { return u; } };

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

async function render() {
  const { captures = [] } = await chrome.storage.local.get("captures");
  const wrap = document.getElementById("wrap");
  document.getElementById("count").textContent = captures.length ? `${captures.length} capture${captures.length > 1 ? "s" : ""}` : "";
  wrap.innerHTML = "";

  if (!captures.length) {
    wrap.innerHTML = `<div class="empty"><b>No full-page captures yet</b>Open a page, then click <b>Full-page capture</b> in the Tab Watcher popup.</div>`;
    return;
  }

  for (const cap of captures) {
    const card = document.createElement("section");
    card.className = "cap";

    const h = document.createElement("div");
    h.className = "cap-head";
    h.innerHTML = `
      <div>
        <h2>${esc(cap.title)}</h2>
        <div class="meta">${esc(host(cap.url))} · ${new Date(cap.time).toLocaleString()} · <b>${cap.frames.length} screen${cap.frames.length > 1 ? "s" : ""}</b> · page ${Math.round(cap.pageHeight)}px tall</div>
      </div>
      <div class="acts">
        <a class="dl" hidden download>Download full page</a>
        <button data-mode="stitched" class="on">Stitched</button>
        <button data-mode="frames">Screens</button>
      </div>`;
    card.appendChild(h);

    const body = document.createElement("div");
    body.className = "stage";
    body.innerHTML = `<div class="hint">Stitching ${cap.frames.length} screens…</div>`;
    card.appendChild(body);
    wrap.appendChild(card);

    const dl = h.querySelector(".dl");
    const mode = { v: "stitched" };
    const stitched = await stitch(cap);

    const drawFrames = () => {
      body.className = "strip";
      body.innerHTML = cap.frames
        .map((f, i) => `<div class="frame"><img src="${f.dataUrl}"><div>Screen ${i + 1} · y ${f.y}px</div></div>`)
        .join("");
    };

    const drawStitched = () => {
      if (!stitched) return drawFrames();
      body.className = "stage";
      body.innerHTML = `<div class="hint">Full page · ${cap.frames.length} screens · scroll to read</div><img src="${stitched}" alt="Full page of ${esc(cap.url)}">`;
      dl.href = stitched;
      dl.download = `tab-watcher-${host(cap.url)}.jpg`;
      dl.hidden = false;
    };

    h.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        mode.v = b.dataset.mode;
        h.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        mode.v === "frames" ? drawFrames() : drawStitched();
      };
    });

    drawStitched();
  }
}

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
