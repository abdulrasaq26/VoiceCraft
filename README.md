# Blvck TTS

A fully functional text-to-speech web app powered by the **Google Cloud Text-to-Speech API**.

Type or paste text (or SSML), pick a voice by human name from a searchable voice browser, tune the delivery with instructions and sliders, then play the result in the browser or download it as MP3, OGG, or WAV.

## Features

### Voices
- 🎙️ **Human-named voices** — every voice gets a realistic name and descriptor (e.g. *Sarah — Warm Female Narrator*, *James — Deep Professional Male Voice*) instead of `en-US-Neural2-C`
- 🏆 **Quality tiers with badges** — ⭐ Elite (Chirp3-HD, Studio), Premium (Neural2, WaveNet), Standard, and Experimental voices, clearly labeled
- 🔎 **Voice browser** — search by name, style, or voice ID; filter by tier and gender; favorites and recently-used sections; mobile-friendly full-screen browser
- 🔊 **Reliable previews** — tap ▶ on any voice to hear a sample; gesture-safe playback that works under iOS Safari / Android Chrome autoplay policies; previews are cached server-side so repeat listens don't hit your quota
- 🩺 **Voice health system** — per-family capability rules prevent invalid API requests; voices that fail a live preview are hidden automatically; `npm run verify-voices` audits the entire catalog against the live API and writes a blocklist

### Delivery control
- 📝 **Voice instructions** — free-text delivery guidance with pre-built style templates (Documentary Narrator, Energetic YouTube Presenter, Calm Bedtime Storyteller, …). Templates tune real API parameters (speed/pitch) on every voice; instruction-capable voices also receive the text directly
- 🎛️ **Sliders** — speaking rate (0.25×–4×), pitch (±20 semitones), volume gain; controls a voice doesn't support are greyed out instead of causing errors
- 🗣️ **SSML support** — toggle to send raw SSML (blocked with a clear message on voices that don't accept it)

### Long-form scripts
- ♾️ **Unlimited input** — paste an entire script, chapter, or article in one go; there's no length cap on the box
- ✂️ **Sentence-aware auto-chunking** — the script is split into ~1,000-character parts on sentence boundaries, so no part ever cuts a sentence in half (a lone long sentence fills its own part, up to a safe limit)
- 🔁 **Automated generation queue** — every part is generated in sequence automatically, with a live progress bar showing the current part (“Part 7 of 32”), count complete, percentage, and estimated time remaining
- ⏯️ **Full queue control** — pause, resume, cancel, and retry-failed-parts; the batch is saved to the browser (IndexedDB), so a refresh restores it and you can continue where you left off
- 🏷️ **Auto-named parts** — outputs are named from the project name: `Medieval Peasant Life Part 1.mp3`, `… Part 2.mp3`, …
- 📦 **Batch downloads** — download all parts as a single ZIP (the `.srt` and `.vtt` subtitles are bundled in too), download each part individually, or tick specific parts and download just those
- 🎬 **Automatic subtitles (SRT/VTT)** — every project produces broadcast-style subtitles whose timing comes from the **actual generated audio**: each part's decoded duration is distributed across cues on sentence/phrase boundaries, with a running offset so the timeline is continuous across the whole project (never restarts per part). Cues wrap to 1–2 lines of ≤42 chars, never splitting a word. Preview, copy, or download `Medieval Peasant Life.srt` / `.vtt` — ready for YouTube, CapCut, Premiere, DaVinci Resolve, etc. A **Generate subtitles** button also works on any pasted script alone (timing estimated from the voice speed) with no audio run

### Projects
- 🗂️ **Project dashboard** — every project (e.g. *Born Back Then – Medieval Peasant*) is a first-class saved workspace that bundles its script, voice/style settings, audio, subtitles, image prompts, generated images, and video timeline. Open the **Projects** dashboard from the top bar to **create, open, rename, duplicate, archive, search and sort** projects. Switching a project swaps the entire asset set — each project's audio and images are fully isolated (snapshotted in IndexedDB), so opening one restores exactly where you left it.

### Creator workflow
- 💾 **Presets** — save complete configurations (voice, instructions, speed, pitch, volume, format); rename, duplicate, delete, set a default, organize by project, and apply with one click
- 🕘 **Last-used memory** — all settings and the project name persist across sessions; the app reopens exactly as you left it

### Images (optional)
- 🖼️ **AI image generator** — a built-in panel that generates still 2D images from a text prompt via Google's **Gemini image API**, with an aspect-ratio selector, inline preview, and download. Disabled until a `GEMINI_API_KEY` is set, then it appears automatically. Great for thumbnails or per-scene visuals to pair with narration.
- 🎞️ **AI Storyboard** — upload subtitles (`.srt` / `.vtt` / timestamped `.txt`) plus optional script, visual-style, character-reference and instruction files; the AI reads the *whole* story, builds a story bible (characters, locations, period, tone), then automatically writes one image prompt per scene and generates a still image for each — no manual prompt writing. Camera shots vary for visual interest, the "Born Back Then" channel style is injected into every prompt, and character/location descriptions are locked for consistency. Batch queue with progress, pause/resume, per-scene regenerate, refresh-persistence, and exports: **ZIP** (images + prompts + JSON), **prompts.txt**, **scenes.json**, and a **storyboard PDF**.

### YouTube Optimization Center (optional)
- 📈 **Project-aware SEO** — analyzes the selected project's story (script, bible, subtitles) and your channel brand to generate an entire publishing package: **30 title variations** (SEO / CTR / balanced, each scored for SEO, CTR, competition and readability) with a recommendation, **long + short descriptions**, **keywords** (primary / secondary / long-tail + search intent), **categorized tags**, and **hashtags** — all copyable.
- 🧠 **Channel knowledge base** — save a channel profile (name, type, audience, tone, visual & thumbnail style, colour palette, title structure, SEO focus, content strategy) once; it's stored globally and inherited by every project so the whole channel stays on-brand.
- 🖼️ **Thumbnail intelligence** — two on-brand thumbnail concepts (A/B) with text, visual focus, emotional & curiosity triggers, reasoning, a ready image prompt, and predicted scores (curiosity / CTR / readability / mobile / brand). One-click **Generate thumbnail** (×1 / ×5 / ×10) feeds the concept prompt to the Gemini image model, quota-aware, and saves results to the project.
- 📦 **Exports** — SEO report (`.md`), thumbnail package (ZIP: images + prompts + notes), and a complete publishing package (ZIP: report + thumbnails). Needs `GEMINI_API_KEY`.

### Video editor (optional)
- 🎬 **AI Video Editor** — auto-assembles your storyboard images, subtitle timing and narration into a synchronized rough cut: each scene becomes a clip whose duration comes from its subtitle timing, with an automatically-assigned **Ken Burns motion** effect (zoom / pan / push / pull / drift / focus-shift) and **burned-in subtitles** (font, size, position, colour). Live canvas preview, and a timeline you can edit — reorder, change duration, change motion, replace an image, or delete clips.
- 🔀 **Two workflows** — the **storyboard-driven auto-assemble is the primary, recommended path** (scene order, timing and image assignments come from the storyboard). An optional **Open Manual Editor** button reveals a standalone mode where you **upload your own images, narration audio, and subtitles** and click **Auto Assemble uploads** to build a draft — no storyboard required. Manual assets are saved to the project like generated ones.
- 🎞️ **Default crossfade transitions** between scenes (toggleable), applied in both the preview and the exported video.
- 📤 **Export** — an in-browser **WebM** render (720p/1080p, video + narration muxed via Web Audio; YouTube accepts WebM), plus an **editor package ZIP** (scene images + narration parts + an SRT matching the timeline + `edl.json` with scene order/durations/effects) to finish a **4K MP4** in Premiere / DaVinci Resolve / CapCut or a one-line ffmpeg script. *(True 4K MP4/MOV can't be encoded inside a browser — that's what the package is for.)*

### AI provider
- 🔁 **Gemini or Qwen (Puter)** — a top-bar switch chooses the AI backend for storyboard analysis, SEO, and image generation. **Gemini** runs server-side with your `GEMINI_API_KEY`. **Qwen (free)** uses [Puter.js](https://developer.puter.com/) — a client-side, "user-pays" SDK that needs **no API key and no billing** (you sign into Puter in the browser), which sidesteps the Gemini image quota. Prompt-building and result-parsing stay server-side either way; only the model call moves to the browser under Qwen. The Qwen model id is editable in the top bar (default `qwen3.6-flash`). Puter's SDK is loaded lazily — only when you actually select Qwen.

### Infrastructure
- 🔐 **Two auth modes** — simple API key, or service-account / Application Default Credentials
- 🛡️ **Server-side proxy** — your Google credentials never reach the browser
- 🧪 **Mock mode** — `npm run mock` serves canned voices and audio so you can develop and test the UI without credentials or billing

## Quick start

### 1. Set up Google Cloud

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. Enable the **Cloud Text-to-Speech API**: *APIs & Services → Library → search "Text-to-Speech" → Enable*.
3. Make sure billing is enabled on the project (the API has a generous free tier — currently up to 4 million characters/month for standard voices and 1 million for WaveNet/Neural2).
4. Create credentials — pick **one** of the following:

   **Option A — API key (fastest):**
   - *APIs & Services → Credentials → Create credentials → API key*
   - Recommended: restrict the key to the Cloud Text-to-Speech API.

   **Option B — Service account (recommended for production):**
   - *IAM & Admin → Service Accounts → Create service account*
   - Create a JSON key (*Keys → Add key → JSON*) and download it.

### 2. Configure and run the app

```bash
git clone https://github.com/abdulrasaq26/Blvck-TTS.git
cd Blvck-TTS
npm install
cp .env.example .env
```

Edit `.env`:

```env
# Option A
GOOGLE_TTS_API_KEY=your-api-key-here

# ...or Option B (leave GOOGLE_TTS_API_KEY empty)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

Then start the server:

```bash
npm start          # production
npm run dev        # auto-restarts on changes
npm run mock       # UI development without credentials
```

Open **http://localhost:3000**. `Ctrl/Cmd + Enter` in the text box triggers generation.

### 3. (Optional) Audit the voice catalog

```bash
npm run verify-voices
```

Synthesizes a tiny sample with every voice in the catalog (~3 characters per voice — negligible cost), writes any failing voices to `voice-blocklist.json`, and the server hides them on next start. Voices that fail a preview at runtime are hidden automatically without this step.

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Server status, auth mode, hidden-voice count |
| `GET` | `/api/voices` | Enriched voice catalog: human names, descriptors, tiers, capabilities |
| `GET` | `/api/preview?voiceName=en-US-Neural2-C&languageCode=en-US` | Short MP3 sample of a voice (cached, deduped server-side) |
| `POST` | `/api/synthesize` | Generate audio; returns the audio bytes |
| `POST` | `/api/image` | Generate a still image from `{ prompt, aspect }` via the Gemini image API; returns image bytes (requires `GEMINI_API_KEY`) |
| `POST` | `/api/storyboard/bible` | Analyze the full story (`{ context }`) into a story bible: characters, locations, period, tone |
| `POST` | `/api/storyboard/scenes` | Turn a batch of cues into scene prompts (`{ bible, cues, style, instructions, priorSummaries }`) |

`POST /api/synthesize` body:

```json
{
  "text": "Hello world",
  "ssml": false,
  "voiceName": "en-US-Neural2-C",
  "languageCode": "en-US",
  "audioFormat": "MP3",
  "speakingRate": 1.0,
  "pitch": 0.0,
  "volumeGainDb": 0.0,
  "instructions": "Calm, authoritative documentary narration."
}
```

- `audioFormat`: `MP3`, `OGG_OPUS`, or `LINEAR16` (WAV)
- `/api/synthesize` accepts up to 2,000 characters per request. Longer scripts are chunked client-side into ~1,000-character, sentence-aware parts, each sent as its own request and assembled into the download queue — so there's no practical limit on the script you paste into the app.
- Parameters a voice doesn't support are stripped server-side rather than sent (Google rejects whole requests otherwise); the `X-Instructions-Applied` response header reports whether the voice consumed the free-text instructions directly

## How voice capabilities are handled

Google's voice families accept different parameters; sending an unsupported one fails the whole request. The server enforces these rules (see `lib/voice-catalog.js`):

| Family | Tier | Speed | Pitch | SSML |
| --- | --- | --- | --- | --- |
| Chirp3-HD / Chirp-HD | ⭐ Elite | ✓ (up to 2×) | — | — |
| Studio | ⭐ Elite | ✓ | — | ✓ |
| Neural2 / WaveNet | Premium | ✓ | ✓ | ✓ |
| Standard | Standard | ✓ | ✓ | ✓ |
| News / Casual / Polyglot | Experimental | ✓ | ✓ | ✓ |

Controls a voice can't use are disabled with a visible note explaining why (Google rejects the whole request if the parameter is sent). As a safety net, if Google still rejects a delivery parameter, the server strips it and retries once instead of failing the generation.

The UI greys out controls the selected voice can't use, so users can't build a failing request.

## Project structure

```
├── server.js               # Express server: catalog, preview, synthesis, voice health
├── lib/
│   ├── google-tts.js       # Google TTS REST client (API key / ADC) + mock mode
│   └── voice-catalog.js    # Human naming, tiers, descriptors, capability rules
├── scripts/
│   └── verify-voices.js    # Full-catalog voice audit → voice-blocklist.json
├── public/
│   ├── index.html          # UI
│   ├── style.css           # Styling
│   ├── zip.js              # Dependency-free ZIP writer for batch downloads
│   └── app.js              # Voice browser, presets, previews, chunking + batch queue
├── Dockerfile              # Lean container build
├── railway.json            # Railway build/deploy config
├── .env.example            # Credential configuration template
└── package.json
```

## Image generation (optional)

To enable the image panel, add a **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey):

```env
GEMINI_API_KEY=your-gemini-key
# Optional — override the model (default gemini-2.5-flash-image):
# GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
```

The panel appears automatically once the key is set. The default model
(`gemini-2.5-flash-image`) has a free tier on Google AI Studio; verify current
free limits there, since Google adjusts them. To use Imagen or a newer model,
set `GEMINI_IMAGE_MODEL`. The key is used server-side only and never reaches the
browser. For local UI testing without a key, run with `MOCK_IMAGE=1` (or the
general `MOCK_TTS=1`) to get placeholder images.

The same `GEMINI_API_KEY` also powers the **AI Storyboard** (story analysis uses
the text model `gemini-3.6-flash`, overridable via `GEMINI_TEXT_MODEL` — set this
if Google retires the default). Note
that character consistency is enforced by locking each character's visual
description in the story bible and injecting it into every prompt — it's strong
but, with a text-only image API, not pixel-perfect across images; reference-image
conditioning would be the next step for exact face locking.

## Notes

- Presets, favorites, recents, and last-used settings are stored in the browser's localStorage.
- Free-text voice instructions are passed to the API only for instruction-capable (Gemini-TTS) voices; for all other Google voices the style templates shape delivery through the speed/pitch parameters, and the UI says so.
- Never commit `.env` or service-account JSON files — both are gitignored.
- If voices fail to load with an auth error, double-check that the Text-to-Speech API is enabled and your key/credentials belong to that same project.
