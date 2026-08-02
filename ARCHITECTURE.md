# AETHER Studio — Engine Architecture

An AI explainer-video studio. The user supplies a topic; the system researches,
writes, storyboards, narrates, renders and cuts a finished video.

This document describes engine boundaries, event flow and the contracts between
them. **Update it in the same commit as any change to those boundaries** — the
point is to stop architectural drift, and a stale map is worse than none.

---

## The one rule

> **Procedural first. The GPU is the exception, and it must justify itself.**

Measured on real hardware, not assumed:

| approach | cost per visual | consistency |
|---|---|---|
| LTX video beat | ~300,000 ms | different every run |
| SDXL still | ~8,000 ms | different every seed |
| Procedural (canvas/skeleton) | ~1 ms | byte-identical |

A generated shot also cannot be corrected without re-rendering, while a drawn
one stays editable. So a beat reaches for the camera only when nothing drawn can
carry the idea.

## The second rule

> **One clock. No subsystem owns a timing loop.**

Every subsystem used to run its own. Visemes cycled on elapsed time, whiteboards
drew at a fixed rate, charts animated on `setTimeout`. Nothing could be seeked,
scrubbing desynchronised everything, and a mouth moved while the narrator was
silent — because "now" meant something different in each subsystem.

---

## Engines

| engine | file | owns | never owns |
|---|---|---|---|
| **AI Director** | `prompts.js`, `ltx-video.js` | what each beat should BE | timing, layout |
| **Synchronization** | `sync-engine.js` | the timeline, providers, event scheduling | rendering |
| **Playback** | `playback.js` | the clock, the event bus, the single rAF loop | what things look like |
| **Character** | `character-engine.js` | skeleton, clips, states, emotion, skins | its own clock |
| **Renderers** | `graphic-renderer.js`, `geo-map.js`, `editor.js` | pixels | timing, creative decisions |

Not yet built: a **Scene Engine** (layout, camera, composition, safe areas).
Layout currently lives inside each renderer, which is the main remaining
fragmentation.

---

## Data flow

```
Topic ─▶ Research ─▶ Script ─▶ Storyboard
                                   │
                                   ▼
                            AI DIRECTOR
                     (visualType, camera, emotion,
                      continuity, retention audit)
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
             PROCEDURAL                        GENERATED
      stickman · whiteboard · chart        t2v · presenter · broll
      map · timeline · diagram                (LTX / SDXL)
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
Narration ─▶ SYNCHRONIZATION ENGINE ─▶ Timeline
                                   │
                                   ▼
                          PLAYBACK CONTROLLER
                        (one clock, one rAF loop)
                                   │
                              EVENT BUS
                                   │
        ┌──────────┬───────────┬───┴────┬──────────┬─────────┐
        ▼          ▼           ▼        ▼          ▼         ▼
    character  whiteboard   motion   subtitles  camera   editor
```

---

## The Timeline (the shared data model)

Produced by the Synchronization Engine, consumed by everything.

```js
{
  source: 'native' | 'phoneme' | 'aligned' | 'measured' | 'estimated',
  confidence: 1 | 0.95 | 0.9 | 0.6 | 0.3,
  provider: 'aether-forced-alignment',   // when aligned
  duration: 2.74,
  words:     [{ text, start, end }],
  sentences: [{ index, text, start, end }],   // scene anchors
  pauses:    [{ start, end, sec }],           // real breaths
  phonemes:  [{ symbol, start, end }]         // when available
}
```

### Capability ladder

The engine walks it and tags the result honestly. **Nothing pretends to be
better than it is** — a renderer can check `confidence` and behave accordingly.

1. `native` — the narrator returned its own word timings
2. `phoneme` — phoneme timings exist; words derived
3. `aligned` — forced alignment ran on the rendered audio
4. `measured` — real audio duration, words distributed by **syllable** weight
5. `estimated` — text only, and it says so

**Fish Speech returns audio and nothing else** — no request field for
alignment, response is an `arrayBuffer`. Alignment therefore comes from
`POST /v1/align` on the Fish notebook, which reuses the `faster_whisper` model
already loaded there for voice cloning. Whisper stays on **CPU**: it shares a
16 GB card with Fish's model, and putting it on the GPU caused a boot-time OOM.

### Adding a narration provider

Implement one adapter. Nothing else changes.

```js
BlvckSync.register({
  name: 'elevenlabs',
  priority: 5,                       // lower runs first
  probe: async () => boolean,        // is it reachable right now?
  align: async ({ audio_b64, text }) => ({ duration, words })
});
```

A provider that throws drops to the next rung. Alignment is an improvement,
never a requirement.

---

## Event Bus

```js
BlvckPlayback.on('wordStart', ({ word, time }) => …);
BlvckPlayback.state();     // pull: what is true right now
```

Emitted: `frame`, `wordStart/End`, `sentenceStart/End`, `pauseStart/End`,
`speakingStart/End`, `seek`, `play`, `pause`, `rateChanged`, `ended`,
`timelineChanged`, plus every scheduled semantic event type.

**Semantic scheduling.** The Director never says a number:

```js
{ at: 'blood pressure', type: 'gesture', action: 'point' }
{ sentence: 1, type: 'camera', action: 'zoomIn' }
{ at: 'first', after: true, type: 'camera', action: 'zoomOut' }
```

A cue that cannot be resolved is **dropped, never given an invented time** — an
event on the wrong word is worse than no event. This is also why a plan survives
re-narration at a different pace or in a different voice.

**When an `<audio>` element is bound it becomes the clock.** A separately
accumulated rAF timer drifts against real audio within seconds.

---

## Character Engine

A **skeleton**, not a pose table. The table it replaced could not blend, could
not transition, and multiplied: `point` × 15 emotions was 15 poses to hand-tune.

- **Bones** — parent/child; a bone inherits its parent's tip and rotation, so
  leaning the torso carries the arms for free
- **Clips** — keyframes over time with smoothstep easing; only bones that MOVE
  appear in a keyframe
- **States** — cross-fade between clips; nothing snaps
- **Emotion** — a wholly separate layer

16 clips × 15 emotions × 3 skins = **720 combinations from 34 definitions**.

**Skins** (`stickman`, `whiteboard`, `flat2d`) draw resolved bones. Adding a
look is one function — never another animation system.

---

## Visual routing

`visualType` decides where a beat goes. Six of nine never touch a GPU.

| type | renderer | GPU |
|---|---|---|
| `stickman` | character engine | no |
| `whiteboard` `chart` `map` `timeline` `diagram` | canvas | no |
| `t2v` `broll` | LTX | yes |
| `presenter` | LTX + host refs | yes |

Cards are **validated against what the beat contains** and rerouted when they
cannot be supported — a map with no place named, a timeline with one date, a
chart with one number. The reason is recorded in `plan.rejected[]`.

Maps use bundled Natural Earth 110m geodata (175 KB, 2 dp). They **refuse
rather than guess**: an unresolvable or ambiguous place falls back to a locator
card, because a confidently wrong map is worse than none.

---

## Backends

| service | role | notes |
|---|---|---|
| **Fish Speech** | narration + voice cloning | also hosts `/v1/align` |
| **SDXL** | custom illustration only | style LoRAs swap per request |
| **LTX 2.3** | filmed beats only | async job queue; poll `/jobs/{id}` |

**LTX renders must be asynchronous.** Measured: 269 s returned fine, 301 s and
302 s both died — ngrok cuts a request at ~300 s, and every useful render is
longer. `POST /generate` returns a job id; the client polls.

**Cost is a floor plus a marginal rate**, not proportional to length: ~300 s
covers the first 5 s, then ~90 s per additional second (480p; scale by pixel
area for other resolutions). So long beats are **split into several clips** —
cheaper *and* better paced.

**The checkpoint decides the medium.** A 2D-animation prompt with no
photographic language still returned a photograph from RealVisXL. Prompting
cannot move a model off what it was fine-tuned for; style LoRAs can.

---

## Conventions

- **Verify against reality, not the code.** Almost every bug in this project
  passed its logic tests: the ngrok ceiling, a `status`/`message` key collision,
  a cache key missing an input, `props` reaching one prompt and not the other.
  Render it and look at it.
- **Fail loudly, never silently.** An empty `catch` that swallows a real error
  has cost this project more time than any other single pattern.
- **Say which tier you are on.** `source` and `confidence` exist so nothing
  downstream mistakes an estimate for a measurement.
