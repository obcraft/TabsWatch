// The local model, in a dedicated worker that the offscreen document starts and stops. One model
// instance, text only (the vision encoder is never loaded), read offline from checked files.
// Messages: { id, type: "prepare" | "count" | "generate" | "dispose", ...args } → { id, result | error }.
// Events: { event: "progress", phase, loaded, total } · { event: "tokens", n } · { event: "deviceLost" }.
import { extensionUrl as here } from "./worker-env.js"; // must stay the first import
import {
  env,
  AutoTokenizer,
  Qwen3_5ForCausalLM,
  StoppingCriteria,
} from "@huggingface/transformers";
import { DTYPE_FILES, MODEL_ID, MODEL_REVISION } from "./model-files.js";
import * as store from "./model-store.js";

// All runtime code is bundled with the extension — no CDN.
env.useBrowserCache = true;
// Fully offline: model-store.js downloads and checks every file into the cache, so Transformers.js
// never goes to the network. Anything not in the cache resolves to a missing local file (an error
// for required files) instead of a silent download. Both sources can't be off, hence the local path.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = here("no-local-models/");
// Every request goes to the pinned revision, including Transformers.js's own file checks, which
// don't all pass a revision through; the cache keys then match model-store.js exactly.
env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
env.backends.onnx.wasm.wasmPaths = {
  mjs: here("ort/ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: here("ort/ort-wasm-simd-threaded.asyncify.wasm"),
};
env.backends.onnx.wasm.numThreads = 1; // WebGPU does the work; no wasm worker threads needed

let tokenizer = null;
let model = null;
let loading = null;
let dtype = null;

const post = (m) => self.postMessage(m);
const coded = (message, code) => Object.assign(new Error(message), { code });

// Reports at most twice a second so a fast download doesn't flood the extension with messages.
function reporter(phase) {
  let at = 0;
  return (loaded, total) => {
    if (Date.now() - at < 500 && loaded < total) return;
    at = Date.now();
    post({ event: "progress", phase, loaded, total });
  };
}

async function gpuDtype() {
  if (!navigator.gpu)
    throw coded("This browser has no WebGPU. Pages are still saved and searchable.", "no-webgpu");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw coded("No usable graphics card was found for the model.", "no-gpu");
  // Faster half-precision kernels when the GPU supports them; plain q4 otherwise.
  return adapter.features.has("shader-f16") ? "q4f16" : "q4";
}

async function watchDevice() {
  const device = await env.backends.onnx.webgpu?.device;
  device?.lost.then((info) => {
    if (info.reason !== "destroyed") post({ event: "deviceLost", message: info.message });
  });
}

// Checks (and, with permission, downloads or repairs) the files, then loads the model once.
// cleanup: remove cached files this precision doesn't use (off when benchmarking both precisions).
async function prepare({ allowDownload = false, dtype: wanted, cleanup = true } = {}) {
  if (model) return { dtype };
  loading ??= (async () => {
    const t0 = performance.now();
    dtype = wanted || (await gpuDtype());
    const { missing } = await store.inspect(dtype, reporter("verify"));
    const tChecked = performance.now();
    if (missing.length) {
      if (!allowDownload) throw coded("Model files are missing.", "missing");
      await store.download(missing, reporter("download"));
    }
    const freed = cleanup ? await store.removeUnused(dtype).catch(() => 0) : 0;
    const tFiles = performance.now();
    post({ event: "progress", phase: "load", loaded: 0, total: 1 });
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    model = await Qwen3_5ForCausalLM.from_pretrained(MODEL_ID, {
      dtype: { embed_tokens: dtype, decoder_model_merged: dtype },
      device: "webgpu",
    });
    // Warm-up: compiles GPU shaders once so the first real page isn't slow.
    await model.generate({ ...tokenizer("Hi"), max_new_tokens: 1 });
    watchDevice().catch(() => {});
    return {
      dtype,
      bytes: DTYPE_FILES[dtype].reduce((n, f) => n + f.size, 0),
      freed,
      downloaded: missing.reduce((n, f) => n + f.size, 0),
      checkMs: Math.round(tChecked - t0),
      filesMs: Math.round(tFiles - tChecked),
      loadMs: Math.round(performance.now() - tFiles),
    };
  })()
    .catch((e) => {
      model = null;
      tokenizer = null;
      throw e;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

// Stops a generation that runs past its deadline (a stalled GPU), instead of waiting forever.
class Deadline extends StoppingCriteria {
  constructor(ms) {
    super();
    this.until = performance.now() + ms;
    this.hit = false;
  }
  _call(inputIds) {
    this.hit ||= performance.now() > this.until;
    return inputIds.map(() => this.hit);
  }
}

async function generate({ system, prompt, maxNewTokens, timeoutMs = 90_000 }) {
  if (!model) throw coded("The model isn't loaded.", "not-loaded");
  const chat = `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  const inputs = tokenizer(chat);
  const inputTokens = inputs.input_ids.dims[1];
  const deadline = new Deadline(timeoutMs);
  const t0 = performance.now();
  let tokens = -1; // generate() first puts the prompt, then one token per step
  let first = 0;
  let sentAt = 0;
  const streamer = {
    put() {
      tokens++;
      if (tokens === 1) first = performance.now();
      if (tokens > 0 && performance.now() - sentAt > 400) {
        sentAt = performance.now();
        post({ event: "tokens", n: tokens, max: maxNewTokens });
      }
    },
    end() {},
  };
  const out = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    streamer,
    stopping_criteria: [deadline],
  });
  const end = performance.now();
  const [text] = tokenizer.batch_decode(out.slice(null, [inputTokens, null]), {
    skip_special_tokens: true,
  });
  return {
    text,
    inputTokens,
    outputTokens: Math.max(0, tokens),
    prefillMs: (first || end) - t0,
    decodeMs: first ? end - first : 0,
    timedOut: deadline.hit,
  };
}

async function count({ texts }) {
  if (!tokenizer) throw coded("The model isn't loaded.", "not-loaded");
  return texts.map((t) => tokenizer.encode(t).length);
}

async function dispose() {
  await model?.dispose();
  model = null;
  tokenizer = null;
}

const handlers = { prepare, count, generate, dispose };

self.onmessage = async ({ data: { id, type, ...args } }) => {
  try {
    post({ id, result: await handlers[type](args) });
  } catch (e) {
    post({ id, error: String(e?.message || e), code: e?.code });
  }
};
