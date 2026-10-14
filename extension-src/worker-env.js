// Transformers.js only recognises a Chrome extension by `chrome.runtime.id`, which workers don't
// have. Without it, it loads ONNX Runtime's code through a blob: URL that the extension's security
// policy blocks (transformers.js issue #1532). Imported first, before Transformers.js is evaluated.
// (package.json marks modules side-effect free, so the worker uses `extensionUrl` to keep this.)
if (typeof chrome === "undefined") globalThis.chrome = { runtime: { id: self.location.hostname } };

export const extensionUrl = (path) => new URL(path, self.location.href).href;
