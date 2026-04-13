# Command discovery — `list_commands`

Discover every command this agent can invoke, without relying on hardcoded lists. Scans the three skill install scopes plus the agent's own MCP tools and returns a live snapshot. Powers `/help` and any UI that wants to show "what can I do?".

## Why it exists

The `/help` skill used to hand-maintain a list of commands. Every time we shipped a skill, that list went stale. Every time a user installed a community skill via `/agent:skill install`, it wasn't listed. This tool reads the actual files on disk and tells you what's there right now.

## What it scans

| Scope | Directory | Notes |
|---|---|---|
| `plugin` | `./skills/<name>/SKILL.md` (workspace) | Built-in + imported via `/agent:skill install` |
| `project` | `.claude/skills/<name>/SKILL.md` | Standard Claude Code project-level skills |
| `user` | `~/.claude/skills/<name>/SKILL.md` | Standard Claude Code user-level skills |
| `mcp` | — | MCP tools the agent has, from the server's tool directory |

## MCP tool

| Tool | Purpose |
|---|---|
| `list_commands({ scope?, includeInternal?, includeTools?, format? })` | Returns live command inventory |

### Parameters

| Param | Default | Effect |
|---|---|---|
| `scope` | `"all"` | `"plugin"` / `"project"` / `"user"` / `"mcp"` / `"all"` |
| `includeInternal` | `false` | Include skills with `user-invocable: false` — usually noise for humans |
| `includeTools` | `true` | Add MCP tools as `scope: "mcp"` entries. Turn off for a user-facing `/help`. |
| `format` | `"table"` | `"table"` grouped by scope, `"compact"` one line per command, `"json"` structured |

## What each record contains

```json
{
  "name": "agent:doctor",
  "description": "Run diagnostic checks on the agent workspace...",
  "triggers": ["/agent:doctor", "diagnóstico", "doctor", "health check", "..."],
  "scope": "plugin",
  "userInvocable": true,
  "argumentHint": "[--fix]",
  "source": "/Users/you/my-agent/skills/doctor/SKILL.md"
}
```

- **triggers**: parsed from the description. We look for `Triggers on X, Y, Z.` (case-insensitive) and split on commas. Quoted phrases stay intact.
- **source**: absolute path to the file, or `"mcp"` for MCP tools. Useful for debugging ("which file provides this command?").

## When triggers come back empty

If a skill's description doesn't follow the `Triggers on ...` convention, the command is still listed — just with `triggers: []`. The ClawCode built-ins all follow the convention; community skills may or may not. If you want triggers to show up in `/help`, keep the convention in your skill's description.

## Formats

### `table` — grouped markdown

```
## Core + imported (./skills/) (13)

- **create**: Bootstrap a new agent with personality files — triggers: `/agent:create`, `nuevo agente`, ...
- **doctor**: Run diagnostic checks... — triggers: `/agent:doctor`, `diagnóstico`, ...

## MCP tools (agent-invocable) (15)

- **memory_search**: Search memory with BM25, temporal decay, MMR.
- **memory_context**: Active-memory turn-start reflex...
```

### `compact` — one line per command

```
/agent:create — Bootstrap a new agent with personality files
/agent:doctor — Run diagnostic checks on the agent workspace
memory_search — Search memory with BM25, temporal decay, MMR.
```

Good for WhatsApp / Telegram where mobile screens clip wide tables.

### `json` — structured

Full array of records. Use this when building a WebChat command palette or exporting documentation.

## Integration with `/help`

The `/help` skill now calls `list_commands` instead of holding its own table. That means:

- A new skill installed via `/agent:skill install` appears in `/help` immediately
- Removing a skill makes it disappear from `/help` without any manual edit
- The output adapts to the channel (compact on mobile, table on CLI)

## Implementation

| File | Role |
|---|---|
| `lib/command-discovery.ts` | `discoverCommands`, `parseTriggers`, `formatCommandsTable`, `formatCommandsCompact` |
| `server.ts` | `list_commands` MCP tool, plus the MCP tool directory used as input |
| `skills/help/SKILL.md` | Calls `list_commands` instead of hardcoding |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A skill installed via `/agent:skill install` doesn't show up | AGENTS.md wasn't updated (rare) or the SKILL.md is malformed | Check the SKILL.md has `name` and `description` in frontmatter |
| MCP tools missing from output | `includeTools: false` was passed | Call with `includeTools: true` or omit |
| Triggers list is empty for a skill I expect to trigger | Description doesn't use the `Triggers on ...` convention | Update the description to follow the pattern |
| Duplicates across scopes | Same skill name exists in plugin AND project scope | Decide which one to keep; remove the other with `/agent:skill remove` |
