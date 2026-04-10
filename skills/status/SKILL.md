---
name: status
description: Show agent status — identity, memory stats, dream tracking. Works from CLI or messaging channels (WhatsApp, Telegram, etc.). Triggers on /status, /agent:status, "status del agente", "agent status", "cómo estás".
user-invocable: true
---

# Agent Status

Show a status card with agent-specific info. Works from CLI or from any messaging channel.

## Steps

1. **Detect the surface**:
   - CLI: no `<channel source="...">`
   - Messaging: check the `<channel source="...">` metadata for platform

2. **Gather data**:
   - Call `agent_status` MCP tool → identity, backend, files/chunks indexed, dream stats
   - Call `agent_config` MCP tool with `action='get'` → memory backend, heartbeat schedule, dreaming schedule
   - Bash: `date` for current time
   - Bash: `cat .claude/scheduled_tasks.json 2>/dev/null` — to count active crons
   - Bash: `ls -t memory/*.md 2>/dev/null | head -1` — most recent daily log

3. **Format the output** per surface:

### CLI
```
🤖 <Name> <emoji>
Session: local · updated just now
Memory: <N> files, <M> chunks · <backend> (<features>)
Dreams: <X> unique memories recalled
Crons: heartbeat <schedule>, dreaming <schedule>
Last daily log: <date>

For tokens/cost: /usage or /cost
For MCP servers: /mcp
```

### WhatsApp (single *bold*, no headers)
```
🤖 *<Name>* <emoji>

*Memory:* <N> files, <M> chunks
*Backend:* <backend>
*Dreams:* <X> memories recalled
*Crons:* heartbeat ✓, dreaming ✓

Last log: <date>
```

### Telegram (**bold**)
```
🤖 **<Name>** <emoji>

**Memory:** <N> files, <M> chunks
**Backend:** <backend>
**Dreams:** <X> memories recalled
**Crons:** heartbeat ✓, dreaming ✓

Last log: <date>
```

4. **Reply tool usage**: If on a messaging channel, use the channel's `reply` tool (e.g., `reply` from whatsapp plugin). If on CLI, just output the text.

## Important

- NEVER say "I'm Claude" — use the agent's name from IDENTITY.md.
- On WhatsApp/Telegram, the agent responds via the messaging plugin's `reply` tool AND responds in the terminal too (they go to different places).
- If memory is empty or crons not set up, say so explicitly.
- This is the agent-aware equivalent of OpenClaw's `/status` command.
