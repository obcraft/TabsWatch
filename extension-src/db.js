// IndexedDB under the extension origin (never the visited site's origin).
const DB = "tabswatch";
const STORE = "articles";

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = (e) => {
      if (e.oldVersion < 1) {
        const s = r.result.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("url", "url");
        s.createIndex("status", "status");
        s.createIndex("time", "time");
      }
      // v2: find pages with the same text, so a finished analysis can be reused.
      if (e.oldVersion < 2) r.transaction.objectStore(STORE).createIndex("hash", "hash");
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close(); // never block a newer version
      res(r.result);
    };
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      res(out?.result ?? out);
    };
    t.onerror = () => {
      db.close();
      rej(t.error);
    };
  });
}

// Tells open extension pages (the new tab) that articles changed, so new saves and status
// changes show up at once instead of on the next poll. A channel never hears its own messages.
const changes =
  typeof BroadcastChannel === "function" ? new BroadcastChannel("tabswatch-articles") : null;
async function write(fn) {
  const out = await tx("readwrite", fn);
  changes?.postMessage("changed");
  return out;
}
export const onChange = (fn) => changes?.addEventListener("message", fn);

export const put = (a) => write((s) => s.put(a));
export const get = (id) => tx("readonly", (s) => s.get(id));
export const del = (id) => write((s) => s.delete(id));
export const clearAll = () => write((s) => s.clear());
export const all = async () =>
  (await tx("readonly", (s) => s.getAll())).sort((a, b) => b.time - a.time);
export const byUrl = (url) => tx("readonly", (s) => s.index("url").getAll(url));
export const byStatus = (st) => tx("readonly", (s) => s.index("status").getAll(st));
export const byHash = (hash) => tx("readonly", (s) => s.index("hash").getAll(hash));

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
