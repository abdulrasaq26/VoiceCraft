# Fish Voice Studio — implementation spec (self-hosted Fish Speech S2 Pro)

Status: proposed, not started.
Target engine: **self-hosted** `fish-speech` S2 Pro via the Kaggle/ngrok tunnel.

## Why this document exists

An earlier draft of this feature was written around inline performance tags
(`[whisper]`, `[excited]`, `[pause]`, `[laughing]`) and dropdowns for emotion,
energy and pause style. **None of that exists in the engine we run.** Those
features are real in ElevenLabs v3 and in Fish Audio's *hosted* cloud API; they
are not in the open-source S2 Pro model on our own box.

Verified against the vendored source at `fish-speech/`:

- `grep -rniE "emotion|prosody|speaking_style|\[(whisper|excited|pause)\]"` over
  `fish_speech/` and `tools/` returns **zero matches**. There is no tag parser.
- `ServeTTSRequest` (`fish_speech/utils/schema.py`) is the complete set of
  tunable parameters. It is listed in full below.

Sending `[whisper] I have to tell you something` would have the model read the
word "whisper" aloud or garble the line. Every control in this spec is traced to
a real endpoint or a real parameter.

## Ground truth: the entire API surface

### Endpoints (`tools/server/views.py`)

| Endpoint | Method | Notes |
|---|---|---|
| `/v1/tts` | POST | Synthesis. Body = `ServeTTSRequest`. |
| `/v1/references/list` | GET | Returns `reference_ids`. Add `?format=json` or you get msgpack. |
| `/v1/references/add` | POST | **multipart**: `id`, `audio` (file), `text`. |
| `/v1/references/delete` | DELETE | Body: `reference_id`. |
| `/v1/references/update` | POST | Replace an existing reference. |
| `/v1/health` | GET | Liveness. |
| `/v1/vqgan/encode`, `/v1/vqgan/decode` | POST | Codec internals, not needed here. |

### Every tunable parameter (`ServeTTSRequest`)

```
text            str
chunk_length    int    100..1000        default 200
format          wav | pcm | mp3 | opus  default wav
latency         normal | balanced       (hosted API only; ignored locally)
references      list[{audio: bytes, text: str}]   inline reference audio
reference_id    str | None              a folder name under references/
seed            int | None
use_memory_cache on | off               default off
normalize       bool                    default true (numbers/dates for en+zh)
streaming       bool                    default false (wav only)
max_new_tokens  int                     default 1024
top_p           float  0.1..1.0         default 0.8
repetition_penalty float 0.9..2.0       default 1.1
temperature     float  0.1..1.0         default 0.8
```

That is the whole surface. There is no emotion field, no energy level, no pause
style, no breathing frequency, no gender detection.

## The key architectural fact

**In Fish Speech, expression lives in the reference audio, not in parameters.**
It is in-context learning: you do not ask for an excited delivery, you supply an
excited reference and the model imitates it — including its pace, noise floor and
frequency response. (This is exactly why the old voice pack failed: `jfk.wav`
rolls off at 3.3 kHz, so everything cloned from it sounded like a phone call.)

Every "emotion control" ambition therefore becomes a *reference management*
problem, which is tractable and is what Phase 3 addresses.

## Explicitly not building

| Requested | Why not |
|---|---|
| Inline tag toolbar (`[whisper]`, `[excited]`, …) | No parser in the engine. Tags would be spoken or corrupt the text. |
| Emotion / energy / pace dropdowns as engine params | No such parameters exist. |
| Humanization knobs (breathing frequency, hesitations, prosody range) | No API surface. |
| Gender / language auto-detect on upload | Engine does not return this. Could be added later as a client-side classifier, out of scope. |
| "Human Realism: 92%" style scores | Unfalsifiable. Phase 5 reports only measurable quantities. |

If inline tags are a hard requirement, that is a decision to move to the hosted
Fish Audio API or ElevenLabs — not something to build against this engine.

---

## Phase 1 — Voice Cloning Studio

Fully supported by `/v1/references/add` and `/v1/references/delete`.

**New module:** `public/voice-cloning.js`, plus proxy passthrough (already
generic — `/api/proxy/fish/*` forwards any path).

**Upload flow**

1. User picks a `wav` / `mp3` / `flac` / `m4a` file, or records from the mic.
2. Client conditions it in-browser, mirroring what the notebook does for the
   built-in pack (`AETHER_FishSpeech_Colab.ipynb`, voice-pack cell):
   decode via `AudioContext`, downmix to mono, resample to 44.1 kHz, trim to the
   most speech-dense ~14 s window, peak-normalise to −1 dBFS, re-encode WAV.
3. **Quality gate before upload.** Reuse the measurement already proven in this
   repo (95 % spectral rolloff, HF share, noise floor). Block or warn on:
   - duration < 4 s
   - 95 % rolloff < 6 kHz  → "this recording is band-limited and will sound
     muffled when cloned" (this is precisely the `jfk.wav` failure)
   - SNR < 25 dB → "audible background noise will be cloned too"
4. Transcript. **The API requires `text`** — a reference with a wrong transcript
   degrades output badly (proven: the three OpenVoice voices in the old pack
   shared a fabricated line and all sounded wrong). So:
   - a transcript field is **required**, and
   - optionally auto-filled — see "Notebook addition" below.
5. `POST /api/proxy/fish/v1/references/add` as multipart.
6. Refresh the voice list via the existing `FishAdapter.probeFish()`.

**Management UI:** list references with preview (synthesise a fixed sample
line), rename (delete + add), delete (`/v1/references/delete`), and mark
favourites (client-side, `localStorage`).

**Notebook addition (optional but recommended):** expose
`POST /aether/transcribe` in the tunnel that lazy-loads the CPU Whisper already
used by the voice-pack cell and returns text for an uploaded clip. This makes
step 4 one click instead of typing. Must stay CPU-only and unload after use —
the T4 has under 1 GB of headroom once Fish is resident (see the OOM fix in
commit `49c4c8f`).

## Phase 2 — Expressiveness controls (real parameters)

Replace the current Kokoro-shaped sliders with controls that map 1:1 onto
`ServeTTSRequest`.

| Control | Parameter | Range | Effect |
|---|---|---|---|
| Expressiveness | `temperature` | 0.1–1.0 | Low = flat and consistent, high = varied and risky. |
| Word variety | `top_p` | 0.1–1.0 | Narrower = safer delivery. |
| Anti-repetition | `repetition_penalty` | 0.9–2.0 | Raise if the model loops or stutters. |
| Seed | `seed` | int / random | Lock for reproducibility; vary for takes. |
| Chunk size | `chunk_length` | 100–1000 | Advanced. Longer = more context, more VRAM. |
| Number/date normalisation | `normalize` | bool | Already exists in the UI conceptually. |
| Max length | `max_new_tokens` | int | Advanced; guard against runaway output. |

**"Narration Style" presets** stay in the UI but are honestly redefined as named
bundles of these parameters plus a suggested reference, e.g.

```
Documentary   → temperature 0.6, top_p 0.75, repetition_penalty 1.15
Storytelling  → temperature 0.85, top_p 0.9,  repetition_penalty 1.05
Audiobook     → temperature 0.7, top_p 0.8,   repetition_penalty 1.1
```

These numbers are starting points and must be tuned by listening; they are not
claims from the engine.

**"Generate 5 Voice Variants"** (button already exists) becomes real: same text
and reference, five different `seed` values, pick the best take.

## Phase 3 — Emotion via multi-reference (the honest replacement for tags)

Since expression comes from the reference, an "emotion" is a *sibling reference
of the same speaker*.

**Convention:** reference ids become `Speaker__Style`, e.g.

```
Aria__neutral   Aria__warm     Aria__urgent
Atlas__neutral  Atlas__somber  Atlas__excited
```

**UI:** the voice picker groups by speaker and exposes styles as a second
control, so "change the emotion" is one click and does not require re-cloning.
Voices with no variants simply show a single style.

**Sourcing:** the Expresso dataset (`ylacombe/expresso`) is professional voice
actors recorded in studio at 48 kHz **with labelled styles per speaker** —
exactly the shape needed. A notebook cell can install a variant pack the same
way the current premium pack is installed (condition, Whisper-transcribe,
measure). Note its clips are short, so several same-speaker/same-style
utterances may need concatenating to reach ~10 s.

**Per-scene emotion:** because the app already chunks text before synthesis
(`fish-adapter.js` splits at ~200 chars), a chunk can carry its own
`reference_id`. That gives genuinely per-passage emotion — closer to what the
tag system was reaching for, and it actually works.

## Phase 4 — Rename and retune the Speech Director

`public/kokoro-speech-director.js` (165 lines) is **not** Kokoro-specific in
substance. `generateProsodyPauses()` works purely by rewriting punctuation —
ellipses and paragraph breaks — and Fish reads punctuation. It transfers as-is.

Actions:

- Rename `window.KokoroSpeechDirector` → `window.BlvckSpeechDirector`, keeping a
  temporary alias. Update the "Kokoro Speech Director Studio" heading to name
  the active engine.
- **Fix a real bug:** line 65,
  `text.replace(/([,;—])\s+/g, '... ')` captures the punctuation and then drops
  it, so "Hello, world" becomes "Hello... world" and the comma is lost. It
  should preserve `$1`.
- Retune per engine. The documentary rule at line 70 inserts a pause after every
  preposition (`in… 1943`), which is heavy-handed; it needs listening tests
  against Fish specifically.
- **"Humanize Script" is a punctuation/pacing rewrite, not a tag inserter.** An
  LLM pass may re-punctuate, split long sentences, and add ellipses for beats.
  It must never emit bracket tags. Enforce this in the prompt *and* strip any
  `[...]` from the result before synthesis.

## Phase 5 — Preview and analysis

- **Preview selection:** synthesise only the highlighted substring. Trivial —
  it is just a shorter `text`. High value for tuning.
- **Side-by-side diff:** original script vs the processed text that will
  actually be sent. Since processing is punctuation-level, the diff is readable
  and genuinely useful.
- **Analysis panel — measurable metrics only:** word count, estimated WPM,
  sentence-length distribution, pause count, longest unbroken run. Drop
  "Human Realism %" and "YouTube Retention Potential" — we cannot compute those,
  and inventing them undermines trust in the panel.

---

## Suggested order

1. **Phase 4** (rename + bug fix) — small, immediate, unblocks honest labelling.
2. **Phase 2** (real parameter controls) — biggest quality win per hour; makes
   the sliders actually do something.
3. **Phase 1** (voice cloning upload) — the headline feature.
4. **Phase 5** (preview selection) — big tuning-speed win, small effort.
5. **Phase 3** (multi-reference emotion) — largest scope, depends on 1 and 2.

## Open decisions

- **Whisper transcribe endpoint in the tunnel** — worth the extra moving part,
  or require typed transcripts for cloned voices?
- **Preset values** — the Phase 2 numbers need a listening pass before they are
  trustworthy. Who tunes them, and against which reference script?
- **Expresso pack size** — how many speakers × styles before the picker becomes
  unwieldy?

## Verification

Each phase must be checked against the live tunnel, not a mock:

- Phase 1: upload a clip → it appears in `/v1/references/list` → synthesising
  with its `reference_id` returns audio that decodes (`decodeAudioData`,
  non-silent, expected duration).
- Phase 2: same text + seed + different `temperature` produces measurably
  different audio; same seed and params reproduces byte-comparable output.
- Phase 3: two styles of one speaker produce audibly different deliveries of an
  identical line.
- Phase 4: processed text contains no `[` tags; punctuation-only diff.
- Phase 5: preview of a selection returns audio shorter than the full script.
