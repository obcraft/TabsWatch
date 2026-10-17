// Site name and icon, shared by the new tab and the toolbar popup.
export const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
// The website a host belongs to, so subdomains count as one source (m.youtube.com and
// news.google.com are youtube.com and google.com). Where every subdomain is somebody's own site
// (name.github.io, name.substack.com) the subdomain is kept.
const SHARED =
  /(?:^|\.)((?:github\.io|gitlab\.io|blogspot\.com|substack\.com|medium\.com|wordpress\.com|tumblr\.com|neocities\.org|netlify\.app|vercel\.app|pages\.dev|web\.app|firebaseapp\.com|herokuapp\.com|notion\.site))$/;
export function domainOf(h) {
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":")) return h; // localhost, IP addresses
  const shared = SHARED.exec(h)?.[1];
  const parts = h.split(".");
  // Country domains with a second level (bbc.co.uk, abc.net.au) keep three parts.
  const second =
    parts.length > 2 &&
    parts.at(-1).length === 2 &&
    /^(co|com|net|org|gov|ac|edu|ne|or|go)$/.test(parts.at(-2));
  const n = shared ? shared.split(".").length + 1 : second ? 3 : 2;
  return parts.slice(-n).join(".");
}

export const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

// Site icon from Chrome's local favicon cache (no network request); a letter tile if that fails.
export function siteIcon(url, large = false) {
  const name = host(url);
  const cls = large ? " lg" : "";
  const img = Object.assign(document.createElement("img"), {
    className: "fav" + cls,
    alt: "",
    width: large ? 28 : 20,
    height: large ? 28 : 20,
    src: chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`),
  });
  img.onerror = () => {
    const mono = Object.assign(document.createElement("span"), {
      className: "mono" + cls,
      textContent: (name[0] || "?").toUpperCase(),
    });
    mono.style.setProperty("--h", hue(name));
    img.replaceWith(mono);
  };
  return img;
}
