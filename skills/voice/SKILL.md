---
name: voice
description: Voice — text-to-speech and transcription. Triggers on /agent:voice, /agent:voice status, /agent:voice setup, /agent:voice test, "configurar voz", "prueba voz", "voice setup", "speak this", "read this aloud", "transcribe audio".
user-invocable: true
argument-hint: status|setup|test
---

# Voice — TTS and transcription

Set up and test the agent's voice backends. Voice is OPTIONAL — off by default. See `docs/voice.md` for the full reference including channel-plugin precedence.

## Dispatch

| User says | Action |
|---|---|
| `/agent:voice` (no arg) or `/agent:voice status` | Call `voice_status` and print the card |
| `/agent:voice setup` | Guided setup (see flow below) |
| `/agent:voice test` | Call `voice_speak({ text: "Hola, soy <name>. Esta es una prueba.", ... })` using the user's language, report the path |

The agent invokes `voice_speak` / `voice_transcribe` directly when it needs to produce or consume audio during regular conversation. This skill is only for setup and diagnostics.

## Setup flow

1. **Call `voice_status({ format: "json" })`** to see current state.
2. **If no TTS backend is available**, suggest in order of preference:
   - **sag (recommended):** *"Run `brew install steipete/tap/sag`. It's a small wrapper around ElevenLabs with good voice-prompting conventions."*
   - **OpenAI TTS:** *"Set `export OPENAI_API_KEY=...` in your shell rc (`~/.zshrc` or `~/.bashrc`). Then restart the agent."*
   - **macOS `say`:** *"Built in on macOS. Sounds robotic but zero setup. No action needed — will be used as fallback."*
3. **If sag is installed but `ELEVENLABS_API_KEY` is missing**, instruct: *"Get a key from https://elevenlabs.io. Add `export ELEVENLABS_API_KEY=sk_...` to your shell rc. Restart the agent."*
4. **If the user also wants STT**, same logic: recommend `whisper-cli` (brew install whisper-cpp, offline, free) or OpenAI Whisper API (same OPENAI_API_KEY).
5. **Enable voice** in config:
   - Tell the user: *"I'll set `voice.enabled: true` in your config. Run `agent_config(action='set', key='voice.enabled', value='true')` or edit `agent-config.json` directly."*
   - (You MAY call `agent_config` for them after they confirm.)
6. **If the `sag` skill is in an OpenClaw workspace** (`~/.openclaw/workspace*/skills/sag/`), offer: *"I see you have the `sag` skill in an OpenClaw workspace. Want me to install it into this agent? Run `/agent:skill install <that path>`."*
7. **Mention WhatsApp precedence** if the WhatsApp plugin is configured:
   - If `voice_status` reports `whatsapp.audioEnabled: true` — *"Your WhatsApp plugin already transcribes voice notes locally. For inbound WhatsApp audio you don't need voice_transcribe. Setting this up is for WebChat uploads, iMessage audio, outbound voice notes, etc."*
   - If `false` — *"Your WhatsApp plugin doesn't transcribe by default. Either turn that on with `/whatsapp:configure audio` (local Whisper, free), or use our `voice_transcribe` per message."*

## Test flow

1. Call `voice_status` to confirm voice is enabled AND a backend is available. If not, redirect to setup.
2. Call `voice_speak({ text: "<greeting in user's language>" })`.
3. Print the result: *"Generated at `/tmp/...` using backend X. Play it or attach it in a messaging channel."*
4. If the user is on a messaging channel that supports media, use the channel's own reply/send tool with the path (e.g. `MEDIA:/tmp/...` or a dedicated `send_media` tool).

## Secrets handling

Never put API keys in `agent-config.json`. They are SECRETS and the config file may end up in a git repo. Use environment variables:

```
export ELEVENLABS_API_KEY=sk_...
export OPENAI_API_KEY=sk-...
```

Add them to `~/.zshrc` / `~/.bashrc` / `~/.config/fish/config.fish` for persistence.

Non-secret settings (default backend, voice ID, output dir) go in `agent-config.json`.

## Channel-plugin precedence (IMPORTANT)

A channel plugin that already transcribes audio (like the WhatsApp plugin with `audio on`) is authoritative for THAT channel. Do not call `voice_transcribe` on an audio file that arrived through such a plugin — you'd just be re-doing work the plugin already did, and you'd end up with two different transcriptions.

`voice_transcribe` is for:
- Files from channels without built-in transcription (WebChat uploads, iMessage attachments)
- Standalone files (the user dropped an .m4a in the workspace)
- Cases where the channel plugin's transcription is disabled

## Response style

- `/agent:voice status` on CLI: full card.
- On messaging channels: compact — single line per backend, skip the detailed reasons.
- `/agent:voice setup`: step-by-step, one instruction at a time. Don't dump all 7 steps — guide the user through what's missing for their situation.

## Never

- Don't write API keys to `agent-config.json` — they're env-only.
- Don't auto-run `brew install` — always let the user do it.
- Don't transcribe WhatsApp voice notes with `voice_transcribe` if the plugin has audio-on.

## References

- `docs/voice.md` — full doc (backends, precedence, secrets, troubleshooting)
- `lib/voice.ts` — routing + backends
- `skills/skill-manager/SKILL.md` — for installing the `sag` skill from OpenClaw path
