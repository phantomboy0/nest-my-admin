/** Closest candidate within a small edit distance, for "did you mean" hints in configuration errors. */
export function suggest(name: string, candidates: readonly string[]): string | undefined {
  const target = name.toLowerCase();
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  if (!best) return undefined;
  return best.distance <= Math.max(2, Math.floor(name.length / 3)) ? best.candidate : undefined;
}

export function didYouMean(name: string, candidates: readonly string[]): string {
  const match = suggest(name, candidates);
  return match ? ` (did you mean "${match}"?)` : '';
}

/** Levenshtein distance with a single rolling row. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}
