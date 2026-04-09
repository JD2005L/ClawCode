/**
 * Temporal decay — mirrors OpenClaw's temporal-decay.ts
 *
 * Reduces relevance scores for older memories.
 * Files named memory/YYYY-MM-DD.md get a date-based decay.
 * Files without dates (MEMORY.md, notes.md) are evergreen (no decay).
 *
 * Formula: decayedScore = score * exp(-lambda * ageDays)
 * Where lambda = ln(2) / halfLifeDays
 */

const DATED_PATH_RE = /(?:^|\/)(\d{4})-(\d{2})-(\d{2})(?:[.-]|\.md$)/;
const DEFAULT_HALF_LIFE_DAYS = 30;

/**
 * Extract date from a memory file path.
 * Returns null for evergreen files (no date in name).
 */
export function extractDateFromPath(filePath: string): Date | null {
  const match = filePath.match(DATED_PATH_RE);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Calculate temporal decay multiplier for a file path.
 * Returns 1.0 for evergreen files, < 1.0 for dated files.
 */
export function getDecayMultiplier(
  filePath: string,
  now: Date = new Date(),
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS
): number {
  const fileDate = extractDateFromPath(filePath);
  if (!fileDate) return 1.0; // Evergreen — no decay

  const ageDays = (now.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return 1.0; // Future or today — no decay

  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * ageDays);
}
