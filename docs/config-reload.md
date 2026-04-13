# Config reload — when `/mcp` is needed and when it isn't

ClawCode watches `agent-config.json` on disk. Most changes apply the next time you use the feature — no `/mcp` needed. A small set of keys that are used to bootstrap long-lived state still require `/mcp` to take effect; when you change one, the agent gets a notification telling you so.

## How it works

- The MCP server opens a filesystem watcher on `agent-config.json` at startup.
- When you save the file, the watcher waits 300 ms (in case your editor writes several times during save) and re-parses the file.
- If the JSON is malformed, the previous config stays in effect. No crash, nothing gets dropped.
- If a "critical" key changed (see below), the server sends a logging notification — it shows up in Claude Code's logs and the agent can surface it in chat.

The watcher is event-driven — it does not poll. While the file sits still, there's no work happening.

## Hot-reloadable (apply immediately, no `/mcp`)

These values are read on every relevant tool call, so editing the file is enough:

| Key | What it tunes |
|---|---|
| `memory.citations` | Citation mode (`auto` / `on` / `off`) |
| `memory.builtin.temporalDecay` | Builtin search recency weighting on/off |
| `memory.builtin.halfLifeDays` | Recency half-life |
| `memory.builtin.mmr` | Diversity re-ranking on/off |
| `memory.builtin.mmrLambda` | Relevance vs. diversity balance |
| `memoryContext.enabled` | Active-memory tool on/off |
| `memoryContext.maxResults` | Chunks in the active-memory digest |
| `memoryContext.includeRecency` | Recency boost on/off |
| `memoryContext.halfLifeDays` | Active-memory half-life |
| `heartbeat.activeHours.*` | Heartbeat window |
| `heartbeat.schedule` | Heartbeat cron expression (for display — the cron itself is separate) |
| `dreaming.schedule` | Dreaming cron (same caveat — cron runtime is separate) |

## Requires `/mcp` (critical keys)

These values are read once to initialize long-lived state. Changing them without a reload has no effect until the MCP server restarts.

| Key | Why it's bootstrap-only |
|---|---|
| `memory.backend` | Picks whether to initialize QMD or builtin-only. Switching in-flight would leave caches inconsistent. |
| `memory.extraPaths` | The SQLite index is built with these paths at startup. |
| `http.enabled` | The HTTP server is either bound or not. Flipping live would leave the port in an ambiguous state. |
| `http.port` | Port is bound at startup. |
| `http.host` | Same. |
| `http.token` | Reloading silently could let old clients with the stale token in. Force a restart so the change is visible. |

When you change one of these, the agent receives a log notification like:

> Config change to `http.port` requires `/mcp` to apply. Other changes (if any) applied live.

The agent can then pass that along to you.

## What is NOT watched

Only `agent-config.json`. Personality and instruction files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `CLAUDE.md`) are injected into the MCP server's `instructions` once at startup. Editing them requires `/mcp`. We don't attempt to hot-reload those — Claude Code wouldn't pick the new instructions up without reconnecting anyway.

## Failure modes

| Scenario | Behavior |
|---|---|
| You save malformed JSON | Previous config stays in effect. No crash. Fix the JSON and save again. |
| You delete `agent-config.json` | Previous config stays in effect until `/mcp`, at which point defaults kick in. |
| You atomically replace the file (editor does `rename`) | Watched via the parent directory so atomic replaces still fire the reload. |
| The OS doesn't support file watching (rare) | The watcher silently fails. `/mcp` still works as the universal reload mechanism. |

## Why 300 ms debounce

Editors often write a config file in more than one system call (truncate + write, or temp file + rename). Without debounce we'd reload during the write, possibly reading half the file. 300 ms is long enough to collapse any normal save into a single reload, short enough to feel instant.

## Implementation

| File | Role |
|---|---|
| `lib/live-config.ts` | `initLiveConfig`, `getLiveConfig`, `startConfigWatcher`, `stopConfigWatcher`, critical-key diff |
| `server.ts` | Calls `getLiveConfig()` inside each tool handler for tunables; starts the watcher at boot; surfaces critical-change notifications |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Change to `maxResults` doesn't take effect | You're looking at an old tool response in your scrollback | Trigger the tool again — the next call reads the new value |
| Agent warned about `/mcp` needed, then you reverted — still warned | The warning fires on the change event, not on steady state | Just run `/mcp`; the reverted value is applied either way |
| `http.enabled` flipped to `true` but no HTTP server | Critical key — needs `/mcp` | Run `/mcp` |
| Editing the file seems to do nothing | Watcher didn't attach (rare OS limitation) | `/mcp` always works as a fallback |
