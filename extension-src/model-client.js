// Talks to the model worker (model-worker.js): calls by id, plus progress events. If the worker
// crashes or the GPU is lost, every waiting call is rejected so the caller can start a new one.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coded = (message, code) => Object.assign(new Error(message), { code });

export function startModelWorker(onEvent = () => {}) {
  const worker = new Worker(chrome.runtime.getURL("model-worker.js"), { type: "module" });
  const pending = new Map();
  let next = 0;
  let dead = null;
  const fail = (err) => {
    dead ??= err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    if (data.event) {
      if (data.event === "deviceLost")
        fail(coded("The graphics card stopped responding.", "device-lost"));
      onEvent(data);
      return;
    }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.error) p.reject(coded(data.error, data.code));
    else p.resolve(data.result);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    fail(coded(e.message || "The model stopped unexpectedly.", "crashed"));
    onEvent({ event: "crashed" });
  };
  const call = (type, args = {}) =>
    dead
      ? Promise.reject(dead)
      : new Promise((resolve, reject) => {
          const id = ++next;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, type, ...args });
        });
  return {
    prepare: (options) => call("prepare", options),
    count: (texts) => call("count", { texts }),
    generate: (options) => call("generate", options),
    get dead() {
      return dead;
    },
    // Frees the GPU memory: dispose the model if the worker still answers, then end the worker.
    async stop() {
      await Promise.race([call("dispose").catch(() => {}), sleep(3000)]);
      worker.terminate();
      fail(coded("The model was stopped.", "stopped"));
    },
  };
}
