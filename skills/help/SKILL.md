---
name: help
description: List available commands the user can invoke. Works from CLI or messaging channels. Triggers on /help, /commands, /agent:help, "qué comandos puedo usar", "help commands".
user-invocable: true
---

# Help — list commands

Show a concise, LIVE list of all available commands. Never hardcode — always pull from the `list_commands` MCP tool so recently installed or removed skills are reflected.

## Steps

1. **Detect the surface.** If the incoming message has a `<channel source="...">` marker, you're on a messaging channel. Otherwise you're on CLI or WebChat.

2. **Call `list_commands`** with the right format:
   - **CLI / WebChat:** `list_commands({ format: "table", includeTools: false })` — grouped markdown, readable.
   - **Messaging (WhatsApp, Telegram, Discord, iMessage):** `list_commands({ format: "compact", includeTools: false })` — one line per command, mobile-friendly.

   Leave `includeTools: false` for the user-facing help — MCP tools are agent-invoked, not user-typed. Users who want the internals can ask "what MCP tools do you have?" and you call with `includeTools: true`.

3. **Print the output** from the tool as-is. Do not rewrite or reorder.

4. **Adapt formatting to the channel** after the tool output:
   - WhatsApp: strip `**bold**` → `*bold*`, remove markdown headers if too noisy
   - Telegram: keep `**bold**` or convert to HTML
   - Discord: markdown as-is
   - iMessage: strip markdown to plain text
   - CLI / WebChat: markdown as-is

5. **Append a short native-tools note** at the end (only on CLI):
   ```
   Native Claude Code commands (CLI only): /status /usage /cost /compact /clear /mcp /model /help
   ```

## Example flows

### CLI user asks `/help`

Call `list_commands({ format: "table", includeTools: false })`. Print the returned markdown. Append the native-tools note.

### WhatsApp user says "what can you do?"

Call `list_commands({ format: "compact", includeTools: false })`. Convert any `**bold**` to `*bold*`. Don't include the native-tools note (doesn't apply).

## Notes

- `/help` and `/commands` are aliases.
- Keep the response short on mobile channels. `compact` format handles that.
- If the user wants the internals ("tools", "MCP"), call with `includeTools: true` so they see them too.
- If nothing comes back, something's wrong with the install — suggest `/agent:doctor`.
