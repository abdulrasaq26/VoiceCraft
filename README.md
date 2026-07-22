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
- 📦 **Batch downloads** — download all parts as a single ZIP (the project transcript `.txt` is bundled in too), download each part individually, or tick specific parts and download just those
- 📄 **Automatic transcript** — every project also produces one timestamped transcript built from the *original* script (re-split into ~500-char, sentence-safe sections with `00-30`, `31-60`, … markers). View it, copy it, or download `Medieval Peasant Life Transcript.txt`. A **Generate transcript** button opens the same viewer for any pasted script on its own — no audio generation required

### Creator workflow
- 💾 **Presets** — save complete configurations (voice, instructions, speed, pitch, volume, format); rename, duplicate, delete, set a default, organize by project, and apply with one click
- 🕘 **Last-used memory** — all settings and the project name persist across sessions; the app reopens exactly as you left it

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

## Notes

- Presets, favorites, recents, and last-used settings are stored in the browser's localStorage.
- Free-text voice instructions are passed to the API only for instruction-capable (Gemini-TTS) voices; for all other Google voices the style templates shape delivery through the speed/pitch parameters, and the UI says so.
- Never commit `.env` or service-account JSON files — both are gitignored.
- If voices fail to load with an auth error, double-check that the Text-to-Speech API is enabled and your key/credentials belong to that same project.
