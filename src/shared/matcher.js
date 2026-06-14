/**
 * Locate `original` inside `text` using surrounding context for disambiguation.
 * Returns { offset, length } or null if not found.
 *
 * Strategy:
 *  1. Collect all occurrences of `original` (case-sensitive).
 *  2. If only one → return it.
 *  3. Score each occurrence by how well `before`/`after` context matches.
 *  4. Return the best-scoring occurrence (fallback: first).
 */
export function findPosition(text, original, before = '', after = '') {
  if (!original || !text.includes(original)) return null;

  const occurrences = [];
  let idx = 0;
  while ((idx = text.indexOf(original, idx)) !== -1) {
    occurrences.push(idx);
    idx++;
  }

  if (occurrences.length === 1) {
    return { offset: occurrences[0], length: original.length };
  }

  // Score by suffix-overlap with `before` and prefix-overlap with `after`
  let bestIdx = occurrences[0];
  let bestScore = -1;

  for (const pos of occurrences) {
    const textBefore = text.slice(Math.max(0, pos - before.length - 10), pos);
    const textAfter  = text.slice(pos + original.length,
                                   pos + original.length + after.length + 10);

    const scoreBefore = before.length > 0
      ? longestCommonSuffix(textBefore, before) / before.length : 0;
    const scoreAfter  = after.length  > 0
      ? longestCommonPrefix(textAfter,  after)  / after.length  : 0;

    const score = scoreBefore + scoreAfter;
    if (score > bestScore) { bestScore = score; bestIdx = pos; }
  }

  return { offset: bestIdx, length: original.length };
}

function longestCommonSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length-1-n] === b[b.length-1-n]) n++;
  return n;
}

function longestCommonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
