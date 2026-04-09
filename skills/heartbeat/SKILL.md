---
name: heartbeat
description: Run agent heartbeat checks — memory consolidation, proactive checks, session review. Triggers on /agent:heartbeat, "heartbeat", "heartbeat check", "periodic check", "consolidar memoria".
user-invocable: true
---

# Heartbeat Check

Run the agent's periodic checks and memory consolidation.

## Active Hours

Heartbeats should only run during the user's active hours. Check `agent-config.json` for:
```json
"heartbeat": {
  "activeHours": {
    "start": "08:00",
    "end": "23:00",
    "timezone": "America/Santiago"
  }
}
```

If current time is outside active hours, skip the heartbeat silently.

## Steps

1. **Check active hours** — if outside the configured window, do nothing.

2. **Read HEARTBEAT.md** from the project root (if it exists) for specific check instructions.

3. **Review recent daily files:**
   - Read `memory/YYYY-MM-DD.md` (today) and yesterday's
   - Look for items that need attention, follow-ups, or consolidation

4. **Memory consolidation:**
   a. Read through recent daily files (last 3 days)
   b. Identify significant events, lessons, or insights worth keeping long-term
   c. Update `memory/MEMORY.md` with distilled learnings
   d. Remove outdated info from MEMORY.md

   Think of it like reviewing a journal and updating your mental model.
   Daily files = raw notes. MEMORY.md = curated wisdom.

5. **Dream review** (optional):
   - Run `dream(action='status')` to check dreaming state
   - If there are high-recall memories not yet in MEMORY.md, note them

6. **Report findings** to the user only if something needs attention.
   If nothing noteworthy, do nothing — don't announce routine heartbeats.

## Scheduling

The heartbeat cron is created automatically on first session:
- Default: every 30 minutes
- Only runs while Claude Code is open and REPL is idle
- Durable (survives Claude Code restarts within 7 days)

To change schedule: update via `/agent:settings` and recreate the cron.

## Nightly Dreaming

A separate nightly cron (3 AM) triggers `dream(action='run')` for full memory consolidation.
This is independent of heartbeats — dreaming handles promotion to MEMORY.md via weighted scoring.
