// Reproducible benchmark of the local summary model (cold start, P50/P95 per article, prefill vs
// decode, tokens per second, failures), on this computer's GPU through Chrome's WebGPU.
//
// The model must already be installed in the Chrome profile you pass (download it once from the
// new tab page). Build first: bun scripts/build-extension.ts, then unzip public/tab-watcher.zip
// into the folder that profile loads the extension from (the extension id depends on that path,
// and the model files are stored per extension id).
//
//   node scripts/model-benchmark/run.mjs --chrome "/path/to/Chrome" --profile <dir> \
//     --extension <unpacked dir> [--runs 3] [--dtype q4f16|q4] [--max-output 320] \
//     [--max-input 2048] [--only en-short,nl-long] [--out results.json] [--download]
// --download lets the benchmark fetch a precision that isn't installed (for comparing q4 and q4f16);
// the benchmark never deletes model files.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s(?=--)/)
    .map((a) => a.replace(/^--/, "").split(/\s+(.*)/s))
    .map(([k, v]) => [k, (v ?? "").replace(/^"|"$/g, "")]),
);
const fail = (m) => {
  console.error("benchmark:", m);
  process.exit(1);
};
for (const k of ["chrome", "profile", "extension"]) if (!args[k]) fail(`--${k} is required`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9400 + Math.floor(Math.random() * 400);
let articles = JSON.parse(readFileSync(new URL("articles.json", import.meta.url), "utf8"));
if (args.only) articles = articles.filter((a) => args.only.split(",").includes(a.id));

const chrome = spawn(
  args.chrome,
  [
    "--headless=new",
    `--user-data-dir=${args.profile}`,
    `--load-extension=${args.extension}`,
    `--disable-extensions-except=${args.extension}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);
chrome.on("error", (e) => fail(`couldn't start Chrome: ${e.message}`));
process.on("exit", () => chrome.kill());

const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let ext;
for (let i = 0; i < 60 && !ext; i++) {
  await sleep(500);
  ext = (await list().catch(() => []))
    .map((t) => t.url.match(/^chrome-extension:\/\/([a-z]+)\/background\.js/)?.[1])
    .find(Boolean);
}
if (!ext) fail("the extension didn't start in that profile");
const target = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${ext}/benchmark.html`, {
    method: "PUT",
  })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(
  (r, j) => ((ws.onopen = r), (ws.onerror = () => j(new Error("devtools connection failed")))),
);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  pending.get(m.id)?.(m);
};
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => {
      const r = m.result;
      if (m.error || r?.exceptionDetails)
        reject(new Error(m.error?.message || r.exceptionDetails.exception?.description));
      else resolve(r.result.value);
    });
    ws.send(
      JSON.stringify({
        id: i,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
await sleep(1500);
const limits = {};
if (args["max-output"]) limits.maxOutputTokens = Number(args["max-output"]);
if (args["max-input"]) limits.maxInputTokens = Number(args["max-input"]);
const options = {
  articles,
  runs: Number(args.runs || 3),
  dtype: args.dtype || undefined,
  limits,
  download: "download" in args,
};
const result = await evaluate(`runBenchmark(${JSON.stringify(options)})`).catch((e) =>
  fail(e.message),
);
console.table(result.byArticle);
console.log(result.summary);
if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 1));
ws.close();
process.exit(0);
