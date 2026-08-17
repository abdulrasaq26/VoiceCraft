# Narration timing: measured, not estimated

Verified against the live Fish backend on Kaggle, not simulated.

## The chain

    Fish Speech  /v1/tts     generates the narration
    Fish Speech  /v1/align   faster_whisper small.en on CPU -> word timings
    sync-engine.js           forced-alignment provider, gated on /aether/status
    Transcript.fromSyncTimeline   aligned timeline -> measured transcript
    subtitles.srt + Director payload
    Timing.validatePlan      arithmetic check on whatever the Director returns

Whisper runs on the machine that made the audio, and on CPU, so it competes
with nothing: not the Director's 20 GB of weights, and not Fish's own GPU work.

## What was measured

| | |
| :-- | :-- |
| Narration | "People don't realize that prices have risen by nearly forty percent." |
| Voice | Sophia_Female_Narrator |
| TTS | 401,452 bytes of WAV in 20.7s |
| Alignment | 4.551s of audio in 11.1s, 11 words |
| Aligner | faster_whisper small.en, int8, CPU |

Word offsets returned:

    People      0.00 -  0.26
    don't       0.26 -  0.68
    realize     0.68 -  1.14
    that        1.14 -  1.46
    prices      1.46 -  1.84
    have        1.84 -  2.14
    risen       2.14 -  2.50
    by          2.50 -  2.80
    nearly      2.80 -  3.18
    forty       3.18 -  3.62
    percent.    3.62 -  4.16

## Why this matters editorially

The phrase "forty percent" is spoken at **3.18s**, in a 4.55s clip. A statistic
card placed at the top of its scene would appear 3.2 seconds before the number
is said. Anchored to the transcript it lands at 3.03s — a beat early, so the
picture and the words arrive together.

That is the whole argument for measured timing over estimated timing, in one
number.

## Turning it on

`/aether/status` must report `"alignment": true`. Only
`AETHER_FishSpeech_Colab.ipynb` does; `Fish_Speech_Colab.ipynb` has neither the
route nor the flag. If the flag is absent, sync-engine's probe returns false,
no alignment is attempted, and timing falls back to per-chunk durations
labelled `estimated` — which every guard downstream then refuses to build an
SRT or a storyboard from.
