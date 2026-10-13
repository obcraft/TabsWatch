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

- The Chrome extension is the product: its source lives in `extension/` and must be repacked with `zip` into `public/tab-watcher.zip` after every change, because the portal serves that archive as the download and a stale archive ships old code.
- The extension keeps every capture in `chrome.storage.local` and shows it on its own `dashboard.html` tab — no data leaves the device, so do not add a server, upload endpoint, or account system without the user asking for one.
