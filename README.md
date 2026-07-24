# Blvck TTS

**A serverless AI content-production studio.** Voice, images, video and scripts — powered by [Puter](https://puter.com) + ElevenLabs. No API keys. No billing setup. No server-side model calls.

Type or paste a script, pick a voice from the ElevenLabs catalog, tune the delivery, and generate speech, storyboards, thumbnails, SEO packages, and video scenes — all through Puter's free, user-pays SDK.

## Features

### Voices — ElevenLabs via Puter
- 🎙️ **Curated ElevenLabs catalog** with real voice IDs (Adam, Rachel, Sarah, Charlotte, Domi, George, Antoni, Arnold, Josh, Daniel, Callum, Matilda, Lily, Sam, …), rendered with human names, tier badges, and search
- 🔊 **Reliable previews** — tap ▶ to hear a sample; works under iOS Safari / Android Chrome autoplay policies
- 🎛️ **Voice settings** — `stability`, `similarity_boost`, `style`, `use_speaker_boost` (Puter's ElevenLabs API)
- ⚡ **No API key required** — every synthesis call runs client-side through Puter; users sign into Puter once

### Delivery control
- 📝 **Voice instructions** with 8 ElevenLabs-optimized presets (Documentary Narrator, Historical Storyteller, Calm Educator, YouTube Explainer, Cinematic Narrator, Audiobook Style, Dramatic Storytelling, Conversational). Each applies both a performance brief and recommended voice_settings in one click
- ➕ **Custom instruction presets** — save your own delivery brief + voice_settings under a name, reuse across projects
- 💾 **Voice profiles** — voice + voice_settings + instruction saved together, one-click reloadable
- 🗣️ **Instruction-first** — ElevenLabs listens to natural-language delivery cues in the prompt itself

### AI Script Generator
- ✍️ **Seven script types** — YouTube, historical storytelling, documentary, educational, shorts, podcast, audiobook
- 🎚️ Tone, length (~150–1500 words), target audience, and a retention-optimization toggle (hooks, open loops, re-engagement)
- 💾 Saved prompt templates; editable output with live word count; **"Use in voice studio"** loads the script straight into the narrator

### AI Coding Agent
- 🤖 **Chat-first coding assistant** (Claude / GPT / DeepSeek / Gemini via Puter) — generate, edit, analyze, and debug code
- 📎 **Project context** — paste files so the agent understands your codebase; **Task mode** produces step-by-step plans
- 💬 Conversation history persisted locally; code blocks with copy buttons; export the conversation as Markdown

### Long-form scripts
- ♾️ **Unlimited input** — paste an entire script, chapter, or article
- ✂️ **Sentence-aware auto-chunking** into ~1,000-character parts
- 🔁 **Automated generation queue** with live progress bar, ETA, pause / resume / cancel / retry
- 🏷️ **Auto-named parts** — `Medieval Peasant Life Part 1.mp3`, `… Part 2.mp3`, …
- 🌐 **Refresh-safe** — batch state persists in IndexedDB

### Subtitles
- 🎬 **Standalone subtitle generation** from your script (SRT / VTT / TXT) without needing to synthesize audio first
- ⏱️ **Audio-timed subtitles** when audio exists — continuous timeline across all chunks
- 📦 **Included in the ZIP** download

### Projects
- 🗂️ **Project dashboard** — first-class projects with independent snapshots (scenes, images, subtitles, thumbnails, SEO, editor state)
- 🔁 Switch, duplicate, archive, search

### AI storyboards + text-to-video (Puter txt2img / txt2vid)
- 🧠 **Story bible** — reads your subtitles/script and locks characters, locations, tone, period, colour grading
- 🎬 **Per-scene prompts** with cinematic shot variety and continuity across batches
- 🖼️/🎥 **Still, Video, or Mixed** — a "Scene assets" setting generates a still image (txt2img), a video clip (txt2vid), or a per-scene mix. In mixed mode each scene has a "Make video / Make image" toggle
- 📤 **ZIP / prompts / JSON / PDF export** (ZIP packs the right extension per scene; PDF is an image contact sheet)

### YouTube Optimization Center (Puter chat + txt2img)
- 🎯 **Titles × 30** — SEO / CTR / Balanced with per-title scores
- 📝 Long + short descriptions, keywords, tags, hashtags, thumbnail concepts (with generated thumbnails)
- 🧠 **Channel knowledge base** — brand voice, title patterns, thumbnail style, SEO strategy inherited across projects

### Video editor (optional)
- 🎞️ **Auto-assemble** storyboard scenes into a canvas timeline with Ken Burns motion + burned subtitles
- 📤 **WebM export** (MediaRecorder) + editor-package ZIP with images, subtitles, EDL for downstream 4K rendering
- 🎬 **Manual editor** — upload your own images / audio / subtitles if you skip the storyboard pipeline

### AI provider (backend model)
- 🔁 **Any Puter chat model** — Claude, GPT, Qwen, Llama, DeepSeek (change with `localStorage['blvck:chatmodel']`)
- 🎬 **Puter txt2vid** available for future text-to-video scenes (Sora / Veo / Kling via Puter's routing)

### Infrastructure
- 🕸️ **Serverless-friendly** — the thin Node/Express server hosts static files and owns the storyboard/SEO prompt scaffolding (single source of truth). Every model call runs in the browser via Puter
- 🔒 **No API keys on the server** — nothing to leak, nothing to bill
- 🐳 **Docker + Railway** ready (`Dockerfile`, `railway.json` included)

## Quick start

```bash
npm install
npm start
# → http://localhost:3000
```

The first time you use any AI feature, Puter will prompt you to sign in (free). Every subsequent call is metered against your Puter usage, not yours to bill.

### Deploy
Any static-friendly Node host works. `Dockerfile` and `railway.json` are wired up out of the box. The only environment variable you can set is `PORT`.

## Project structure

```
lib/
  storyboard.js      Story-bible + scene-prompt scaffolding (prompt-only)
  youtube-seo.js     YouTube SEO prompt + response parser
  script-writer.js   Script-generator prompt scaffolding
public/
  index.html         Single-page app shell
  ai-provider.js     BlvckAI: Puter router (speak / chat / generateJSON / generateImage / generateVideo)
  eleven-voices.js   Curated ElevenLabs voice catalog (48 voices + metadata)
  app.js             Core TTS UI (voices, queue, subtitles, profiles, instruction presets)
  script.js          AI Script Generator
  agent.js           AI Coding Agent
  storyboard.js      Storyboard pipeline UI (still / video / mixed)
  editor.js          Auto-assemble + manual editor
  youtube.js         Optimization Center
  projects.js        Project dashboard + snapshots
  images.js          Standalone image generator
  zip.js / pdf.js    Dependency-free ZIP and PDF writers
server.js            Static + prompt/parse endpoints (no external API keys)
```

## API

The server exposes only prompt-scaffolding endpoints. The browser fetches a prompt (`{promptOnly: true}` → `{prompt}`), runs the LLM through Puter, then posts the model's raw output back (`{rawText}`) for parsing and normalisation.

| Endpoint | Purpose |
|---|---|
| `GET  /api/health` | `{ ok: true, provider: 'puter' }` |
| `POST /api/storyboard/bible` | Build / parse story bible prompt |
| `POST /api/storyboard/scenes` | Build / parse scene-prompt batch |
| `POST /api/seo/generate` | Build / parse YouTube SEO package prompt |
| `POST /api/script/generate` | Build script prompt / clean model output |

No credentials required.

## Notes

- **Voice library**: ElevenLabs' Voice Library API is not exposed to Puter's free tier, so Blvck-TTS ships a hand-curated catalog of the most popular voice IDs. You can swap in your own IDs in `public/app.js` (`ELEVEN_VOICES`).
- **Character consistency**: honest caveat — image models don't do pixel-perfect character matching without reference conditioning. The story bible clamps textual descriptions across prompts, which is the best you can do without model-side reference support.
- **In-browser video export**: 4K MP4 rendering is infeasible in-browser today. The editor exports WebM directly and produces a package ZIP (images + subtitles + EDL) that can be fed to a downstream 4K pipeline (e.g. Remotion, After Effects).
