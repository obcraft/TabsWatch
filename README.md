# Tabs Watch

Tabs Watch is a Chrome extension that quietly remembers what you read online — locally, on your own computer.

- Saves the articles you open (clean text only, no menus, ads or comments)
- Summarises them with a local AI model — no cloud, no account
- Shows the core of your reading on your new tab: recap per topic, key points, search

## Install the extension

1. Download `tabs-watch.zip` from the web portal and unzip it
2. Open `chrome://extensions` in Chrome
3. Turn on **Developer mode**
4. Click **Load unpacked** and select the unzipped folder
5. Open a new tab and click **Download model** (one-time, ~2.2 GB, then everything runs offline)

## Development

```sh
bun install
bun run dev
```

The extension source lives in `extension-src/` and static pages in `extension/`. After any change to the extension, rebuild the bundle and the downloadable archive:

```sh
bun scripts/build-extension.ts
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
