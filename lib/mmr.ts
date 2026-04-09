/**
 * MMR (Maximal Marginal Relevance) — mirrors OpenClaw's mmr.ts
 *
 * Re-ranks results to balance relevance and diversity.
 * Avoids redundant results by penalizing similarity to already-selected items.
 *
 * MMR = lambda * relevance - (1 - lambda) * max_similarity_to_selected
 *
 * Similarity: Jaccard coefficient on tokenized text.
 */

import type { SearchResult } from "./types.ts";

const DEFAULT_LAMBDA = 0.7; // 0 = max diversity, 1 = max relevance

/**
 * Tokenize text for Jaccard similarity.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((w) => w.length >= 2)
  );
}

/**
 * Jaccard similarity between two token sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Apply MMR re-ranking to search results.
 * Returns results re-ordered for diversity while preserving relevance.
 */
export function applyMMR(
  results: SearchResult[],
  maxResults: number,
  lambda: number = DEFAULT_LAMBDA
): SearchResult[] {
  if (results.length <= 1) return results.slice(0, maxResults);

  // Normalize scores to [0, 1]
  const maxScore = Math.max(...results.map((r) => r.score));
  const minScore = Math.min(...results.map((r) => r.score));
  const range = maxScore - minScore || 1;
  const normalized = results.map((r) => ({
    ...r,
    normScore: (r.score - minScore) / range,
  }));

  // Pre-tokenize all snippets
  const tokens = normalized.map((r) => tokenize(r.snippet));

  // Greedy selection
  const selected: number[] = [];
  const remaining = new Set(normalized.map((_, i) => i));

  // Start with highest-scoring item
  let bestIdx = 0;
  for (const i of remaining) {
    if (normalized[i].normScore > normalized[bestIdx].normScore) bestIdx = i;
  }
  selected.push(bestIdx);
  remaining.delete(bestIdx);

  while (selected.length < maxResults && remaining.size > 0) {
    let bestMMR = -Infinity;
    let bestCandidate = -1;

    for (const i of remaining) {
      const relevance = normalized[i].normScore;

      // Max similarity to any already-selected item
      let maxSim = 0;
      for (const j of selected) {
        const sim = jaccard(tokens[i], tokens[j]);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestCandidate = i;
      }
    }

    if (bestCandidate === -1) break;
    selected.push(bestCandidate);
    remaining.delete(bestCandidate);
  }

  return selected.map((i) => results[i]);
}
