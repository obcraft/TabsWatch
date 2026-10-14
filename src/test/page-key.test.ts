import { describe, it, expect } from "vitest";
// @ts-expect-error plain JS module
import { pageKey } from "../../extension-src/url.js";

describe("pageKey", () => {
  it("drops tracking parameters and the fragment", () => {
    expect(pageKey("https://news.example/a/story?utm_source=x&fbclid=1#comments")).toBe(
      "https://news.example/a/story",
    );
  });

  it("keeps parameters that pick the page, so different videos and searches stay apart", () => {
    expect(pageKey("https://www.youtube.com/watch?v=abc&si=share")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(pageKey("https://www.google.com/search?q=tabs")).not.toBe(
      pageKey("https://www.google.com/search?q=watch"),
    );
  });

  it("orders parameters so the same page from different links matches", () => {
    expect(pageKey("https://shop.example/p?b=2&a=1")).toBe(
      pageKey("https://shop.example/p?a=1&b=2"),
    );
  });

  it("leaves plain article addresses as before (origin + path)", () => {
    expect(pageKey("https://blog.example/post/1")).toBe("https://blog.example/post/1");
  });
});
