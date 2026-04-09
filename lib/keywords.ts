/**
 * Keyword extraction — mirrors OpenClaw's query-expansion.ts
 *
 * Extracts meaningful keywords from a query, filtering stop words
 * in English and Spanish. Used for FTS5 queries.
 */

const STOP_WORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "about", "what",
  "which", "who", "whom", "this", "that", "these", "those", "i", "me",
  "my", "we", "our", "you", "your", "he", "him", "his", "she", "her",
  "it", "its", "they", "them", "their",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
  "en", "con", "por", "para", "es", "son", "fue", "ser", "estar",
  "hay", "que", "se", "su", "al", "lo", "como", "más", "pero", "sus",
  "le", "ya", "o", "este", "si", "porque", "esta", "entre", "cuando",
  "muy", "sin", "sobre", "también", "me", "hasta", "donde", "quien",
  "desde", "todo", "nos", "durante", "uno", "ni", "contra", "otros",
]);

/**
 * Extract keywords from a query string.
 * Filters stop words and short tokens.
 */
export function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Build an FTS5 query from keywords.
 * Returns: '"word1" AND "word2"' or null if no keywords.
 * Mirrors OpenClaw's buildFtsQuery().
 */
export function buildFtsQuery(query: string): string | null {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return null;
  return keywords.map((k) => `"${k}"`).join(" AND ");
}
