import { describe, it, expect } from "vitest";
// @ts-expect-error extension uses plain JS modules
import { initTheme } from "../../extension-src/theme.js";

function setup(saved?: string) {
  let value = saved;
  const root = document.createElement("html");
  const toggle = document.createElement("button");
  const storage = {
    local: {
      get: async () => ({ newTabTheme: value }),
      set: async (data: { newTabTheme: string }) => { value = data.newTabTheme; },
    },
    onChanged: { addListener: () => {} },
  };
  return { root, toggle, storage, read: () => value };
}

describe("new tab theme preference", () => {
  it("defaults to light for a new installation", async () => {
    const s = setup();
    await initTheme(s.storage, s.root, s.toggle);
    expect(s.root.dataset.theme).toBe("light");
  });
  it("remembers the selected dark theme on reopening", async () => {
    const s = setup();
    await initTheme(s.storage, s.root, s.toggle);
    s.toggle.click();
    expect(s.read()).toBe("dark");
    const reopened = setup(s.read());
    await initTheme(reopened.storage, reopened.root, reopened.toggle);
    expect(reopened.root.dataset.theme).toBe("dark");
    reopened.toggle.click();
    expect(reopened.read()).toBe("light");
  });
});