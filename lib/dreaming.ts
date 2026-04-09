/**
 * Dreaming system — background memory consolidation.
 * Mirrors OpenClaw's memory-core dreaming (3 phases).
 *
 * Phases:
 *   Light  → Ingest recent signals + recall traces, deduplicate candidates
 *   REM    → Extract patterns, build reflection summaries
 *   Deep   → Rank with 6 weighted signals, promote to MEMORY.md
 *
 * Signal weights (from OpenClaw docs):
 *   Frequency:           0.24 — how many short-term signals accumulated
 *   Relevance:           0.30 — average retrieval quality
 *   Query diversity:     0.15 — distinct query/day contexts
 *   Recency:             0.15 — time-decayed freshness
 *   Consolidation:       0.10 — multi-day recurrence strength
 *   Conceptual richness: 0.06 — concept-tag density
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecallEntry {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  recallCount: number;
  totalScore: number;
  maxScore: number;
  firstRecalledAt: string;
  lastRecalledAt: string;
  recallDays: string[];
  conceptTags: string[];
}

interface ScoredCandidate {
  key: string;
  entry: RecallEntry;
  signals: {
    frequency: number;
    relevance: number;
    queryDiversity: number;
    recency: number;
    consolidation: number;
    conceptualRichness: number;
  };
  finalScore: number;
}

interface DreamResult {
  phase: "light" | "rem" | "deep";
  candidates: ScoredCandidate[];
  promoted: ScoredCandidate[];
  skipped: ScoredCandidate[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Signal weights (from OpenClaw docs)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  frequency: 0.24,
  relevance: 0.30,
  queryDiversity: 0.15,
  recency: 0.15,
  consolidation: 0.10,
  conceptualRichness: 0.06,
};

// ---------------------------------------------------------------------------
// Default thresholds
// ---------------------------------------------------------------------------

const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_MIN_RECALL_COUNT = 2;
const DEFAULT_MIN_UNIQUE_QUERIES = 1;
const DEFAULT_MAX_PROMOTIONS = 10;

// ---------------------------------------------------------------------------
// Core dreaming engine
// ---------------------------------------------------------------------------

export class DreamEngine {
  private pluginRoot: string;
  private dreamsDir: string;

  constructor(pluginRoot: string) {
    this.pluginRoot = pluginRoot;
    this.dreamsDir = path.join(pluginRoot, "memory", ".dreams");
  }

  /**
   * Load short-term recall state.
   */
  private loadRecallState(): Record<string, RecallEntry> {
    const recallPath = path.join(this.dreamsDir, "short-term-recall.json");
    try {
      const data = JSON.parse(fs.readFileSync(recallPath, "utf-8"));
      return data.entries || {};
    } catch {
      return {};
    }
  }

  /**
   * Load phase signals (reinforcement from previous light/rem runs).
   */
  private loadPhaseSignals(): Record<string, number> {
    const signalsPath = path.join(this.dreamsDir, "phase-signals.json");
    try {
      return JSON.parse(fs.readFileSync(signalsPath, "utf-8"));
    } catch {
      return {};
    }
  }

  /**
   * Save phase signals.
   */
  private savePhaseSignals(signals: Record<string, number>): void {
    const signalsPath = path.join(this.dreamsDir, "phase-signals.json");
    fs.mkdirSync(this.dreamsDir, { recursive: true });
    fs.writeFileSync(signalsPath, JSON.stringify(signals, null, 2));
  }

  /**
   * Compute individual signal scores for a recall entry.
   */
  private computeSignals(
    key: string,
    entry: RecallEntry,
    maxRecallCount: number,
    maxTotalScore: number,
    maxDays: number,
    maxTags: number,
    phaseBoost: number
  ): ScoredCandidate["signals"] {
    // Frequency: normalized recall count
    const frequency = maxRecallCount > 0
      ? entry.recallCount / maxRecallCount
      : 0;

    // Relevance: average score per recall
    const avgScore = entry.recallCount > 0
      ? entry.totalScore / entry.recallCount
      : 0;
    const relevance = Math.min(avgScore, 1.0);

    // Query diversity: unique recall days as proxy for distinct contexts
    const queryDiversity = maxDays > 0
      ? entry.recallDays.length / maxDays
      : 0;

    // Recency: time-decayed freshness (half-life 7 days for dreaming)
    const lastRecalled = new Date(entry.lastRecalledAt).getTime();
    const ageDays = (Date.now() - lastRecalled) / (1000 * 60 * 60 * 24);
    const lambda = Math.LN2 / 7; // 7-day half-life for recency signal
    const recency = Math.exp(-lambda * Math.max(0, ageDays));

    // Consolidation: multi-day recurrence strength
    const consolidation = entry.recallDays.length >= 2
      ? Math.min(entry.recallDays.length / 5, 1.0) // cap at 5 days
      : 0;

    // Conceptual richness: concept-tag density
    const conceptualRichness = maxTags > 0
      ? entry.conceptTags.length / maxTags
      : 0;

    return {
      frequency,
      relevance,
      queryDiversity,
      recency: recency + phaseBoost * 0.1, // phase reinforcement
      consolidation,
      conceptualRichness,
    };
  }

  /**
   * Compute final weighted score from signals.
   */
  private computeFinalScore(signals: ScoredCandidate["signals"]): number {
    return (
      signals.frequency * WEIGHTS.frequency +
      signals.relevance * WEIGHTS.relevance +
      signals.queryDiversity * WEIGHTS.queryDiversity +
      signals.recency * WEIGHTS.recency +
      signals.consolidation * WEIGHTS.consolidation +
      signals.conceptualRichness * WEIGHTS.conceptualRichness
    );
  }

  /**
   * Rehydrate snippet from live file — skip if file/lines no longer exist.
   */
  private rehydrateSnippet(entry: RecallEntry): string | null {
    try {
      const fullPath = path.resolve(this.pluginRoot, entry.path);
      if (!fs.existsSync(fullPath)) return null;

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, entry.startLine - 1);
      const end = Math.min(lines.length, entry.endLine);
      const snippet = lines.slice(start, end).join("\n").trim();

      return snippet || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a candidate is already in MEMORY.md (avoid duplicates).
   */
  private isAlreadyInMemory(snippet: string): boolean {
    try {
      const memoryPath = path.join(this.pluginRoot, "memory", "MEMORY.md");
      const content = fs.readFileSync(memoryPath, "utf-8");
      // Check if a significant portion of the snippet is already present
      const words = snippet.split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) return false;

      let matches = 0;
      for (const word of words.slice(0, 10)) {
        if (content.toLowerCase().includes(word.toLowerCase())) matches++;
      }
      return matches / Math.min(words.length, 10) > 0.7;
    } catch {
      return false;
    }
  }

  /**
   * Read recent daily memory files (last N days) for REM theme extraction.
   */
  private readRecentDailyFiles(days: number = 3): Array<{ path: string; content: string; date: string }> {
    const memoryDir = path.join(this.pluginRoot, "memory");
    const files: Array<{ path: string; content: string; date: string }> = [];

    try {
      const entries = fs.readdirSync(memoryDir).filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f) && f.endsWith(".md"));
      // Sort by date descending
      entries.sort().reverse();

      for (const entry of entries.slice(0, days * 3)) { // Allow multiple files per day
        try {
          const content = fs.readFileSync(path.join(memoryDir, entry), "utf-8");
          const dateMatch = entry.match(/^(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            files.push({ path: `memory/${entry}`, content, date: dateMatch[1] });
          }
        } catch {}
      }
    } catch {}

    return files;
  }

  /**
   * Run Light phase — ingest signals, deduplicate, record reinforcements.
   * Also reads recent daily files to feed into REM phase.
   */
  runLight(): { candidates: number; signals: number; dailyFiles: number } {
    const entries = this.loadRecallState();
    const phaseSignals = this.loadPhaseSignals();

    let signalCount = 0;
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.recallCount >= 1) {
        // Record reinforcement signal: recency-decayed boost
        const lastRecalled = new Date(entry.lastRecalledAt).getTime();
        const ageDays = (Date.now() - lastRecalled) / (1000 * 60 * 60 * 24);
        const boost = Math.exp(-Math.LN2 / 14 * ageDays); // 14-day half-life
        phaseSignals[key] = (phaseSignals[key] || 0) + boost;
        signalCount++;
      }
    }

    this.savePhaseSignals(phaseSignals);

    const dailyFiles = this.readRecentDailyFiles(3);
    return { candidates: Object.keys(entries).length, signals: signalCount, dailyFiles: dailyFiles.length };
  }

  /**
   * Run REM phase — extract themes and reflection patterns from recall traces.
   * Produces a ## REM Sleep block in DREAMS.md with themes found.
   * Returns a prompt that can be used for LLM-driven reflection.
   */
  runREM(): { themes: string[]; reflectionPrompt: string } {
    const entries = this.loadRecallState();
    const dailyFiles = this.readRecentDailyFiles(3);

    // Extract themes from concept tags across all recall entries
    const tagCounts: Record<string, number> = {};
    for (const entry of Object.values(entries)) {
      for (const tag of entry.conceptTags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Top themes by frequency
    const themes = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => `${tag} (${count}x)`);

    // Find patterns: entries recalled on multiple days
    const multiDayEntries = Object.values(entries)
      .filter((e) => e.recallDays.length >= 2)
      .sort((a, b) => b.recallDays.length - a.recallDays.length);

    // Build REM block for DREAMS.md
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const remLines: string[] = [
      "",
      `## REM Sleep — ${now}`,
      "",
    ];

    if (themes.length > 0) {
      remLines.push("### Recurring Themes");
      remLines.push(themes.map((t) => `- ${t}`).join("\n"));
      remLines.push("");
    }

    if (multiDayEntries.length > 0) {
      remLines.push("### Multi-Day Patterns");
      for (const entry of multiDayEntries.slice(0, 5)) {
        remLines.push(
          `- **${entry.path}#L${entry.startLine}** — recalled ${entry.recallDays.length} days, tags: ${entry.conceptTags.slice(0, 5).join(", ")}`
        );
      }
      remLines.push("");
    }

    if (dailyFiles.length > 0) {
      remLines.push(`### Recent Context (${dailyFiles.length} daily files scanned)`);
      for (const f of dailyFiles.slice(0, 3)) {
        const preview = f.content.split("\n").filter((l) => l.trim()).slice(0, 2).join(" | ");
        remLines.push(`- ${f.path}: ${preview.slice(0, 100)}...`);
      }
      remLines.push("");
    }

    // Write REM block to DREAMS.md
    const dreamsPath = path.join(this.pluginRoot, "DREAMS.md");
    try {
      if (fs.existsSync(dreamsPath)) {
        fs.appendFileSync(dreamsPath, remLines.join("\n"));
      } else {
        fs.writeFileSync(dreamsPath, `# Dreams\n\n*Memory consolidation diary.*\n${remLines.join("\n")}`);
      }
    } catch {}

    // Build reflection prompt for agent (LLM-driven part of REM)
    const reflectionPrompt = [
      "Review these recurring memory themes from your recent recall traces:",
      themes.length > 0 ? `Themes: ${themes.join(", ")}` : "No strong themes yet.",
      multiDayEntries.length > 0
        ? `Patterns: ${multiDayEntries.length} memories recalled across multiple days.`
        : "No multi-day patterns yet.",
      "Reflect: Are there insights or connections worth noting in your daily memory file?",
    ].join("\n");

    // Record REM reinforcement signals
    const phaseSignals = this.loadPhaseSignals();
    for (const entry of multiDayEntries) {
      const key = `memory:${entry.path}:${entry.startLine}:${entry.endLine}`;
      phaseSignals[key] = (phaseSignals[key] || 0) + 0.15; // REM boost
    }
    this.savePhaseSignals(phaseSignals);

    return { themes: themes.map((t) => t.replace(/ \(\d+x\)$/, "")), reflectionPrompt };
  }

  /**
   * Run Deep phase — rank candidates, promote winners to MEMORY.md.
   */
  runDeep(options?: {
    minScore?: number;
    minRecallCount?: number;
    minUniqueQueries?: number;
    maxPromotions?: number;
    dryRun?: boolean;
  }): DreamResult {
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
    const minRecallCount = options?.minRecallCount ?? DEFAULT_MIN_RECALL_COUNT;
    const minUniqueQueries = options?.minUniqueQueries ?? DEFAULT_MIN_UNIQUE_QUERIES;
    const maxPromotions = options?.maxPromotions ?? DEFAULT_MAX_PROMOTIONS;
    const dryRun = options?.dryRun ?? false;

    const entries = this.loadRecallState();
    const phaseSignals = this.loadPhaseSignals();

    // Compute normalization maxes
    const allEntries = Object.values(entries);
    const maxRecallCount = Math.max(...allEntries.map((e) => e.recallCount), 1);
    const maxTotalScore = Math.max(...allEntries.map((e) => e.totalScore), 1);
    const maxDays = Math.max(...allEntries.map((e) => e.recallDays.length), 1);
    const maxTags = Math.max(...allEntries.map((e) => e.conceptTags.length), 1);

    // Score all candidates
    const candidates: ScoredCandidate[] = [];
    for (const [key, entry] of Object.entries(entries)) {
      const phaseBoost = phaseSignals[key] || 0;
      const signals = this.computeSignals(
        key, entry, maxRecallCount, maxTotalScore, maxDays, maxTags, phaseBoost
      );
      const finalScore = this.computeFinalScore(signals);
      candidates.push({ key, entry, signals, finalScore });
    }

    // Sort by final score descending
    candidates.sort((a, b) => b.finalScore - a.finalScore);

    // Apply threshold gates
    const promoted: ScoredCandidate[] = [];
    const skipped: ScoredCandidate[] = [];

    for (const candidate of candidates) {
      if (promoted.length >= maxPromotions) break;

      const passesScore = candidate.finalScore >= minScore;
      const passesRecall = candidate.entry.recallCount >= minRecallCount;
      const passesQueries = candidate.entry.recallDays.length >= minUniqueQueries;

      if (!passesScore || !passesRecall || !passesQueries) {
        skipped.push(candidate);
        continue;
      }

      // Rehydrate snippet from live file
      const snippet = this.rehydrateSnippet(candidate.entry);
      if (!snippet) {
        skipped.push(candidate);
        continue;
      }

      // Skip if already in MEMORY.md
      if (this.isAlreadyInMemory(snippet)) {
        skipped.push(candidate);
        continue;
      }

      promoted.push(candidate);
    }

    // Write promotions to MEMORY.md (unless dry run)
    if (!dryRun && promoted.length > 0) {
      this.promoteToMemory(promoted);
    }

    // Write DREAMS.md summary
    const summary = this.writeDreamSummary(promoted, skipped, candidates.length);

    return {
      phase: "deep",
      candidates,
      promoted,
      skipped,
      summary,
    };
  }

  /**
   * Append promoted entries to MEMORY.md.
   */
  private promoteToMemory(promoted: ScoredCandidate[]): void {
    const memoryPath = path.join(this.pluginRoot, "memory", "MEMORY.md");
    const today = new Date().toISOString().slice(0, 10);

    const lines: string[] = [
      "",
      `## Promoted by dreaming (${today})`,
      "",
    ];

    for (const candidate of promoted) {
      const snippet = this.rehydrateSnippet(candidate.entry);
      if (!snippet) continue;

      lines.push(
        `- ${snippet.split("\n")[0].trim()} *(score: ${candidate.finalScore.toFixed(2)}, source: ${candidate.entry.path}#L${candidate.entry.startLine})*`
      );
    }

    lines.push("");

    try {
      fs.appendFileSync(memoryPath, lines.join("\n"));
    } catch {
      // If MEMORY.md doesn't exist, create it
      fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
      fs.writeFileSync(memoryPath, `# Memory\n${lines.join("\n")}`);
    }
  }

  /**
   * Write/append DREAMS.md with phase summary.
   */
  private writeDreamSummary(
    promoted: ScoredCandidate[],
    skipped: ScoredCandidate[],
    totalCandidates: number
  ): string {
    const dreamsPath = path.join(this.pluginRoot, "DREAMS.md");
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const lines: string[] = [
      "",
      `## Deep Sleep — ${now}`,
      "",
      `Candidates: ${totalCandidates} | Promoted: ${promoted.length} | Skipped: ${skipped.length}`,
      "",
    ];

    if (promoted.length > 0) {
      lines.push("### Promoted to MEMORY.md");
      for (const c of promoted) {
        lines.push(
          `- **${c.entry.path}#L${c.entry.startLine}** — score: ${c.finalScore.toFixed(3)} (recalled ${c.entry.recallCount}x across ${c.entry.recallDays.length} days)`
        );
      }
      lines.push("");
    }

    if (skipped.length > 0 && skipped.length <= 10) {
      lines.push("### Skipped (below threshold)");
      for (const c of skipped.slice(0, 5)) {
        lines.push(
          `- ${c.entry.path}#L${c.entry.startLine} — score: ${c.finalScore.toFixed(3)} (recalled ${c.entry.recallCount}x)`
        );
      }
      lines.push("");
    }

    const summary = lines.join("\n");

    try {
      // Append to existing DREAMS.md
      if (fs.existsSync(dreamsPath)) {
        fs.appendFileSync(dreamsPath, summary);
      } else {
        fs.writeFileSync(
          dreamsPath,
          `# Dreams\n\n*Memory consolidation diary.*\n${summary}`
        );
      }
    } catch {
      // Non-fatal
    }

    return summary;
  }

  /**
   * Run full dreaming sweep (all 3 phases).
   * Returns deep result + REM themes + reflection prompt.
   */
  runFullSweep(options?: {
    minScore?: number;
    minRecallCount?: number;
    maxPromotions?: number;
    dryRun?: boolean;
  }): DreamResult & { themes: string[]; reflectionPrompt: string } {
    // Phase 1: Light — ingest signals, record reinforcements
    const light = this.runLight();

    // Phase 2: REM — extract themes, patterns, write REM block, record reinforcements
    const rem = this.runREM();

    // Phase 3: Deep — score candidates, promote to MEMORY.md, write diary
    const deep = this.runDeep(options);

    return {
      ...deep,
      themes: rem.themes,
      reflectionPrompt: rem.reflectionPrompt,
    };
  }

  /**
   * Get dreaming status summary.
   */
  status(): {
    recallEntries: number;
    phaseSignals: number;
    dreamsFileExists: boolean;
    lastDream: string | null;
  } {
    const entries = this.loadRecallState();
    const signals = this.loadPhaseSignals();
    const dreamsPath = path.join(this.pluginRoot, "DREAMS.md");
    const dreamsExists = fs.existsSync(dreamsPath);

    let lastDream: string | null = null;
    if (dreamsExists) {
      try {
        const content = fs.readFileSync(dreamsPath, "utf-8");
        const match = content.match(/## Deep Sleep — (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g);
        if (match) lastDream = match[match.length - 1].replace("## Deep Sleep — ", "");
      } catch {}
    }

    return {
      recallEntries: Object.keys(entries).length,
      phaseSignals: Object.keys(signals).length,
      dreamsFileExists: dreamsExists,
      lastDream,
    };
  }
}
