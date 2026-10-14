// Site name and icon, shared by the new tab and the toolbar popup.
export const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
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
