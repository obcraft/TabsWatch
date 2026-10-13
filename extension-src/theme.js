export const normalizeTheme = (value) => value === "dark" ? "dark" : "light";

export async function initTheme(storage, root, toggle) {
  const apply = (value) => {
    const theme = normalizeTheme(value);
    root.dataset.theme = theme;
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    toggle.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  };
  apply((await storage.local.get("newTabTheme")).newTabTheme);
  toggle.addEventListener("click", async () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    await storage.local.set({ newTabTheme: next });
  });
  storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.newTabTheme) apply(changes.newTabTheme.newValue);
  });
}