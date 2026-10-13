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

- The Chrome extension is the product. Bundled code lives in `extension-src/` and static pages in `extension/`; run `bun scripts/build-extension.ts` after every change — it bundles into `extension/`, adds the ONNX wasm runtime, and repacks `public/tab-watcher.zip`, because the portal serves that archive and a stale one ships old code.
- The ONNX wasm runtime is copied in only at build time and never committed (`extension/ort/` is git-ignored), because it exceeds the repo's 10 MB file limit.
- Article knowledge lives in IndexedDB under the extension origin and the local model runs in the offscreen document; never call a cloud model as fallback, because the product promise is local-only analysis.
- The extension keeps every capture in `chrome.storage.local` and shows it on its own `dashboard.html` tab — no data leaves the device, so do not add a server, upload endpoint, or account system without the user asking for one.
