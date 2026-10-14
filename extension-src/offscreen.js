// The offscreen document: works through the summary queue and decides when the model worker
// runs. Pages and their statuses live in IndexedDB, so nothing is lost if this document, the
// worker or the browser stops; the background worker starts this document and closes it when idle.
import * as db from "./db.js";
import { analyse, PROMPT_VERSION } from "./analysis.js";
import { MODEL_ID } from "./model-files.js";
import { startModelWorker } from "./model-client.js";

const MAX_RETRIES = 2; // tries after the first, with a growing pause
const BACKOFF_MS = [30_000, 2 * 60_000];
const LEASE_MS = 3 * 60_000;
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 2; // worker restarts within the window before summaries pause
const PAUSE_MS = 10 * 60_000;

let worker = null;
let busy = false;
let idleTimer = null;
let idleMs = 5 * 60_000;
let crashes = [];
let call = null; // the model call in progress, for the progress bar: { stage, part, parts, expect }

// Offscreen documents can only use chrome.runtime, so the background worker stores model state.
const setModel = (patch) =>
  chrome.runtime
    .sendMessage({ type: "modelState", patch: { ...patch, id: MODEL_ID } })
    .catch((e) => console.warn("Tabs Watch: couldn't report model state", patch, e));
const tell = (msg) =>
  chrome.runtime.sendMessage(msg).catch((e) => console.warn("Tabs Watch: message failed", msg, e));

const PHASE = { verify: "verifying", download: "downloading", load: "loading" };
function onWorkerEvent(e) {
  if (e.event === "progress") setModel({ state: PHASE[e.phase], loaded: e.loaded, total: e.total });
  if (e.event === "tokens" && call) {
    // Overall progress across the page's calls (parts + merge), the current one by tokens written.
    const within = Math.min(0.95, e.n / call.expect);
    setModel({
      stage: call.stage === "merging" ? "merging" : "writing",
      progress: ((call.part || 1) - 1 + within) / (call.parts || 1),
    });
  }
}

const isWorkerFailure = (e) => ["device-lost", "crashed", "timeout"].includes(e?.code);
const recentCrashes = () => crashes.filter((t) => Date.now() - t < CRASH_WINDOW_MS);

async function stopWorker() {
  const w = worker;
  worker = null;
  await w?.stop();
}

// One worker with one model; started on demand and checked before each use.
async function getWorker(allowDownload) {
  if (worker && !worker.dead) return worker;
  worker = startModelWorker(onWorkerEvent);
  try {
    const info = await worker.prepare({ allowDownload });
    await setModel({
      state: "ready",
      installed: true,
      dtype: info.dtype,
      bytes: info.bytes,
      error: null,
      loaded: null,
      total: null,
    });
    return worker;
  } catch (e) {
    await stopWorker();
    throw Object.assign(e, { modelError: true });
  }
}

// Model problems (no WebGPU, files missing, download failed) pause the queue without counting
// against the pages waiting in it.
async function modelFailed(e) {
  await setModel({ state: "error", error: e.message, loaded: null, total: null });
}

// Pages whose turn it is: waiting, and not pausing after a failed try. Oldest first.
async function readyJobs() {
  const now = Date.now();
  return (await db.byStatus("pending"))
    .filter((a) => !a.nextTryAt || a.nextTryAt <= now)
    .sort((a, b) => a.time - b.time);
}

// A finished analysis of the same text with the same model and prompt is reused, not redone.
async function reusable(a) {
  if (a.force) return null;
  return (await db.byHash(a.hash)).find(
    (x) =>
      x.id !== a.id &&
      x.status === "completed" &&
      x.modelId === MODEL_ID &&
      x.promptVersion === PROMPT_VERSION,
  );
}

const done = (a, patch) => ({
  ...a,
  ...patch,
  leaseUntil: null,
  force: undefined,
  nextTryAt: patch.nextTryAt ?? null,
});

async function runJob(job, opts) {
  const fresh = await db.get(job.id);
  if (!fresh || fresh.status !== "pending") return; // deleted or taken meanwhile
  const twin = await reusable(fresh);
  if (twin) {
    await db.put(
      done(fresh, {
        status: "completed",
        analysis: twin.analysis,
        stats: { reusedFrom: twin.id },
        modelId: MODEL_ID,
        promptVersion: PROMPT_VERSION,
        error: null,
      }),
    );
    return;
  }
  // Model first, so a model problem leaves the page untouched in the queue.
  const w = await getWorker(opts.allowDownload);
  let lease = { ...fresh, status: "processing", leaseUntil: Date.now() + LEASE_MS };
  await db.put(lease);
  await setModel({
    working: fresh.title,
    workingId: fresh.id,
    waiting: (await readyJobs()).length,
    stage: "reading",
    progress: 0,
    part: null,
    parts: null,
  });
  const llm = {
    count: w.count,
    generate: (o) => {
      call = { ...call, expect: Math.max(32, o.maxNewTokens * 0.6) };
      return w.generate(o);
    },
  };
  let next;
  try {
    const { analysis, stats } = await analyse(fresh, llm, async (s) => {
      call = { ...s };
      setModel({ stage: s.stage, part: s.part ?? null, parts: s.parts ?? null });
      // Long pages take several calls: keep the claim fresh so it isn't seen as abandoned.
      lease = { ...lease, leaseUntil: Date.now() + LEASE_MS };
      if (await db.get(fresh.id)) await db.put(lease);
    });
    next = done(fresh, {
      status: "completed",
      analysis,
      stats,
      modelId: MODEL_ID,
      promptVersion: PROMPT_VERSION,
      error: null,
    });
  } catch (e) {
    if (e.message === "the model took too long") e.code = "timeout";
    if (isWorkerFailure(e)) {
      crashes = [...recentCrashes(), Date.now()];
      await stopWorker(); // a stalled or lost GPU: start clean for the next page
    }
    const attempts = (fresh.attempts || 0) + 1;
    next =
      attempts > MAX_RETRIES
        ? done(fresh, { status: "failed", error: e.message, attempts })
        : done(fresh, {
            status: "pending",
            error: e.message,
            attempts,
            nextTryAt: Date.now() + BACKOFF_MS[attempts - 1],
          });
  } finally {
    call = null;
  }
  // A deleted page stays deleted; the original text is never replaced, only the analysis added.
  if (await db.get(fresh.id)) await db.put(next);
}

async function processQueue(opts) {
  clearTimeout(idleTimer);
  if (opts.idleMin) idleMs = opts.idleMin * 60_000;
  if (busy) return;
  busy = true;
  try {
    // This document is the only worker, so a page still marked "processing" while it is idle was
    // cut off (browser closed, crash) and goes back in line.
    for (const a of await db.byStatus("processing"))
      await db.put({ ...a, status: "pending", leaseUntil: null });
    for (;;) {
      if (recentCrashes().length > MAX_CRASHES) {
        await modelFailed(
          new Error("The graphics card stopped responding. Summaries will try again in a while."),
        );
        await tell({ type: "retryAt", at: Date.now() + PAUSE_MS });
        return;
      }
      const [job] = await readyJobs();
      if (!job) break;
      await runJob(job, opts);
    }
  } catch (e) {
    if (e.modelError) await modelFailed(e);
    else console.warn("Tabs Watch: the summary queue stopped", e);
  } finally {
    busy = false;
    await setModel({
      working: null,
      workingId: null,
      waiting: 0,
      stage: null,
      progress: null,
      part: null,
      parts: null,
    });
    // Pages pausing after a failed try: ask the background to wake the queue when it's their turn.
    const later = (await db.byStatus("pending").catch(() => []))
      .map((a) => a.nextTryAt)
      .filter((t) => t > Date.now());
    if (later.length) await tell({ type: "retryAt", at: Math.min(...later) });
    scheduleIdle();
  }
}

// Keeps the model warm for a while after the queue empties, then frees the GPU and asks the
// background worker to close this document.
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (busy) return;
    await stopWorker();
    await setModel({ state: "idle" });
    await tell({ type: "offscreenIdle" });
  }, idleMs);
}

async function install(opts) {
  clearTimeout(idleTimer);
  try {
    await getWorker(true);
  } catch (e) {
    await modelFailed(e);
    scheduleIdle();
    return;
  }
  await processQueue(opts);
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.target !== "offscreen") return false;
  const opts = { allowDownload: !!msg.allowDownload, idleMin: msg.idleMin };
  if (msg.type === "install") install(opts);
  if (msg.type === "process") processQueue(opts);
  reply({ ok: true });
  return false;
});
