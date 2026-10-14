import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
// @ts-expect-error plain JS module
import { Sha256, sha256Stream } from "../../extension-src/sha256.js";

const node = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("Sha256", () => {
  it("matches known vectors", () => {
    expect(new Sha256().update(new Uint8Array()).hex()).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(new Sha256().update(new TextEncoder().encode("abc")).hex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gives the same digest however the data is split", () => {
    for (const size of [55, 56, 63, 64, 65, 1000, 100_003]) {
      const data = new Uint8Array(randomBytes(size));
      const whole = new Sha256().update(data).hex();
      const parts = new Sha256();
      for (let i = 0; i < size;) {
        const n = 1 + Math.floor(Math.random() * 97);
        parts.update(data.subarray(i, i + n));
        i += n;
      }
      expect(whole).toBe(node(data));
      expect(parts.hex()).toBe(node(data));
    }
  });

  it("hashes a stream", async () => {
    const data = new Uint8Array(randomBytes(300_000));
    let seen = 0;
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < data.length; i += 65_536) c.enqueue(data.subarray(i, i + 65_536));
        c.close();
      },
    });
    const hex = await sha256Stream(stream, (n: number) => (seen = n));
    expect(hex).toBe(node(data));
    expect(seen).toBe(data.length);
  });
});
