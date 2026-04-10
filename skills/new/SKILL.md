---
name: new
description: Start a new session — save summary to memory first. Works from CLI or messaging channels. Triggers on /new, /agent:new, "nueva sesión", "new session", "empezar de nuevo".
user-invocable: true
---

# Start a New Session

Save the current session context to memory, then prepare for a fresh session.

## Why this exists

- **On CLI**: Native `/clear` drops conversation. Without saving first, the agent forgets everything.
- **On WhatsApp/Telegram**: There's no session concept per se, but the user might want to "close" a conversation topic. Save the summary so next time they chat, the agent has context.

## Steps

1. **Detect surface** (CLI vs messaging channel).

2. **Summarize the current session** — concisely (5-15 bullet points):
   - What was discussed
   - Decisions made
   - Facts learned about the user
   - Tasks completed
   - Open items

3. **Write the summary** to `memory/YYYY-MM-DD.md` (today's date). APPEND only:
   ```bash
   DATE=$(date +%Y-%m-%d)
   TIME=$(date +%H:%M)
   ```
   
   Format:
   ```markdown
   
   ## Session summary (<TIME>)
   
   - <bullet>
   - <bullet>
   
   ### Open items
   - <pending>
   ```
   
   Use `cat >> memory/$DATE.md << 'EOF'` or similar to append.

4. **Verify** the file was updated (cat the last few lines).

5. **Respond** per surface:

### CLI
```
✅ Session summary saved to memory/<DATE>.md

Now run /clear to start a fresh session. Your next session will
remember this via memory_search.
```

### WhatsApp
```
✅ *Resumen guardado*

Todo apuntado en memory/<DATE>.md. La próxima vez que me escribas, tendré este contexto.

¿Algo más o cerramos esta conversación?
```

### Telegram
```
✅ **Session saved**

Summary stored in memory/<DATE>.md. Next conversation will have this context.
```

6. **Do NOT** try to invoke `/clear` — you can't. Just tell the user (CLI) or move on (messaging).

## Important

- APPEND only — never overwrite.
- If the session was trivial (just a greeting, no meaningful content), say "nothing worth saving" and skip.
- On messaging channels, the "session" concept is fuzzy. Just save the recent conversation context and continue.
- This is the agent-aware equivalent of OpenClaw's `/new` command.
