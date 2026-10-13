import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tab Watcher — Chrome extension" },
      { name: "description", content: "Track, save and monitor what your active Chrome tab is showing." },
      { property: "og:title", content: "Tab Watcher — Chrome extension" },
      { property: "og:description", content: "Track, save and monitor what your active Chrome tab is showing." },
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
  ["Screenshots", "Captures what the tab renders on load and on a timer."],
  ["Page content", "Saves headings, visible text and element count."],
  ["Time per site", "See where your browsing time goes. Export to JSON."],
];

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-20">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm uppercase tracking-widest text-primary">Chrome extension</p>
        <h1 className="mt-3 text-5xl font-bold tracking-tight">Tab Watcher</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Tracks, saves and monitors what your active tab is rendering. All data stays on your device.
        </p>
        <button onClick={download} className="mt-8 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
          Download extension
        </button>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {features.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold text-primary">{t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <h2 className="mt-14 text-2xl font-bold">Install</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>Unzip the downloaded file.</li>
          <li>Open <code className="text-foreground">chrome://extensions</code>.</li>
          <li>Turn on <b className="text-foreground">Developer mode</b> (top right).</li>
          <li>Click <b className="text-foreground">Load unpacked</b> and pick the unzipped folder.</li>
        </ol>
      </div>
    </main>
  );
}
