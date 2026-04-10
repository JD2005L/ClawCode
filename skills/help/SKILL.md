---
name: help
description: List available commands the user can invoke. Works from CLI or messaging channels. Triggers on /help, /commands, /agent:help, "qué comandos puedo usar", "help commands".
user-invocable: true
---

# Help — list commands

Show a concise list of all available commands. Adapt the output to the current surface (CLI, WhatsApp, Telegram, etc.).

## Steps

1. **Detect the surface**. If there's a `<channel source="...">` in the incoming message, you're on a messaging channel. Otherwise you're on CLI.

2. **Format the output** according to the surface:
   - **CLI**: normal markdown
   - **WhatsApp**: single `*bold*`, no headers
   - **Telegram**: `**bold**` or HTML
   - **Discord**: markdown
   - **iMessage**: plain text (no markdown)

3. **List the commands**:

### Agent commands (available everywhere)

```
/status     — Agent status & memory stats
/usage      — Memory and resource usage
/whoami     — Who you are and which channel
/help       — This message
/new        — Start new session (saves summary first)
/compact    — Save context before compaction
/memory     — Memory stats
/context    — What's loaded in context
```

### Agent skills (CLI + ask the agent)

```
/agent:create     — Create a new agent
/agent:import     — Import from OpenClaw
/agent:crons      — Import crons
/agent:heartbeat  — Manual heartbeat
/agent:settings   — Config (memory backend, QMD)
/agent:messaging  — Set up WhatsApp/Telegram/Discord
```

### Native Claude Code (CLI only — NOT on messaging channels)

```
/status /usage /cost /compact /clear /mcp /model /help
```

On messaging channels, use the agent commands above (without `/agent:` prefix) — the agent will handle them.

## Notes

- On WhatsApp, native Claude Code commands (like `/compact`) don't work. The agent recognizes the text and acts accordingly.
- `/help` and `/commands` are aliases.
- Keep the response short on mobile channels.
