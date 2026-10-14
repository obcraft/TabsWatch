// Reading the local model's answers.

// Pulls the JSON object out of a model answer. Long answers can stop mid-way at the token limit;
// then everything up to the last complete value is kept and the open brackets are closed, so a
// cut-off answer still gives its summary and finished points instead of failing outright.
export function firstJsonObject(raw) {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const closers = [];
  let inString = false;
  let escaped = false;
  let cut = null;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") closers.push("}");
    else if (c === "[") closers.push("]");
    else if (c === "}" || c === "]") {
      closers.pop();
      if (!closers.length) return raw.slice(start, i + 1); // complete answer
      cut = raw.slice(start, i + 1) + [...closers].reverse().join("");
    }
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
