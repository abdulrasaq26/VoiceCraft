# AI-Directed Motion Graphics Architecture

## 1. Vision & Core Philosophy

AutoEditor is not an After Effects clone. It is an **AI Motion Director + Deterministic Motion Graphics Compiler**.

The user provides:
1. **Narration Audio** (voiceover track)
2. **SRT Subtitles** (word and phrase level timing)
3. **Storyboard Visuals** (AI-generated images and video clips placed on timeline slots)
4. **Project Style / Creative Prompt** (e.g. "cinematic documentary with bold kinetic typography and restrained camera drift")

The AI does not generate raw code (GSAP, HTML, or WebGL). Instead:
- **AI Motion Director** analyzes the narrative rhythm, emotion, semantic image content, and pacing to produce a declarative, structured **AI Motion Specification (`motion-v3`)**.
- **Deterministic Motion Compiler** translates the specification into modular **HyperFrames Composition Layers**, orchestrating GSAP timelines, SVG masks, CSS typography, and WebGL/Canvas effects.
- **HyperFrames Runtime** executes the composition deterministically frame-by-frame (`renderHyperFrame(time)`).
- **AWS Lambda** renders high-resolution MP4s in parallel chunks.

```
                  ┌──────────────────────────────────────────────┐
                  │                 USER INPUT                   │
                  │  Voiceover Audio + SRT Timestamps + Images   │
                  │        + Creative Direction / Style          │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │          AI MOTION DIRECTOR LAYER            │
                  │   Story Beats • Scene Roles • Visual Intent  │
                  │    Camera Moves • Typography • Accent Beats  │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼ (motionSpec.json v3)
                  ┌──────────────────────────────────────────────┐
                  │         VALIDATOR & NORMALIZER ENGINE        │
                  │  Safety Checks • Clip ID Matching • Clamp    │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼ (Validated AST)
                  ┌──────────────────────────────────────────────┐
                  │        DETERMINISTIC MOTION COMPILER         │
                  │  Animation Engine  •  Typography Engine      │
                  │  Effects Engine    •  Transition Engine      │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼ (HyperFrames Composition v3)
                  ┌──────────────────────────────────────────────┐
                  │          HYPERFRAMES RUNTIME (HTML)          │
                  │   GSAP Timelines • SVG/CSS • Canvas/WebGL    │
                  │         Frame-by-Frame Determinism           │
                  └──────────────────────┬───────────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
               ┌───────────────────┐           ┌───────────────────┐
               │  BROWSER CANVAS   │           │   AWS LAMBDA      │
               │   Live Preview    │           │ Parallel Cloud MP4│
               └───────────────────┘           └───────────────────┘
```

---

## 2. Separation of Concerns: The Three Engines

The compiler separates motion into three distinct, non-overlapping engines:

### A. Animation Engine
- **Transforms**: Position (`x`, `y`), scale, rotation, 3D tilt (`rotationX`, `rotationY`), skew.
- **Camera Movement**: Subtle drift, cinematic push-ins, parallax shifts, focal re-centering.
- **Pose Ladders & Keyframes**: Strict seek-safe keyframe trajectories with mathematical easing curves (`power2.inOut`, `back.out`, `bounce.out`).
- **Subject-Aware Framing**: Keeps heads, faces, and core focal subjects inside safe areas while allowing negative space for typography.

### B. Effects Engine
- **Atmosphere & Depth**: Vignettes, volumetric glow, subtle film grain, light sweeps, color tinting, letterbox shadows.
- **Graphic Accents**: Accent lines, geometric pills, spotlight highlights, masked reveals, divider rules.
- **Restraint**: Rules enforce that effects are motivated by narrative beats (e.g., tension, revelation, climax), never applied uniformly or excessively.

### C. Transition Engine
- **Scene-to-Scene Handoffs**: Transitions only occur at clip boundaries or major narrative segment turns.
- **Choreographed Primitives**: Seamless crossfades, directional slide/pushes, optical wipes, depth zoom-throughs, and blur-ins.
- **Narrative Motivation**: Intros use subtle fades; explanatory scenes cut cleanly; thematic shifts use directional wipes or crossfades.

---

## 3. Kinetic Typography & The SRT Beat Map

The SRT file is not just for subtitle display; it is the **musical score** for visual animation.
Words carry weight:
- **Lead-in words**: Small, understated, staggered reveals (`word-reveal`, `slide-up`).
- **Keyword emphasis**: Scaled punch (`0.92 → 1.08 → 1.00`), color accent, glow punch, or underline draw.
- **Rest & Breathing Room**: Explanatory clips allow the image to breathe with minimal or zero intrusive typography.
- **Positioning**: Automatically assigned to negative space (top, bottom, lower-third, side cards) so the image's subject is never obscured.

---

## 4. Deterministic Rendering Contract

HyperFrames rendering requires 100% determinism:
1. No asynchronous timeline generation during scrubbing.
2. No reliance on `setTimeout`, `Date.now()`, or non-deterministic random math.
3. Master GSAP timeline is paused at creation; playback and rendering are strictly driven by `window.renderHyperFrame(timeSeconds)` / `timeline.seek(time)`.
4. Asset preloading gate ensures all images, fonts, and video frames are loaded before the first frame is rendered.
