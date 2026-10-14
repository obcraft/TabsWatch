<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Avoid rewriting pushed git history — no force push, and no rebasing, amending or squashing commits that are already pushed — it desyncs the connected Git integration and can lose project history.



- The Chrome extension is the product. Bundled code lives in `extension-src/` and static pages in `extension/`; run `bun scripts/build-extension.ts` after every change — it bundles into `extension/`, adds the ONNX wasm runtime, and repacks `public/tab-watcher.zip`, because the portal serves that archive and a stale one ships old code.
- The ONNX wasm runtime is copied in only at build time and never committed (`extension/ort/` is git-ignored), because it exceeds the repo's 10 MB file limit.
- Article knowledge lives in IndexedDB under the extension origin and the local model runs in a worker (`model-worker.js`) started by the offscreen document, which also runs the summary queue; never call a cloud model as fallback, because the product promise is local-only analysis.
- The model is pinned to one revision with checked sizes and SHA-256s in `extension-src/model-files.js`, loaded text-only (no vision encoder) and fully offline from Cache Storage; `model-store.js` does the resumable download. Changing the model, precision or prompt means updating those pins and `PROMPT_VERSION`, then re-running `scripts/model-benchmark` (see its README) so the numbers stay true.
- The worker needs `worker-env.js` as its first import: without it Transformers.js loads ONNX Runtime through a blob: URL that the extension's CSP blocks. `package.json` marks modules side-effect free, so that module must stay referenced by an export.
- The extension keeps every capture in `chrome.storage.local` and shows it on the new tab page (`newtab.html`, "Saved pages") — no data leaves the device, so do not add a server, upload endpoint, or account system without the user asking for one.
- Extension pages share base styles in `extension/ui.css`, with page-specific styles loaded afterward; new-tab theme preferences use a dedicated `chrome.storage.local` key so capture settings remain independent.
