// Model benchmark: cold start, warm summaries, prefill/decode split and tokens per second over
// fixed articles, through the same worker and analysis code the queue uses. Nothing is stored.
// Driven by scripts/model-benchmark/run.mjs (see its header); the model must already be installed.
import { analyse, LIMITS } from "./analysis.js";
import { startModelWorker } from "./model-client.js";

const $ = (id) => document.getElementById(id);
const log = (line) => ($("log").textContent += line + "\n");
const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
    : null;
};

async function runBenchmark({ articles, runs = 3, dtype, limits = {}, download = false }) {
  const settings = { ...LIMITS, ...limits };
  log(`benchmark: ${articles.length} articles × ${runs} runs, ${JSON.stringify(settings)}`);
  const t0 = performance.now();
  const worker = startModelWorker();
  const info = await worker.prepare({ allowDownload: download, dtype, cleanup: false });
  const coldMs = Math.round(performance.now() - t0);
  log(`cold start ${coldMs} ms (${info.dtype}, ${(info.bytes / 1e9).toFixed(2)} GB of weights)`);
  const rows = [];
  try {
    for (const a of articles)
      for (let run = 1; run <= runs; run++) {
        try {
          const { analysis, stats } = await analyse(a, worker, () => {}, settings);
          rows.push({
            id: a.id,
            run,
            ok: true,
            ...stats,
            points: analysis.points.length,
            topics: analysis.topics.length,
            language: analysis.language,
            summary: analysis.summary,
          });
        } catch (e) {
          rows.push({ id: a.id, run, ok: false, error: String(e?.message || e), raw: e?.raw });
        }
        const r = rows.at(-1);
        log(
          `${a.id} #${run}: ${r.ok ? `${r.ms} ms, ${r.inputTokens} in / ${r.outputTokens} out` : r.error}`,
        );
      }
  } finally {
    await worker.stop();
  }
  const ok = rows.filter((r) => r.ok);
  const byArticle = articles.map((a) => {
    const rs = ok.filter((r) => r.id === a.id);
    const ms = rs.map((r) => r.ms);
    return {
      id: a.id,
      words: a.words,
      p50Ms: percentile(ms, 50),
      p95Ms: percentile(ms, 95),
      calls: rs[0]?.calls ?? null,
      inputTokens: rs[0]?.inputTokens ?? null,
      outputTokens: percentile(
        rs.map((r) => r.outputTokens),
        50,
      ),
      failures: rows.filter((r) => r.id === a.id && !r.ok).length,
    };
  });
  const decode = ok.reduce((n, r) => n + r.decodeMs, 0);
  const prefill = ok.reduce((n, r) => n + r.prefillMs, 0);
  const summary = {
    dtype: info.dtype,
    weightsGB: +(info.bytes / 1e9).toFixed(2),
    coldStartMs: coldMs,
    p50Ms: percentile(
      ok.map((r) => r.ms),
      50,
    ),
    p95Ms: percentile(
      ok.map((r) => r.ms),
      95,
    ),
    decodeTokensPerSecond: decode
      ? +(ok.reduce((n, r) => n + r.outputTokens, 0) / (decode / 1000)).toFixed(1)
      : null,
    prefillMsPer1kTokens: prefill
      ? Math.round(prefill / (ok.reduce((n, r) => n + r.inputTokens, 0) / 1000))
      : null,
    failureRate: rows.length ? +(1 - ok.length / rows.length).toFixed(3) : null,
    pageHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
  log(JSON.stringify(summary));
  return { summary, byArticle, rows, settings };
}

window.runBenchmark = runBenchmark;
$("status").textContent = "Ready. Run scripts/model-benchmark/run.mjs to start.";
