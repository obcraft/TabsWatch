// Model files on this computer: a resumable download into the cache Transformers.js reads, checked
// against the pinned sizes and SHA-256 (model-files.js). Runs in the model worker.
// - Downloads in 16 MB ranges kept in IndexedDB, so an interrupted download resumes where it was.
// - Each file is verified once; a missing or damaged file is fetched again on its own.
// - Files from before the revision was pinned are reused when their checksum matches.
// - Files the model no longer needs (the vision encoder, other precisions) are removed.
import { CACHE_NAME, DTYPE_FILES, MODEL_ID, fileUrl } from "./model-files.js";
import { sha256Stream } from "./sha256.js";

const PART = 16 * 1024 * 1024;
const REPO_PREFIX = `https://huggingface.co/${MODEL_ID}/resolve/`;

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("tabswatch-model", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("parts"); // [path, index] → Blob
      r.result.createObjectStore("verified"); // path → { sha256, size }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idb(store, mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

const isVerified = async (f) =>
  (await idb("verified", "readonly", (s) => s.get(f.path)))?.sha256 === f.sha256;
const markVerified = (f) =>
  idb("verified", "readwrite", (s) => s.put({ sha256: f.sha256, size: f.size }, f.path));
const forget = (f) => idb("verified", "readwrite", (s) => s.delete(f.path));
const partRange = (path) => IDBKeyRange.bound([path, 0], [path, Infinity]);
const storedParts = (path) => idb("parts", "readonly", (s) => s.getAll(partRange(path)));
const storedPartKeys = (path) => idb("parts", "readonly", (s) => s.getAllKeys(partRange(path)));
const dropParts = (path) => idb("parts", "readwrite", (s) => s.delete(partRange(path)));

async function cachedSize(res) {
  const header = Number(res.headers.get("content-length"));
  return header > 0 ? header : (await res.blob()).size;
}

// What is on disk for this precision: files that are ready, and files that must be downloaded.
// Unverified files are hashed once (this is the slow part, ~8 s for the full model).
export async function inspect(dtype, onProgress = () => {}) {
  const cache = await caches.open(CACHE_NAME);
  const files = DTYPE_FILES[dtype];
  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const missing = [];
  for (const f of files) {
    let res = await cache.match(fileUrl(f.path));
    if (!res) res = await adoptLegacy(cache, f, (n) => onProgress(done + n, total));
    if (res && (await cachedSize(res)) === f.size && (await isVerified(f))) {
      done += f.size;
      onProgress(done, total);
      continue;
    }
    if (res && (await cachedSize(res)) === f.size) {
      const sha = await sha256Stream((await cache.match(fileUrl(f.path))).body, (n) =>
        onProgress(done + n, total),
      );
      if (sha === f.sha256) {
        await markVerified(f);
        done += f.size;
        onProgress(done, total);
        continue;
      }
    }
    // Absent, wrong size or damaged: remove what is there and fetch it again.
    await cache.delete(fileUrl(f.path));
    await forget(f);
    missing.push(f);
  }
  return { missing, total };
}

// Before the revision was pinned, files were cached under "main". A copy whose checksum matches
// the pinned file is moved to the pinned address instead of being downloaded again.
async function adoptLegacy(cache, f, onBytes) {
  const legacyUrl = fileUrl(f.path, "main");
  const legacy = await cache.match(legacyUrl);
  if (!legacy) return undefined;
  const blob = await legacy.blob();
  if (blob.size !== f.size || (await sha256Stream(blob.stream(), onBytes)) !== f.sha256)
    return undefined;
  await cache.put(fileUrl(f.path), fileResponse(blob, f.size));
  await markVerified(f);
  await cache.delete(legacyUrl);
  return cache.match(fileUrl(f.path));
}

const fileResponse = (blob, size) =>
  new Response(blob, {
    headers: { "content-length": String(size), "content-type": "application/octet-stream" },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One range of a file, retried a few times so a short network hiccup doesn't stop the download.
async function fetchRange(url, start, end, whole, onBytes) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, whole ? {} : { headers: { Range: `bytes=${start}-${end}` } });
      if (!(whole ? res.ok : res.status === 206))
        throw new Error(`download failed (HTTP ${res.status})`);
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onBytes(got);
      }
      if (got !== end - start + 1) throw new Error("download cut off");
      return new Blob(chunks);
    } catch (e) {
      lastErr = e;
      onBytes(0);
    }
  }
  throw lastErr;
}

async function downloadFile(cache, f, onBytes) {
  const url = fileUrl(f.path);
  const count = Math.ceil(f.size / PART);
  const have = new Set((await storedPartKeys(f.path)).map((k) => k[1]));
  let done = 0;
  for (let i = 0; i < count; i++) {
    const start = i * PART;
    const end = Math.min(f.size, start + PART) - 1;
    if (!have.has(i)) {
      const blob = await fetchRange(url, start, end, count === 1, (n) => onBytes(done + n));
      await idb("parts", "readwrite", (s) => s.put(blob, [f.path, i]));
    }
    done += end - start + 1;
    onBytes(done);
  }
  // Stored parts are files on disk; joining them doesn't copy the data into memory.
  const whole = new Blob(await storedParts(f.path));
  if (whole.size !== f.size || (await sha256Stream(whole.stream())) !== f.sha256) {
    await dropParts(f.path);
    throw new Error(`${f.path} didn't match its checksum; it will be downloaded again`);
  }
  await cache.put(url, fileResponse(whole, f.size));
  await markVerified(f);
  await dropParts(f.path);
}

// Downloads the given files (resuming stored parts); onProgress(bytesDone, bytesTotal).
export async function download(files, onProgress = () => {}) {
  const cache = await caches.open(CACHE_NAME);
  const total = files.reduce((n, f) => n + f.size, 0);
  let before = 0;
  for (const f of files) {
    await downloadFile(cache, f, (n) => onProgress(before + n, total));
    before += f.size;
  }
}

// Removes cached files of this model that the given precision doesn't use: the vision encoder,
// the other precision, and copies stored under other revisions. Returns the bytes freed.
export async function removeUnused(dtype) {
  const cache = await caches.open(CACHE_NAME);
  const keep = new Set(DTYPE_FILES[dtype].map((f) => fileUrl(f.path)));
  let freed = 0;
  for (const req of await cache.keys()) {
    if (!req.url.startsWith(REPO_PREFIX) || keep.has(req.url)) continue;
    const res = await cache.match(req);
    freed += res ? await cachedSize(res) : 0;
    await cache.delete(req);
  }
  return freed;
}
