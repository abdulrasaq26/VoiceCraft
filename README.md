# Blvck TTS

**A serverless AI content-production studio.** Voice, images, video and scripts — powered by [Puter](https://puter.com) + ElevenLabs. No API keys. No billing setup. No server-side model calls.

Type or paste a script, pick a voice from the ElevenLabs catalog, tune the delivery, and generate speech, storyboards, thumbnails, SEO packages, and video scenes — all through Puter's free, user-pays SDK.

## Features

### Voices — 5 TTS providers via Puter
- 🔀 **Switch providers in ⚙ AI settings** — **ElevenLabs**, **Amazon Polly**, **OpenAI**, **Google Gemini**, or **xAI (Grok)**. The voice catalog swaps to that provider's voices and each call sends the right options shape automatically
- 🎙️ **Curated catalog per provider** — ElevenLabs (Adam, Rachel, …), Polly (Joanna, Matthew, neural/generative), OpenAI (alloy, onyx, nova, …), Gemini (Puck, Kore, … with delivery instructions), xAI (eve, ara, rex, sal, leo with inline `[pause]`/`<whisper>` tags) — all with human names, tier badges, gender/accent/style filters, and search
- 🔊 **Reliable previews** — tap ▶ to hear a sample; works under iOS Safari / Android Chrome autoplay policies
- 🎛️ **Provider-aware controls** — ElevenLabs shows `stability`/`similarity_boost`/`style`/`use_speaker_boost`; Polly exposes the engine (Neural/Generative); Gemini & OpenAI take the free-text instructions as delivery direction
- ⚡ **No API key required** — every synthesis call runs client-side through Puter; users sign into Puter once

### Delivery control
- 📝 **Voice instructions** with 8 ElevenLabs-optimized presets (Documentary Narrator, Historical Storyteller, Calm Educator, YouTube Explainer, Cinematic Narrator, Audiobook Style, Dramatic Storytelling, Conversational). Each applies both a performance brief and recommended voice_settings in one click
- ➕ **Custom instruction presets** — save your own delivery brief + voice_settings under a name, reuse across projects
- 💾 **Voice profiles** — voice + voice_settings + instruction saved together, one-click reloadable
- 🗣️ **Instruction-first** — ElevenLabs listens to natural-language delivery cues in the prompt itself

### AI Script Generator
- ✍️ **Seven script types** — YouTube, historical storytelling, documentary, educational, shorts, podcast, audiobook
- 🎚️ Tone, length (~150–1500 words), target audience, and a retention-optimization toggle (hooks, open loops, re-engagement)
- ⚡ **Live streaming** — the script writes itself token-by-token; a **Stop** button halts mid-generation
- 🪄 **One-click AI refine** — Polish, Punch up, Shorten, Expand rewrite your draft in place (also streamed)
- 💾 Saved prompt templates; editable output with live word count; **"Use in voice studio"** loads the script straight into the narrator

### AI Coding Agent
- 🤖 **Chat-first coding assistant** (any Puter chat model) — generate, edit, analyze, and debug code
- ⚡ **Streaming replies** with a **Stop** button; model list discovered from your instance
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

### AI Visual Director — storyboards + text-to-video (Puter txt2img / txt2vid)
- 🧠 **Content-driven** — analyzes the whole story and **infers the right visual style** (genre, era, setting, tone, audience, format). A finance script looks like modern finance visuals, not medieval art. Nothing is hardcoded
- 🎨 **25 visual styles + Auto** — 2D/3D/Pixar/anime/realistic/cinematic/documentary/oil/watercolor/comic/storybook/isometric/explainer/infographic/motion-graphics/… selectable per project, plus **reusable visual presets** (save your own)
- 🎞️ **Scene-beat merging** — adjacent subtitle lines are merged into ~1 image per 10/15/20s (selectable) instead of one per micro-caption — fewer, better scenes and much lower cost
- 👤 **Character & location continuity** locked into every prompt from the project profile
- 🎭 **Reference-image conditioning** — generate (or upload) a reference portrait per character; scenes featuring them are conditioned on it via Puter's `image_url` image-to-image on models that support it (Gemini image, GPT-Image-2, Ideogram Character, …), with automatic text-only fallback where they don't. References persist and can be toggled off
- 🔍 **Prompt transparency** — each scene shows its detected action + visual goal and an **editable prompt**; **Prompt Review mode** stops before generation so you approve/edit first
- 🛡️ **Robust JSON** — repairs fenced/messy model output and retries up to 3× for valid JSON, with a **View raw response** button on failure
- 🖼️/🎥 **Still, Video, or Mixed** — generate a still image (txt2img), a video clip (txt2vid), or a per-scene mix
- 📤 **ZIP / prompts / JSON / PDF export**

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
- 🕸️ **Truly serverless** — a pure static site. All prompt scaffolding lives in the browser (`public/prompts.js`); every model call runs in the browser via Puter. No backend, no build step
- 🔒 **Zero API keys, zero dependencies** — nothing to leak, nothing to bill, `npm install` pulls nothing
- ☁️ **Deploy anywhere static** — Puter, GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3 (`Dockerfile` + `railway.json` also included for container hosts)

## Quick start

```bash
npm start
# → http://localhost:3000  (a tiny zero-dependency static server)
```

The first time you use any AI feature, Puter will prompt you to sign in (free). Every subsequent call is metered against your Puter usage, not yours to bill.

## Deploy

**Blvck-TTS is a pure static site.** Everything — speech, chat, images, video, and all prompt scaffolding — runs in the browser through Puter. There is no backend and there are no API keys, so you deploy by uploading the **`public/` folder** to any static host.

### Puter (Dev Center)
1. Open Puter → **Dev Center → Apps → Deploy**.
2. Upload the **contents of the `public/` folder** (the folder that has `index.html` at its root) — **not** the repository root. Puter requires an `index.html` at the top level of what you upload; the repo root doesn't have one (it lives in `public/`), which is why uploading the whole project shows *"Please upload an 'index.html' file…"*.
3. That's it — open the app URL and sign into Puter when prompted.

### Other static hosts
GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3, etc. — set the publish/output directory to `public/`.

### Local dev (optional)
```bash
npm start          # tiny zero-dependency static server → http://localhost:3000
```
`Dockerfile` and `railway.json` are included for container hosts; the only env var is `PORT`.

## Project structure

```
public/                (this whole folder is the deployable app)
  index.html           Single-page app shell
  prompts.js           BlvckPrompts: all LLM prompt build + parse (client-side, single source of truth)
  ai-provider.js       BlvckAI: Puter router (speak / chat / generateJSON / generateImage / generateVideo) + model discovery
  ai-settings.js       ⚙ AI settings modal (chat model / image model / TTS provider per instance)
  diagnostics.js       🔧 AI diagnostics panel (live checks + precise failure causes)
  tts-providers.js     Multi-provider TTS catalog (ElevenLabs/Polly/OpenAI/Gemini/xAI) + per-provider options
  eleven-voices.js     Curated ElevenLabs voice catalog (48 voices + metadata)
  app.js               Core TTS UI (voices, queue, subtitles, profiles, instruction presets)
  script.js            AI Script Generator
  agent.js             AI Coding Agent
  storyboard.js        Storyboard pipeline UI (still / video / mixed)
  editor.js            Auto-assemble + manual editor
  youtube.js           Optimization Center
  projects.js          Project dashboard + snapshots
  images.js            Standalone image generator
  zip.js / pdf.js      Dependency-free ZIP and PDF writers
server.js              Optional zero-dependency static server for local dev only
```

## Architecture

There is no API to call. Each AI feature builds its prompt with `window.BlvckPrompts`, runs the model through `window.puter.ai.*` in the browser, and parses the result back with `BlvckPrompts` — all client-side:

| Feature | Flow |
|---|---|
| Speech | `BlvckAI.speak()` → `puter.ai.txt2speech` (ElevenLabs) |
| Storyboard bible / scenes | `BlvckPrompts.build → puter.ai.chat → BlvckPrompts.parse` |
| YouTube SEO | `BlvckPrompts.build → puter.ai.chat → BlvckPrompts.parse` |
| Script generator | `BlvckPrompts.build → puter.ai.chat → BlvckPrompts.parse` |
| Images / thumbnails | `BlvckAI.generateImage()` → `puter.ai.txt2img` |
| Video scenes | `BlvckAI.generateVideo()` → `puter.ai.txt2vid` |
| Coding agent | `BlvckAI.chat()` → `puter.ai.chat` |

## Notes

- **Diagnostics.** If anything fails, open **⚙ AI settings → 🔧 Diagnostics** and hit *Run*. It reports the API endpoint, whether you're signed into Puter, the resolved models/provider, `listModels()`, and a live test chat + test voice — labelling each failure with its real cause (**authentication**, **network / CORS**, **rate limit / quota**, **missing provider / voice**, or **unsupported / missing model**) and showing the provider's raw error. *Copy report* puts the whole thing on your clipboard to share.
- **Which Puter instance?** The app adapts to whatever the running instance exposes. Chat **cycles through the models your instance reports** via `puter.ai.listModels()` (not a hardcoded list), so it works the same on **puter.com** and a **self-hosted Puter** with a completely different model roster — it tries the reported models best-first and remembers the one that works. Image generation falls back across known image models. If a call fails because a model/provider is missing, it self-heals to an available one.
  - On **puter.com**, everything is configured (ElevenLabs, 400+ models, `gpt-image-1`) but usage is billed to the signed-in user (Puter's user-pays model).
  - On a **self-hosted Puter**, only the models/providers *you* configured on the server exist. Chat and images adapt automatically; for **voice (TTS)**, open **⚙ AI settings → Voice provider** and pick whichever of the five your instance supports (Amazon Polly is Puter's default engine and the most likely to be available). Each provider ships its own voice catalog, so switching provider swaps the voices too.
- **Voice library**: ElevenLabs' Voice Library API is not exposed to Puter's free tier, so Blvck-TTS ships a hand-curated catalog of the most popular voice IDs. You can swap in your own IDs in `public/eleven-voices.js`.
- **Character consistency**: honest caveat — image models don't do pixel-perfect character matching without reference conditioning. The story bible clamps textual descriptions across prompts, which is the best you can do without model-side reference support.
- **In-browser video export**: 4K MP4 rendering is infeasible in-browser today. The editor exports WebM directly and produces a package ZIP (images + subtitles + EDL) that can be fed to a downstream 4K pipeline (e.g. Remotion, After Effects).
