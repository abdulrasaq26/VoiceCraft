# AETHER Studio vNext — Architecture Blueprint

**Architecture first. No UI work begins until sections 1–5 are agreed.**

Current state: ~24,500 lines across 60 modules. Four files carry a third of it
(`app.js` 2595, `storyboard.js` 1866, `editor.js` 1463, `graphic-renderer.js`
1279). That concentration is the fragmentation — those files each own several
unrelated jobs, which is why a change to one keeps breaking another.

---

## 1. Architecture Map

### Six engines. Everything else is a plugin or a view.

| Engine | Owns | Must never own | Exists today |
|---|---|---|---|
| **Director** | what each beat should BE | timing, layout, pixels | partial — `prompts.js`, logic stranded in `ltx-video.js` |
| **Scene** | the canonical scene model + producers | rendering, timing | ✅ `scene-engine.js` |
| **Synchronization** | the timeline, providers, scheduling | rendering, layout | ✅ `sync-engine.js` + `playback.js` |
| **Character** | skeleton, clips, states, emotion, skins | its own clock | ✅ `character-engine.js` |
| **Audio** | narration, voices, cloning, alignment | visuals | partial — `fish-adapter.js`, `voice-cloning.js` |
| **Renderer** | pixels, given a scene + timeline + playback state | creative decisions, timing | partial — `graphic-renderer.js`, `editor.js` |

### The rule that keeps them separate

> An engine may **read** from Project Brain and **subscribe** to the event bus.
> It may not reach into another engine's internals, and it may not compute time.

Every cross-engine call today that violates this is listed in §6.

---

## 2. Engine Diagram

```
                        ┌──────────────────┐
                        │  PROJECT BRAIN   │  single store, every studio reads it
                        └────────┬─────────┘
                                 │
   ┌──────────┬──────────┬───────┴────┬──────────┬──────────┐
   ▼          ▼          ▼            ▼          ▼          ▼
RESEARCH   SCRIPT    DIRECTOR      AUDIO     SCENE      RENDERER
                        │            │          │          │
                        │            ▼          │          │
                        │      SYNCHRONIZATION  │          │
                        │       (timeline)      │          │
                        │            │          │          │
                        └────────────┼──────────┘          │
                                     ▼                     │
                            PLAYBACK CONTROLLER            │
                             one clock · one bus           │
                                     │                     │
                                     └─────────────────────┘
                                              │
                                         CHARACTER
                                        (drawn actors)
```

**Direction of dependency is one-way.** Renderer depends on Scene + Sync.
Scene depends on Sync. Sync depends on nothing. Director depends on Brain only.
Any arrow pointing back up is a bug.

---

## 3. Project Brain

The missing piece, and the thing that prevents re-fragmenting.

Today project state is scattered across **19 localStorage keys** written by
whichever module happened to need them (`blvck-tts:storyboard`,
`blvck-tts:batch`, `blvck-tts:subtitles`, `blvck:keys_fishaudio`,
`blvck-tts:channel-host`, …). Nothing owns the schema, so every module invents
its own read/write and they drift — which is exactly how "Voice complete" and
"nothing to assemble" became simultaneously true.

```js
ProjectBrain = {
  id, title, createdAt, updatedAt,

  research:  { topic, audience, sources[], brief },
  script:    { text, wordCount, targetSec, tone },
  audio:     { voiceId, cloneRefs[], batchId, srt, durationSec },
  timeline:  { source, confidence, words[], sentences[], pauses[] },
  scenes:    [ Scene ],                    // the canonical model
  plan:      { mode, mix{}, rejected[], retention{} },
  brand:     { host, palette, font, channelName },
  visual:    { style, assetMode, resolution },
  export:    { resolution, fps, lastRenderAt }
}
```

**One writer per branch.** Research writes `research`, Audio writes `audio`,
Director writes `plan` and annotates `scenes`. Everyone else reads. That single
rule is what stops the drift.

---

## 4. Studios (navigation)

Seven studios, one job each. A studio is a *workflow*, not a page of controls.

| Studio | The one question it answers | Engines | Absorbs today's |
|---|---|---|---|
| **Dashboard** | what's in flight? | — | scattered status bars |
| **Research** | what is this video about? | Director | `research.js` |
| **Script** | what does the narrator say? | Director | `script.js`, parts of `app.js` |
| **Voice** | how does it sound? | Audio, Sync | `app.js`, `voice-cloning.js`, `speech-director.js` |
| **Scene** | what happens, and when? | Scene, Director, Sync | `storyboard.js`, `ltx-ui.js` |
| **Visual** | what does each beat look like? | Renderer, Character | `graphic-renderer.js`, `images.js`, `stickman` |
| **Assembly** | does it play correctly? | Playback, Sync, Renderer | `editor.js` |
| **Export** | ship it | Renderer | export half of `editor.js` |

**The Director is not a studio.** It is a persistent panel available in every
studio, because its job is advising wherever you are. It is the only global
surface.

---

## 5. Data Flow

```
Topic
  └─▶ RESEARCH  ──────────────────▶ brain.research
        └─▶ SCRIPT ────────────────▶ brain.script
              └─▶ VOICE ───────────▶ brain.audio  (audio + measured SRT)
                    └─▶ SYNC ──────▶ brain.timeline
                          │              │
                          │      (Whisper alignment upgrades
                          │       measured → aligned)
                          ▼
                       SCENE ENGINE ──▶ brain.scenes
                          │
                          ▼
                       DIRECTOR ─────▶ brain.plan  + annotates scenes
                          │
                          ▼
                       RENDERER ─────▶ assets per scene
                          │
                          ▼
                   PLAYBACK CONTROLLER
                          │
                          ▼
                       EXPORT
```

**Timeline before scenes.** This inverts today's order and is the single most
important change: scenes are *derived from narration timing*, not the other way
round. It is why the storyboard stops being mandatory.

---

## 6. Refactor Plan

### Split (files doing several jobs)

| File | Lines | Split into |
|---|---|---|
| `app.js` | 2595 | `voice-studio.js`, `subtitle-engine.js` (→ timeline), `project-brain.js` |
| `storyboard.js` | 1866 | `scene-studio.js`, `scene-producers.js` (→ Scene Engine), `asset-queue.js` |
| `editor.js` | 1463 | `assembly-studio.js`, `export-engine.js`, `compositor.js` |
| `graphic-renderer.js` | 1279 | `renderer/cards.js`, `renderer/data-viz.js`, `renderer/thumbnail.js` |

### Merge

- `speech-timeline.js` + `sync-engine.js` → one Synchronization Engine
  (the first is now only a helper library for the second)
- `stickman.js` → `character-engine.js` (superseded; stickman is a *skin*)
- `character-library.js` + `channel-host.js` → `cast.js` (both are identity)

### Delete, in this order

1. **Extract first** — routing already moved to `scene-engine.js` ✅
2. `ltx-ui.js`, `ltx-adapter.js`, `ltx-video.js` (~1,890 lines)
3. LTX branches in `prompts.js`, `channel-modes.js`, `retention.js`

**Do not delete before extracting.** `ltx-video.js` still holds
`splitPlan` and `stillPromptFor`, which are not LTX-specific.

### Known violations to fix during the move

- `editor.js` reads `localStorage['blvck-tts:storyboard']` directly → must go through Scene Engine
- `app.js` computes subtitle timing independently → must consume `timeline.words`
- `storyboard.js` owns both scene production *and* asset generation → separate
- `graphic-renderer.js` calls `BlvckScenes` and `BlvckGeo` and `BlvckStick` → renderer reaching sideways; should receive what it needs as arguments

---

## 7. Migration Plan

Each step ships working. No big-bang rewrite — this codebase has ~24k lines of
behaviour that works, and a rewrite would lose the measured fixes (A/V sync,
the ngrok ceiling, the cost model) that were expensive to find.

| Step | Change | Ships | Risk |
|---|---|---|---|
| 1 | `project-brain.js` — one store, adapters over the 19 keys | nothing visibly | low |
| 2 | Subtitles consume `timeline.words` | captions match the mouth | low |
| 3 | Whiteboard + motion graphics consume the timeline | visuals land on words | medium |
| 4 | Split `editor.js` → assembly + export | — | medium |
| 5 | Split `storyboard.js` → Scene Studio + producers | storyboard optional | medium |
| 6 | Delete LTX | −1,890 lines | low, once extracted |
| 7 | Studio navigation shell | the visible redesign | high |
| 8 | Design system + component library | consistency | medium |

**Steps 1–6 are architecture and change no pixels.** Step 7 is the first the
user sees. Doing 7 before 1–6 is what would force a second rebuild.

---

## 8. Design System (defined now, applied at step 8)

```
bg          #0B1020      text        #F8FAFC
bg-2        #121A2D      muted       #94A3B8
panel       #1A2438      accent      #5B8CFF
                         accent-2    #7C4DFF
success     #22C55E      warning     #F59E0B      danger  #EF4444
```

Spacing on a 4px grid. Two type sizes per level, never more. Every surface is
one of: **card**, **panel**, **drawer**, **inspector**, **toolbar**. If a new
component is needed, it goes in the library — no one-off styling.

---

## Open decisions

1. **Storyboard's future** — visual view of scenes, or deleted? It is 1,866
   lines and its production role is now the Scene Engine's.
2. **Presenter beats** — route to the composited host overlay (canvas, never
   drifts, already built) rather than a generator, now LTX is going?
3. **SDXL's scope** — custom illustration only, or dropped entirely? With
   procedural-first it may earn its keep only for hero shots.
