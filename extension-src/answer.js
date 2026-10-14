// Reading the local model's answers.

// Pulls the JSON object out of a model answer, with one controlled repair for the mistakes a
// small model makes: a list it forgot to close ("...", }), a trailing comma before a bracket, and
// an answer cut off at the token limit (everything up to the last complete value or list item is
// kept and the open brackets are closed, so it still gives its summary and finished points).
export function firstJsonObject(raw) {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const closers = [];
  const noTrailingComma = (s) => s.replace(/,\s*$/, "");
  let out = "";
  let inString = false;
  let escaped = false;
  let cut = null;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        // A finished item in a list is worth keeping if the answer is cut off after it.
        if (closers.at(-1) === "]") cut = out + [...closers].reverse().join("");
      }
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      closers.push(c === "{" ? "}" : "]");
      out += c;
    } else if (c === "}" || c === "]") {
      if (!closers.includes(c)) continue; // a bracket that closes nothing
      // Close whatever the model left open inside, then this one.
      while (closers.at(-1) !== c) out = noTrailingComma(out) + closers.pop();
      out = noTrailingComma(out) + closers.pop();
      if (!closers.length) return out; // complete answer
      cut = out + [...closers].reverse().join("");
    } else out += c;
  }
  return cut;
}

const terms = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) || [],
  );

// The block a point most likely comes from when the model gave no usable quote: the one that
// contains the most of the point's words. Returns a 0-based index, or -1 if no block contains
// at least half of them.
export function closestBlock(text, blocks) {
  const want = terms(text);
  let best = -1;
  let bestScore = 0;
  blocks.forEach((block, i) => {
    const have = terms(block);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared++;
    const score = want.size ? shared / want.size : 0;
    if (score >= 0.5 && score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
