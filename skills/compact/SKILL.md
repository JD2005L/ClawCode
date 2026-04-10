---
name: compact
description: Force memory flush before context compaction — save important info to daily log. Works from CLI or messaging channels. Triggers on /compact, /agent:compact, "compactar", "save and compact".
user-invocable: true
---

# Agent-Aware Compact

Save important session context to memory before context compression.

## Context

- **CLI**: The user is about to run native `/compact`. Save first to prevent information loss.
- **Messaging channels**: There's no "compact" concept — but the user might want to force a checkpoint of what's been discussed. Treat it as "save everything important now".

## Steps

1. **Detect surface** (CLI vs messaging).

2. **Scan for information worth keeping**:
   - Decisions made this session
   - Facts the user shared (names, preferences, IDs, dates)
   - Tasks completed or pending
   - Problems solved and solutions
   - Corrections/clarifications from the user

3. **Write memory flush entry** to `memory/YYYY-MM-DD.md`. APPEND only:
   ```bash
   DATE=$(date +%Y-%m-%d)
   TIME=$(date +%H:%M)
   ```
   
   Format:
   ```markdown
   
   ## Memory flush (<TIME>) — manual
   
   ### Decisions
   - ...
   
   ### Facts learned
   - ...
   
   ### Open items
   - ...
   ```

4. **Verify** the write.

5. **Respond** per surface:

### CLI
```
✅ Memory flush complete. Saved to memory/<DATE>.md

Now run /compact to compress the session. The flushed info is
searchable via memory_search.
```

### WhatsApp
```
✅ *Guardado*

Los puntos clave están en memory/<DATE>.md. Sigo atento a lo siguiente.
```

### Telegram
```
✅ **Saved**

Key points stored in memory/<DATE>.md. Ready for the next message.
```

6. **Do NOT** invoke `/compact` yourself — you can't. On CLI, tell the user. On messaging, just save and continue.

## Important

- APPEND only, never overwrite.
- If nothing substantive to save, say so: "Nada importante que guardar, puedes seguir normal".
- The PreCompact hook fires automatically on native auto-compaction. `/compact` is the manual version.
- This is the agent-aware equivalent of OpenClaw's `/compact` command.
