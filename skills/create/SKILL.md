---
name: create
description: Create a new agent from scratch in a new directory with personality files and bootstrap ritual. Triggers on /agent:create, "crear agente", "nuevo agente", "new agent", "create agent".
user-invocable: true
argument-hint: <agent-name>
---

# Create a New Agent

Create a new agent directory with personality files and a bootstrap ritual.

Each agent lives in its own folder. On first run, the agent discovers its identity through a conversational "birth certificate" (BOOTSTRAP.md) — just like OpenClaw.

## Steps

1. **Get the agent name** from the argument (e.g., `/agent:create isra`). If no name given, ask.

2. **Create a new directory** for the agent:
   ```bash
   mkdir -p ~/<agent-name>
   ```

3. **Copy the plugin files** from the current plugin installation:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/.claude-plugin ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/.mcp.json ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/package.json ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/server.ts ~/<agent-name>/
   cp -r ${CLAUDE_PLUGIN_ROOT}/hooks ~/<agent-name>/
   cp -r ${CLAUDE_PLUGIN_ROOT}/skills ~/<agent-name>/
   cp -r ${CLAUDE_PLUGIN_ROOT}/templates ~/<agent-name>/
   cp -r ${CLAUDE_PLUGIN_ROOT}/lib ~/<agent-name>/
   ```

4. **Copy templates** as the agent's initial files:
   ```bash
   cp ${CLAUDE_PLUGIN_ROOT}/templates/SOUL.md ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/templates/IDENTITY.md ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/templates/USER.md ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md ~/<agent-name>/
   cp ${CLAUDE_PLUGIN_ROOT}/templates/TOOLS.md ~/<agent-name>/
   ```

5. **Copy the bootstrap file** (the birth certificate):
   ```bash
   cp ${CLAUDE_PLUGIN_ROOT}/templates/BOOTSTRAP.md ~/<agent-name>/
   ```

6. **Create memory directory:**
   ```bash
   mkdir -p ~/<agent-name>/memory/.dreams
   echo '# Memory' > ~/<agent-name>/memory/MEMORY.md
   echo '{"version":1,"updatedAt":"","entries":{}}' > ~/<agent-name>/memory/.dreams/short-term-recall.json
   ```

7. **Tell the user** to open the new directory in Claude Code:
   ```sh
   cd ~/<agent-name> && claude
   ```
   
   On first launch the agent will:
   - See BOOTSTRAP.md in its context
   - Start a conversational bootstrap ritual
   - Discover its name, personality, and vibe through dialogue
   - Update IDENTITY.md, USER.md, SOUL.md
   - Delete BOOTSTRAP.md — completing the birth

## Important

- Agent names should be lowercase, no spaces (use hyphens)
- BOOTSTRAP.md triggers the first-run ritual — the agent "wakes up" and discovers who it is
- Once BOOTSTRAP.md is deleted, the agent is fully born and subsequent sessions load its personality normally
- Do NOT fill in IDENTITY.md or USER.md during creation — the bootstrap conversation does that
