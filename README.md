# Blvck TTS

A fully functional text-to-speech web app powered by the **Google Cloud Text-to-Speech API**.

Type or paste text (or SSML), pick from hundreds of Google voices across dozens of languages, tune speed / pitch / volume, then play the result in the browser or download it as MP3, OGG, or WAV.

## Features

- 🎙️ **All Google Cloud voices** — Neural2, Studio, WaveNet, Journey, Chirp, and Standard tiers, grouped by quality in the voice picker
- 🌍 **Language filter** — voices filtered by language, with human-readable language names
- 🔊 **Voice preview** — hear a short sample of any voice before generating; previews are cached server-side so repeat listens don't hit your quota
- 🎛️ **Audio controls** — speaking rate (0.25×–4×), pitch (±20 semitones), volume gain (−20 to +16 dB)
- 📝 **SSML support** — toggle to send raw SSML markup instead of plain text
- 💾 **Download** — export generated audio as MP3, OGG (Opus), or WAV
- 🔐 **Two auth modes** — simple API key, or service-account / Application Default Credentials
- 🛡️ **Server-side proxy** — your Google credentials never reach the browser

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
   - Grant it no special roles (Text-to-Speech only needs a valid identity on a project with the API enabled).
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
npm start        # or: npm run dev (auto-restarts on changes)
```

Open **http://localhost:3000** and start generating speech. `Ctrl/Cmd + Enter` in the text box also triggers generation.

## API

The Express server exposes a small JSON API that the frontend uses (and you can too):

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Server status and detected auth mode |
| `GET` | `/api/voices?languageCode=en-US` | List available voices (language filter optional) |
| `GET` | `/api/preview?voiceName=en-US-Neural2-C&languageCode=en-US` | Short MP3 sample of a voice (cached server-side) |
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
  "volumeGainDb": 0.0
}
```

- `audioFormat`: `MP3`, `OGG_OPUS`, or `LINEAR16` (WAV)
- Input is limited to 5,000 bytes per request (a Google Cloud TTS limit)

## Project structure

```
├── server.js          # Express server + Google Cloud TTS proxy
├── public/
│   ├── index.html     # UI
│   ├── style.css      # Styling
│   └── app.js         # Frontend logic
├── .env.example       # Credential configuration template
└── package.json
```

## Notes

- Never commit `.env` or service-account JSON files — both are gitignored.
- If voices fail to load with an auth error, double-check that the Text-to-Speech API is enabled and your key/credentials belong to that same project.
