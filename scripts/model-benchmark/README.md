# Local model benchmark

Measures the on-device summary model the way the extension runs it: the same model worker
(`extension-src/model-worker.js`) and analysis code (`extension-src/analysis.js`), on this
computer's GPU through Chrome's WebGPU. Nothing is uploaded and nothing is stored.

## Running it

1. `bun scripts/build-extension.ts`, then unzip `public/tab-watcher.zip` into the folder a
   Chrome profile loads the extension from (the model files are stored per extension id, and an
   unpacked extension's id comes from its folder).
2. Download the model once in that profile (new tab page → Download).
3. Run, with Chrome closed for that profile:

```sh
node scripts/model-benchmark/run.mjs --chrome "/path/to/Chrome" --profile <profile dir> \
  --extension <unpacked folder> --runs 3 --out results.json
```

Options: `--dtype q4f16|q4` (default: what the GPU supports), `--max-output <tokens>`,
`--max-input <tokens>`, `--only en-short,nl-long`, `--download` (fetch a precision that isn't
installed, e.g. to compare q4 with q4f16; the benchmark never deletes model files).

It reports cold start (checking the files and loading the model onto the GPU), P50/P95 per
article, prefill time per 1,000 input tokens, decode tokens per second and the failure rate.

## Articles

`articles-en.txt` and `articles-nl.txt` hold short, medium and long articles in English and Dutch
(original text written for this benchmark). `build-fixtures.mjs` turns them into
`articles.json`, adding an extra-long read per language (over the 2,048-token input budget) by
joining that language's three articles.

## Results (2026-10-14, Apple silicon, Chrome 148, WebGPU)

Qwen3.5-2B-ONNX-OPT. "Before" is the extension as of commit 8dfc1e8: the full vision-language
model, a pretty-printed JSON answer, input cut at 9,000 characters, up to 1,024 output tokens.
"After" is the text-only model with the compact prompt (version 3). 8 articles, 3 runs each.

| | Before | After (q4f16) | After (q4) |
| --- | --- | --- | --- |
| Model files | 2.05 GB (incl. 668 MB vision encoder) | **1.40 GB** | 1.55 GB |
| Cold start from cache | 3.0 s | **1.9 s** | — |
| P50 per article | 8.3 s | **5.7 s** | 6.3 s |
| P95 per article | 22.0 s | **16.0 s** | 18.3 s |
| All 8 articles | 84.6 s | **54.2 s** | 63.4 s |
| Output tokens per answer | 291–1,024 | 192–272 | 192–272 |
| Prefill per 1k input tokens | ~1.45 s | **1.45 s** | 2.84 s |
| Decode | 56–63 tok/s | 57 tok/s | 57 tok/s |
| Failures | 0/8 | 0/24 | 0/24 |
| Long reads | cut at 9,000 characters | read in full (in parts above 2,048 tokens) | same |

- **Output length is the main cost.** Decode runs at ~57 tokens/s, so the compact one-line
  answer (key points as short sentences, no indentation) saves 3–7 s per article.
- **q4f16 vs q4:** the same decode speed, but q4f16 prefills twice as fast and is 150 MB smaller.
  q4f16 is used whenever the GPU supports half-precision shaders (`shader-f16`); q4 otherwise.
- **160 output tokens** (the plan's starting value) brought P50 down to 4.1 s but cut every
  answer before its key points, so the limit is 320; key points come last in the answer, so a
  rare cut-off only loses the last ones.
- **Input:** pages up to 2,048 tokens (prompt included) are summarised in one call; longer pages
  in parts of ≤1,500 tokens (at most 4, spread over the text) plus a merge call.
- **Memory:** the GPU holds the 1.40 GB of weights plus the key/value cache of the current call;
  Chrome doesn't expose GPU memory to pages, so it isn't measured. The worker is ended (and the
  offscreen document closed) after the idle time in Settings, which frees it all.
- Transformers.js already keeps the key/value cache on the GPU between decode steps (I/O binding);
  ONNX Runtime's graph capture needs fixed input shapes, which generation doesn't have.
