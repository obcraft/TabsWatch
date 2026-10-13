import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tab Watcher — Chrome extension" },
      { name: "description", content: "Track, save and monitor what your active Chrome tab is showing, including full-page captures." },
      { property: "og:title", content: "Tab Watcher — Chrome extension" },
      { property: "og:description", content: "Track, save and monitor what your active Chrome tab is showing, including full-page captures." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const download = () => {
  fetch("/tab-watcher.zip")
    .then((r) => { if (!r.ok) throw new Error(`Download failed: ${r.status}`); return r.blob(); })
    .then((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "tab-watcher.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((e) => alert(e.message));
};

const features = [
  ["History", "Every page you view, with title, URL and time spent."],
  ["Full-page capture", "Scrolls a page one screen at a time and saves every 100vh as one tall image."],
  ["Screenshots", "Captures what the tab renders on load and on a timer."],
  ["Page content", "Saves headings, visible text and element count."],
  ["Time per site", "See where your browsing time goes. Export to JSON."],
];

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex items-center justify-between px-8 py-4">
          <span className="flex items-center gap-2 font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-brand" /> Tab Watcher
          </span>
          <button onClick={download} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85">
            Download extension
          </button>
        </div>
      </header>

      <section className="border-b border-border px-8 py-16">
        <p className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Chrome extension
        </p>
        <h1 className="mt-4 text-6xl font-bold tracking-tight text-foreground">Tab Watcher</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Tracks, saves and monitors what your active tab is rendering — including a full-page capture,
          one screen at a time. All data stays on your device.
        </p>
      </section>

      <section className="grid gap-px border-b border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
        {features.map(([t, d]) => (
          <div key={t} className="bg-card p-6">
            <span className="block h-1 w-6 rounded-full bg-brand" />
            <h3 className="mt-4 font-semibold text-foreground">{t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-10 px-8 py-14 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Install</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted-foreground marker:text-brand">
            <li>Unzip the downloaded file.</li>
            <li>Open <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">chrome://extensions</code>.</li>
            <li>Turn on <b className="text-foreground">Developer mode</b> (top right).</li>
            <li>Click <b className="text-foreground">Load unpacked</b> and pick the unzipped folder.</li>
          </ol>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">Full-page capture</h2>
          <p className="mt-4 text-muted-foreground">
            Open any web page, then click <b className="text-foreground">Full-page capture</b> in the popup.
            Tab Watcher scrolls the page one screen height at a time, photographing each 100vh section on
            the way down, then returns you to where you were.
          </p>
          <p className="mt-3 text-muted-foreground">
            Click <b className="text-foreground">Open results</b> to see every capture in a full-width page
            inside Chrome — stitched into one tall image, or screen by screen.
          </p>
        </div>
      </section>
    </main>
  );
}
