import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tabs Watch — the core of what you read, on your new tab" },
      { name: "description", content: "A Chrome extension that summarises the articles you read with a local AI model and shows a calm recap per topic. Fully offline." },
      { property: "og:title", content: "Tabs Watch — the core of what you read" },
      { property: "og:description", content: "Automatic, without repetition, fully on your own computer." },
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
      a.download = "tabs-watch.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    })
    .catch((e) => alert(e.message));
};

const features = [
  ["Saves only what you read", "The article text — no menus, ads, logins or email."],
  ["Summarised offline", "A 2B model runs in Chrome on your own graphics card, one article at a time."],
  ["A recap per topic", "The core, what's new, and what connects to earlier — with the exact source quote."],
];

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-8 py-3">
          <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="h-2 w-2 rounded-full bg-brand" /> Tabs Watch
          </span>
          <button onClick={download} className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85">
            Download
          </button>
        </div>
      </header>

      <section className="px-8 pb-20 pt-28 text-center">
        <h1 className="mx-auto max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl">
          The core of what you read, on your new tab.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Automatic, without repetition, and fully on your own computer. No account, no cloud.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <button onClick={download} className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85">
            Download for Chrome
          </button>
          <a href="#install" className="rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted">
            How to install
          </a>
        </div>
      </section>

      <section className="grid gap-4 px-8 pb-20 md:grid-cols-3">
        {features.map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-muted p-8">
            <h3 className="text-lg font-semibold tracking-tight">{t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>

      <section id="install" className="border-t border-border px-8 py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">Install in a minute</h2>
          <ol className="mt-8 space-y-4">
            {[
              <>Unzip the downloaded file.</>,
              <>Open <code className="rounded-md bg-muted px-1.5 py-0.5">chrome://extensions</code>.</>,
              <>Turn on <b className="font-medium">Developer mode</b> (top right).</>,
              <>Click <b className="font-medium">Load unpacked</b> and pick the unzipped folder.</>,
              <>Open a new tab and click <b className="font-medium">Download model</b> (once, about 2.2 GB).</>,
            ].map((s, i) => (
              <li key={i} className="flex gap-4 text-muted-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-muted-foreground">Needs a recent Chrome on a computer with a decent graphics card.</p>
        </div>
      </section>
    </main>
  );
}
