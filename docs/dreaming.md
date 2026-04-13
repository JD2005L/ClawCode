# Dreaming — memory consolidation

Every night at 3 AM local time, the agent "dreams": it reviews which memories were recalled recently, scores them with weighted signals, and promotes the highest-scoring ones from daily logs to the curated long-term `MEMORY.md`. A human-readable diary is written to `DREAMS.md`.

The design mirrors OpenClaw's 3-phase dreaming loop.

## Why dreaming exists

Daily logs (`memory/YYYY-MM-DD.md`) accumulate fast and lose relevance with distance. Without curation, the index fills with stale chatter and recall gets worse. Dreaming does what a human brain does during sleep — picks what mattered, moves it to long-term storage, lets the rest fade.

It does this purely with search-trace analytics — no LLM calls, no external APIs. Free, fast, deterministic.

## The 3 phases

### Phase 1 — Light

Reads `memory/.dreams/short-term-recall.json` (every prior `memory_search` hit was logged here with score, timestamp, concept tags). For each recalled chunk:

- Records a **reinforcement signal** (recency-decayed boost, 7-day half-life)
- Deduplicates by `path:startLine-endLine`
- Appends to `phase-signals.json` to accumulate across runs

Also reads the last ~7 daily files to feed Phase 2.

### Phase 2 — REM

Extracts **recurring themes** from the recent daily logs + recall data. Uses keyword frequency across the corpus to identify concepts the agent keeps returning to.

Doesn't promote anything — just produces a list of themes that Phase 3 uses for the `queryDiversity` signal and the diary narrative.

### Phase 3 — Deep

Scores every candidate (every recalled chunk) with 6 weighted signals and promotes the top ones.

## The 6 signals

Each candidate gets a score in `[0, 1]` per signal. The final score is a weighted sum.

| Signal | Weight | What it measures |
|---|---|---|
| **Relevance** | 0.30 | Max BM25 score the chunk ever achieved in a search |
| **Frequency** | 0.24 | How many times the chunk was recalled (normalized) |
| **Query diversity** | 0.15 | How many DIFFERENT queries hit it — more diverse = more generally useful |
| **Recency** | 0.15 | Time-decayed weight on the last recall + reinforcement from Phase 1 |
| **Consolidation** | 0.10 | Recalls spread across multiple DAYS — proves durable relevance, not one hot session |
| **Conceptual richness** | 0.06 | Number of distinct concept tags associated with the chunk |

Weights sum to 1.0. Changing them means editing `WEIGHTS` in `lib/dreaming.ts`.

Signals were chosen to balance: "search engine says this is relevant" (Relevance) with "user actually returns to this" (Frequency + Consolidation) with "applies broadly" (Query Diversity + Conceptual Richness) with "still current" (Recency).

## Promotion thresholds

A candidate must pass ALL of these to be promoted:

| Threshold | Default | Meaning |
|---|---|---|
| `minScore` | 0.3 | Final weighted score must exceed this |
| `minRecallCount` | 2 | Must have been recalled at least this many times |
| `minUniqueQueries` | 1 | Must have surfaced on at least this many different queries |
| `maxPromotions` | 10 | Cap per run to prevent MEMORY.md bloat |

These are deliberately conservative — we'd rather miss a good candidate this run than pollute MEMORY.md with flukes. Next run will catch what was missed.

Thresholds are passed to `dream(action: "run", minScore: ..., ...)` if you want to tune for a specific run, but in practice you shouldn't touch them.

## What gets promoted

A single block written to `MEMORY.md`:

```markdown
## Promoted by dreaming — 2026-04-12

- **memory/2026-04-09.md#L12-L15** (score 0.72, 5 recalls across 4 days)
  > JC's dog Cookie weighs 12kg and loves carrots. Allergic to shrimp.

- **memory/2026-04-10.md#L3-L6** (score 0.64, 3 recalls across 2 days)
  > Meeting with Eva — decided to rebuild the ingest pipeline with parquet.
```

The original chunk stays in its daily file (dreaming doesn't delete). Promotion = copy the content into MEMORY.md so future searches find it there too, with no decay penalty (MEMORY.md is evergreen).

## The diary — `DREAMS.md`

After Phase 3, a human-readable summary is appended to `DREAMS.md` at the workspace root:

```markdown
## 2026-04-12 03:00 — Dream

Themes tonight: cookie, dog, eva, pipeline, shrimp.

Promoted 2 memories to MEMORY.md:
1. Cookie's weight and allergies (score 0.72)
2. Pipeline rebuild decision with Eva (score 0.64)

Skipped 8 candidates below threshold.

Reflection: the agent keeps returning to dog-care facts and the Eva project.
Recent signals suggest JC is planning meals (shrimp allergy surfaced) and mid-sprint on the pipeline rework.
```

This is for you, not the agent. Readable. A retrospective of what the agent noticed mattered.

## Cron integration

On first session start, two crons are auto-created if missing (by `SessionStart` hook + CLAUDE.md instruction):

```
*/30 * * * *  → /agent:heartbeat   (memory consolidation during active hours)
0 3 * * *     → dream(action='run') (nightly full dream cycle)
```

The dreaming cron runs only while Claude Code is open (or the agent is running as a service — see [service.md](service.md)). If the machine is off at 3 AM, the next open session triggers catch-up (the agent checks when the last dream ran and can manually invoke `dream(action='run')` if needed).

## Running on demand

| Invocation | What happens |
|---|---|
| `dream(action: "status")` | Shows recall count, phase signals accumulated, last dream timestamp, DREAMS.md state |
| `dream(action: "dry-run")` | Full 3-phase run WITHOUT writing to MEMORY.md or DREAMS.md. Prints what WOULD be promoted. |
| `dream(action: "run")` | Full 3-phase run. Writes MEMORY.md + DREAMS.md. |

Use `dry-run` to preview before tuning thresholds or before a manual invocation.

## Config

```json
{
  "dreaming": {
    "schedule": "0 3 * * *",
    "timezone": "America/Santiago"
  }
}
```

Both keys are advisory — the actual cron is created via `CronCreate` by the agent on first run. Changing them here reports the new schedule in status but doesn't automatically reschedule; use `/agent:crons` to re-import.

## Implementation

| File | Role |
|---|---|
| `lib/dreaming.ts` | `DreamEngine` class: loadPhaseSignals, computeSignals, computeFinalScore, runLight, runREM, runDeep, runFullSweep |
| `server.ts` | `dream` MCP tool (status / run / dry-run) |
| `templates/HEARTBEAT.md` | Instructions for the 30-min heartbeat (not dream-specific but runs between dream cycles) |
| `memory/.dreams/short-term-recall.json` | Written by `trackRecall` in `server.ts` after every `memory_search` |
| `memory/.dreams/phase-signals.json` | Written by Light phase, read by Deep phase |

## Dream tracking (how recalls get recorded)

After every `memory_search` call, `trackRecall` appends to:

- `memory/.dreams/events.jsonl` — one line per recall event, for audit
- `memory/.dreams/short-term-recall.json` — aggregated per chunk, with:
  - `recallCount` — total times hit
  - `totalScore` / `maxScore` — sum and peak BM25 scores
  - `firstRecalledAt` / `lastRecalledAt` — timestamps
  - `recallDays` — set of YYYY-MM-DD dates (for consolidation signal)
  - `conceptTags` — top 5 keywords from the hit's snippet

This is the data Phase 1 ingests. No other tool writes here — only `memory_search`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `dream(action: "status")` shows `recallEntries: 0` | No searches yet | Use the agent; any `memory_search` populates this |
| Dream runs but nothing promoted | Candidates below `minScore` threshold | Normal. Check `dry-run` to see scores. If consistently low, memory is either new or poorly recalled — wait or query more broadly. |
| DREAMS.md grows forever | Expected | It's append-only. Rotate or archive manually if it gets large. |
| Dreaming cron doesn't fire | Machine off at 3 AM, or cron wasn't created | Check with `/agent:doctor`. Run `dream(action: "run")` manually to catch up. |
| Same chunks promoted repeatedly | MEMORY.md wasn't consulted, or decay pushed them back out | MEMORY.md has no decay — once promoted they stay. If you see dupes, it's a bug. Report. |
| Promoted text doesn't match daily log | Chunk boundaries changed after re-index | Expected if the daily file was edited between dream runs. Next run reconciles. |
