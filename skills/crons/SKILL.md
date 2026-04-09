---
name: crons
description: Import OpenClaw crons as Claude Code local scheduled tasks, or list current crons. Triggers on /agent:crons, "importar crons", "traer crons", "import crons", "list crons".
user-invocable: true
---

# Import Crons

Convert OpenClaw cron jobs into Claude Code **local scheduled tasks** using the `CronCreate` tool.

Local crons run on the user's machine with full access to files, MCP servers (including WhatsApp), and all Claude Code tools. This is the closest equivalent to OpenClaw's cron system.

## Understanding the formats

### OpenClaw cron (source: `~/.openclaw/cron/jobs.json`)
```json
{
  "id": "uuid",
  "name": "Job Name",
  "enabled": true,
  "schedule": { "kind": "cron", "expr": "0 14 * * 3,6", "tz": "America/Santiago" },
  "payload": { "kind": "agentTurn", "message": "prompt here", "model": "opus" },
  "delivery": { "mode": "announce", "channel": "whatsapp" }
}
```

### Claude Code local cron (target: `CronCreate` tool → `.claude/scheduled_tasks.json`)
- Standard 5-field cron expression (minute hour day month weekday)
- Runs in **local timezone** (no UTC conversion needed)
- Full access to local files, MCP servers, tools
- `durable: true` → persists across Claude Code restarts
- Executes while REPL is idle (between user queries)
- Default expiration: 7 days (configurable)

## Steps

1. **Read OpenClaw crons:**
   ```bash
   cat ~/.openclaw/cron/jobs.json 2>/dev/null
   ```

2. **Filter** by the active agent's ID if applicable. Show all if no filter.

3. **For each cron, map the fields:**

   | OpenClaw field | CronCreate field | Notes |
   |---|---|---|
   | `schedule.expr` | `schedule` (cron expr) | Direct — both use 5-field cron. Keep timezone as-is (local cron uses local tz) |
   | `schedule.kind: "at"` | One-shot cron | Convert ISO timestamp to nearest cron expression |
   | `schedule.kind: "every"` | Interval cron | `everyMs` → `*/N * * * *` |
   | `payload.message` | `prompt` | The text Claude will execute |
   | `name` | `name` | Direct mapping |
   | `delivery.channel: "whatsapp"` | Include in prompt | Add "Send result via WhatsApp reply tool" to the prompt |

4. **Show preview** of the conversion to the user:
   ```
   OpenClaw: "Ideas Check-in" | cron 0 14 * * 3,6 | isolated | opus
   Local:    "Ideas Check-in" | cron 0 14 * * 3,6 | durable  | prompt: "..."
   ```

5. **Adapt prompts** for Claude Code context:
   - Replace `sessions_spawn` references → "Use the Agent tool"
   - Replace `message tool` references → "Use the WhatsApp reply MCP tool"  
   - Replace `memory_search`/`memory_get` → "Read memory files directly"
   - Add agent context: "You are running as agent [name]. Read your SOUL.md and USER.md for context."

6. **After user confirmation**, create each cron using the `CronCreate` tool:
   - Set `durable: true` so it survives restarts
   - Use the adapted prompt

7. **Report** which crons were created, with their schedules.

## Delivery mapping

OpenClaw crons have a `delivery` field that determines where results go:

| OpenClaw delivery | Claude Code equivalent |
|---|---|
| `mode: "announce"` + `channel: "whatsapp"` | Add to prompt: "Send the result to WhatsApp using the reply tool" |
| `mode: "announce"` + `channel: "telegram"` | Add to prompt: "Send the result to Telegram using the telegram MCP tools" |
| `mode: "none"` | No delivery instruction needed — cron runs silently |
| `mode: "webhook"` | Add to prompt: "POST the result to [webhook URL]" |

## Listing current crons

If the user asks to list crons (not import), use `CronList` to show existing local scheduled tasks.

## Important notes

- Local crons expire after 7 days by default — for permanent crons, the user may need to recreate periodically
- Crons execute while the REPL is idle — Claude Code must be running for them to fire
- Unlike OpenClaw's daemon, Claude Code crons don't fire when Claude Code is closed
- `durable: true` means the cron persists to disk and survives Claude Code restarts within the same project
