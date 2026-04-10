---
name: usage
description: Show usage — agent memory usage + where to find session token usage. Works from CLI or messaging channels. Triggers on /usage, /agent:usage, "uso del agente", "agent usage".
user-invocable: true
---

# Agent Usage

Show resource usage for the agent. Works from CLI or messaging channels.

## Steps

1. **Detect surface** (CLI vs messaging channel).

2. **Gather stats**:
   - Call `agent_status` MCP tool → files, chunks, dream count
   - Bash: `du -sh memory/ 2>/dev/null | awk '{print $1}'` → memory dir size
   - Bash: `find memory/ -maxdepth 1 -name "*.md" ! -name ".*" 2>/dev/null | wc -l | tr -d ' '` → daily log count
   - Bash: `ls -la memory/.memory.sqlite 2>/dev/null | awk '{print $5}'` → SQLite index size
   - Bash: `wc -l memory/.dreams/events.jsonl 2>/dev/null | awk '{print $1}'` → dream events count

3. **Format output** per surface:

### CLI
```
📊 Resource Usage

Memory:
  Directory: <du>
  Daily logs: <N> files
  MEMORY.md: <size>
  SQLite index: <size>

Dreams:
  Events logged: <count>
  Unique memories: <from agent_status>

For session tokens/cost: /usage /cost /stats
```

### WhatsApp
```
📊 *Resource Usage*

*Memory:* <du>
*Logs:* <N> files
*Dreams:* <count> events, <unique> memories

Session tokens: use CLI /usage
```

### Telegram
```
📊 **Resource Usage**

**Memory:** <du>
**Logs:** <N> files
**Dreams:** <count> events, <unique> memories

Session tokens: use CLI /usage
```

4. **Reply tool** if on messaging channel.

## Important

- If memory directory is huge (> 500 MB), suggest cleanup or archival.
- Session tokens/cost are NOT available via the agent — they're CLI-only.
- This is the agent-aware equivalent of OpenClaw's `/usage` command.
