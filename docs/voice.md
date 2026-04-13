# Voice — TTS and transcription

Agent-facing voice capabilities: generate spoken audio from text (TTS), transcribe audio files (STT). The agent uses these to send voice notes in messaging channels, transcribe user-uploaded audio, or speak when the surface supports it.

Optional. Off by default.

## Quick start

```json
{
  "voice": {
    "enabled": true,
    "defaultBackend": "auto",
    "outputDir": "/tmp"
  }
}
```

```
export ELEVENLABS_API_KEY=sk_...   # for sag / elevenlabs
# or
export OPENAI_API_KEY=sk-...       # for openai-tts / openai-whisper
```

Run `/agent:voice status` to see what's detected. Run `/agent:voice setup` for a guided walk-through.

## Backends

### Text-to-speech (TTS)

| Backend | Requires | Pros | Cons |
|---|---|---|---|
| `sag` | `brew install steipete/tap/sag` + `ELEVENLABS_API_KEY` | Best audio quality · supports `[whispers]` `[excited]` audio tags · curated prompting | Costs API tokens · macOS primary |
| `elevenlabs` | `ELEVENLABS_API_KEY` (no sag binary) | Same quality without sag dep | Same cost |
| `openai-tts` | `OPENAI_API_KEY` | Good quality · cheap · simple | Fewer voice controls than ElevenLabs |
| `say` | macOS only | Free · zero setup · instant | Robotic · outputs AIFF (not MP3) |

### Speech-to-text (STT)

| Backend | Requires | Pros | Cons |
|---|---|---|---|
| `whisper-cli` | `brew install whisper-cpp` (or similar) | Local · offline · free · fastest (native C++) | Needs binary install · model files to manage |
| `hf-whisper` | `npm install @huggingface/transformers` (optional dep) | **Local · offline · zero binary install · pure Node** | First-run model download (~40–250MB depending on size) · slower cold start than native |
| `openai-whisper` | `OPENAI_API_KEY` | Cloud · nothing to install · accurate | Costs API tokens · audio leaves your machine |

## Backend selection

With `defaultBackend: "auto"` (default), the agent picks the first available TTS backend in this order:

1. `sag` (binary + key both present)
2. `elevenlabs` (direct API, no sag required)
3. `openai-tts`
4. `say` (macOS fallback)

STT auto chain:

1. `whisper-cli` (native, fastest)
2. `hf-whisper` (pure Node, zero install — optional dep)
3. `openai-whisper` (cloud fallback)

### Model size and quality (shared across local STT backends)

Both `whisper-cli` and `hf-whisper` accept:

| Config | Values | Effect |
|---|---|---|
| `voice.stt.model` | `tiny` / `base` / `small` | Smaller = faster, larger = more accurate. Default: `base`. |
| `voice.stt.quality` | `fast` / `balanced` / `best` | Maps to beam-size and dtype. `fast` = quantized no-beam; `balanced` (default) = quantized single-beam; `best` = fp32 + 5-beam search. |

Example:

```json
{
  "voice": {
    "stt": { "model": "small", "quality": "best" }
  }
}
```

Both keys are **hot-reloadable** — no `/mcp` needed. The next transcription call picks up the change.

`openai-whisper` ignores these settings — OpenAI's API uses a single fixed model (`whisper-1`) and doesn't expose beam-search controls.

You can force a backend:

```json
{ "voice": { "defaultBackend": "openai-tts" } }
```

If you set a specific backend and it's unavailable, calls will error instead of silently falling back — we assume you chose it deliberately.

## Channel-plugin precedence

**If a channel plugin already transcribes or synthesizes audio, it wins for that channel.** Our voice tools do NOT duplicate what the plugin already does.

| Scenario | Who handles |
|---|---|
| WhatsApp voice note, plugin `audio on` configured | WhatsApp plugin transcribes locally (Whisper). Agent receives text. `voice_transcribe` is NOT called. |
| WhatsApp voice note, plugin `audio off` | Agent sees `[Voice message]` + file path. Can defer to `/whatsapp:configure audio` (preferred) or call `voice_transcribe` manually. |
| WebChat user uploads an audio file | `voice_transcribe` handles it. |
| iMessage / Discord / raw file | `voice_transcribe` handles it (until those plugins gain native transcription). |
| Outbound voice note from agent | Agent calls `voice_speak` → gets an MP3/AIFF → passes path to the channel plugin's send-media function. |

The `voice_status` tool reads `~/.whatsapp/config.json` and reports whether the WhatsApp plugin has audio enabled, so the agent can honour this precedence automatically.

## Secrets

**Never put API keys in `agent-config.json`.** The config file is frequently edited, sometimes committed to git, not encrypted. Keys belong in environment variables.

| Variable | Used by |
|---|---|
| `ELEVENLABS_API_KEY` | `sag`, `elevenlabs` direct |
| `SAG_API_KEY` | `sag` (legacy, checked as fallback) |
| `OPENAI_API_KEY` | `openai-tts`, `openai-whisper` |

Add them to your shell rc (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`) so they persist across sessions.

Non-secret settings (default voice, backend, output dir) DO go in `agent-config.json`.

## Config keys

```json
{
  "voice": {
    "enabled": false,
    "defaultBackend": "auto",
    "defaultSttBackend": "auto",
    "defaultVoice": "Clawd",
    "outputDir": "/tmp",
    "elevenlabs": {
      "model": "eleven_v3",
      "voiceId": "lj2rcrvANS3gaWWnczSX"
    },
    "openai": {
      "model": "tts-1",
      "voice": "alloy"
    },
    "stt": {
      "model": "base",
      "quality": "balanced"
    }
  }
}
```

| Key | Default | Notes |
|---|---|---|
| `enabled` | `false` | Master switch. Tools error until this is `true`. |
| `defaultBackend` | `"auto"` | `auto` / `sag` / `elevenlabs` / `openai-tts` / `say` |
| `defaultSttBackend` | `"auto"` | `auto` / `whisper-cli` / `openai-whisper` |
| `defaultVoice` | — | Backend-specific — sag voice name, OpenAI voice (`alloy`, `echo`…), ElevenLabs voice id. |
| `outputDir` | `"/tmp"` | Where generated audio goes. Any writable directory. |
| `elevenlabs.model` | `"eleven_v3"` | Options: `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`. |
| `elevenlabs.voiceId` | — | Direct ElevenLabs voice id (overrides `defaultVoice` for the elevenlabs backend only). |
| `openai.model` | `"tts-1"` | Or `"tts-1-hd"`. |
| `openai.voice` | `"alloy"` | One of `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. |
| `stt.model` | `"base"` | `tiny` / `base` / `small`. Local STT only. |
| `stt.quality` | `"balanced"` | `fast` / `balanced` / `best`. Local STT only. |

## MCP tools

| Tool | Purpose |
|---|---|
| `voice_speak({ text, voice?, backend?, outputPath? })` | Generates an audio file. Returns `{ ok, backend, path, bytes }`. |
| `voice_transcribe({ audioPath, language?, backend? })` | Transcribes a file. Returns `{ ok, backend, text }`. |
| `voice_status({ format? })` | Reports backend availability, chosen defaults, and WhatsApp-plugin audio state. |

## Output formats

| Backend | Output |
|---|---|
| `sag` | MP3 |
| `elevenlabs` | MP3 |
| `openai-tts` | MP3 |
| `say` | AIFF |

If a messaging channel requires a specific format (e.g. WhatsApp wants Opus/OGG), the channel plugin typically handles the conversion on its side. If not, convert with `ffmpeg` before delivering.

## Using the `sag` skill

If you have the `sag` skill from an OpenClaw workspace (e.g. `~/.openclaw/workspace-wilson/skills/sag/`), you can install it into this agent with:

```
/agent:skill install /Users/you/.openclaw/workspace-wilson/skills/sag
```

It documents ElevenLabs v3 audio tags, model tradeoffs, and pronunciation rules. Installing it gives the agent the prompt know-how without you teaching it from scratch. The skill is the same ClawCode SKILL.md format — it works as-is.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `voice_speak` errors "no backend available" | Nothing detected | `/agent:voice setup` walks you through installing one |
| Generated audio is robotic/monotone | Falling back to `say` | Install sag or set an API key for better TTS |
| WhatsApp voice notes transcribed twice | Agent called `voice_transcribe` on already-transcribed text | Respect channel precedence — don't call `voice_transcribe` for WhatsApp if `audio on` |
| ElevenLabs returns 401 | `ELEVENLABS_API_KEY` not exported in the Claude Code process's env | Restart Claude Code after adding to shell rc, or pass via the `.env` equivalent |
| Output file too big / no disk space | `outputDir` on small partition | Point `voice.outputDir` at a larger location |
| Transcription is wrong language | Whisper auto-detected incorrectly on short clip | Pass `language: "es"` (or whichever code) to `voice_transcribe` |

## Implementation

| File | Role |
|---|---|
| `lib/voice.ts` | Detection, chain selection, request assembly, side-effectful speak/transcribe |
| `server.ts` | `voice_speak`, `voice_transcribe`, `voice_status` MCP tools |
| `skills/voice/SKILL.md` | Dispatch for setup / status / test |
