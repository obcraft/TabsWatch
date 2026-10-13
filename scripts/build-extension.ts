// Bundles extension-src/* into extension/ and repacks public/tab-watcher.zip.
// Run: bun scripts/build-extension.ts
import { $ } from "bun";
import { cpSync, mkdirSync } from "node:fs";

const res = await Bun.build({
  entrypoints: ["extension-src/background.js", "extension-src/offscreen.js", "extension-src/newtab.js"],
  outdir: "extension",
  format: "esm",
  target: "browser",
  minify: true,
});
const content = await Bun.build({ entrypoints: ["extension-src/content.js"], outdir: "extension", format: "iife", target: "browser", minify: true });
for (const r of [res, content]) if (!r.success) { console.error(r.logs); process.exit(1); }

mkdirSync("extension/ort", { recursive: true });
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  cpSync(`node_modules/onnxruntime-web/dist/${f}`, `extension/ort/${f}`);
}
await $`rm -f public/tab-watcher.zip`;
await $`cd extension && nix run nixpkgs#zip -- -qr ../public/tab-watcher.zip .`;
await $`rm -rf extension/ort`; // generated; too large for the repo, lives only inside the zip
console.log("built");
