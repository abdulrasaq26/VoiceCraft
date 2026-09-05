# AI Motion Specification Schema v3 (`motion-v3`)

This document defines the formal declarative application contract between the AI Motion Director and the AutoEditor Motion Compiler.

---

## Top-Level Schema

```json
{
  "schemaVersion": "motion-v3",
  "project": {
    "title": "Doctors Were Wrong About Cardio",
    "style": "cinematic-documentary",
    "palette": {
      "primary": "#FFFFFF",
      "accent": "#00E5FF",
      "background": "#0A0D14",
      "muted": "#8A99AD"
    },
    "defaultEasing": "power2.inOut"
  },
  "clips": [
    {
      "clipId": "s0",
      "sceneRole": "intro",
      "visualIntent": "Start with a restrained push-in toward the runner, establishing mystery.",
      "motionIntensity": 2,
      "camera": {
        "keyframes": [
          { "time": 0.0, "scale": 1.02, "x": 0, "y": 0 },
          { "time": 17.0, "scale": 1.08, "x": -20, "y": 0 }
        ],
        "easing": "power2.inOut"
      },
      "typography": [
        {
          "start": 0.6,
          "duration": 3.2,
          "text": "Why your cardio stopped working",
          "preset": "word-reveal",
          "position": "top",
          "size": "xl",
          "color": "#FFFFFF",
          "background": "pill",
          "emphasisWords": ["stopped", "working"],
          "accentColor": "#00E5FF"
        }
      ],
      "effects": [
        {
          "type": "vignette",
          "intensity": 0.6
        },
        {
          "type": "light-sweep",
          "start": 1.2,
          "duration": 0.8
        }
      ],
      "transitionIn": { "type": "fade", "duration": 0.8 },
      "transitionOut": { "type": "crossfade", "duration": 0.5 }
    }
  ]
}
```

---

## Field Specifications

### 1. Project Object (`project`)
- `title` (string, optional): Video or project title.
- `style` (string, required): Overall aesthetic:
  - `"cinematic-documentary"`
  - `"tech-modern"`
  - `"editorial-clean"`
  - `"bold-energetic"`
  - `"minimal-dark"`
- `palette` (object, required):
  - `primary`: Main text color (hex)
  - `accent`: Emphasis/highlight color (hex)
  - `background`: Card/pill background color (hex / rgba)
  - `muted`: Subtitle/secondary text color (hex)
- `defaultEasing` (string, optional): Default interpolation curve (e.g. `"power2.inOut"`).

---

### 2. Scene Roles (`clips[].sceneRole`)
Categorizes the narrative function of the clip:
- `intro`: Opening hook; gradual reveals, mood-setting.
- `setup`: Context establishment; steady camera, restrained typography.
- `explanation`: Core educational content; clean, readable, ample breathing room.
- `evidence`: Study/quote/data point; boxed cards, highlighted badges.
- `statistic`: Number/metric focus; large scale kinetic numbers, graph emphasis.
- `comparison`: Before vs After / A vs B; split-screen or sequential side-to-side reveals.
- `problem`: Tension / obstacle; tighter zoom, darker vignette, sharp accent.
- `solution`: Relief / answer; brighter tones, open camera drift.
- `emotional`: Human impact / introspection; slow drift, subtle parallax.
- `emphasis`: Punchy statement; scale punches, high contrast typography.
- `climax`: Narrative peak; highest motion intensity, dynamic transitions.
- `cta`: Call-to-action; clear, high-contrast badges, brand buttons.
- `outro`: Resolution / sign-off; gentle fade-out and hold.

---

### 3. Motion Intensity (`clips[].motionIntensity`)
Scalar scale from `0` to `5`:
- `0`: Static / Breathing room (pure image contemplation).
- `1`: Subtle (micro-drift, slow zoom `< 3%`).
- `2`: Normal (standard documentary camera push `5-8%`).
- `3`: Energetic (noticeable camera moves + kinetic text reveals).
- `4`: Dramatic (strong scale changes, rapid word accents, light sweeps).
- `5`: Hero / Climax (maximum dynamic scale, punch-ins, high-energy typography).

---

### 4. Camera Object (`clips[].camera`)
Controls the transform of the media wrapper:
- `keyframes`: Array of `{ time, scale, x, y, rotation, rotationX, rotationY, opacity }`.
  - `time`: Seconds relative to clip start (`0` = start of clip).
  - `scale`: Scale multiplier (`1.0` = fit, `1.08` = 8% zoom).
  - `x`, `y`: Pixel or percentage offsets from center.
  - `rotation`: Degrees of z-rotation.
- `easing`: GSAP easing curve (`"power1.inOut"`, `"power2.out"`, `"power3.in"`, `"back.out(1.4)"`, etc.).

---

### 5. Typography Array (`clips[].typography`)
Narrative-aware kinetic text elements:
- `start`: Relative second within the clip when text enters.
- `duration`: How long the text stays visible in seconds.
- `text`: The phrase or sentence to display.
- `preset`:
  - `"word-reveal"` (staggered word entrance with upward drift)
  - `"char-cascade"` (dynamic character cascade with slight rotation)
  - `"blur-reveal"` (high-end blur-to-sharp focus)
  - `"masked-reveal"` (text unmasks from behind a clipping plane)
  - `"fade-up"` (clean container fade and rise)
  - `"scale-punch"` (pops in with overshoot and settles)
  - `"typewriter"` (precise character-by-character cadence)
- `position`: `"top"`, `"center"`, `"bottom"`, `"lower-third"`, `"negative-left"`, `"negative-right"`.
- `size`: `"sm"`, `"md"`, `"lg"`, `"xl"`, `"2xl"`.
- `color`: Hex color (defaults to `project.palette.primary`).
- `background`: `"none"`, `"pill"`, `"bar"`, `"card"`, `"gradient"`.
- `emphasisWords`: Array of strings within `text` that receive scale punch, accent color, or highlight underlines.
- `accentColor`: Hex color for emphasis words.

---

### 6. Effects Array (`clips[].effects`)
Atmosphere and graphic treatments:
- `type`:
  - `"vignette"`: `{ intensity: 0.1 - 1.0 }`
  - `"glow"`: `{ color: "#...", spread: 10 - 50 }`
  - `"grain"`: `{ intensity: 0.04 - 0.15 }`
  - `"blur"`: `{ amount: 2 - 20, animateIn: duration }`
  - `"brightness"`: `{ value: 0.8 - 1.6 }`
  - `"contrast"`: `{ value: 0.8 - 1.5 }`
  - `"saturation"`: `{ value: 0.0 - 2.0 }`
  - `"light-sweep"`: `{ start: sec, duration: sec, angle: deg }`
  - `"accent-line"`: `{ position: "under", color: "#...", start: sec }`
  - `"shadow-bars"`: `{ heightPct: 8 }` (cinematic letterboxing)

---

### 7. Transitions (`transitionIn`, `transitionOut`)
- `type`:
  - `"cut"` (hard cut)
  - `"fade"` / `"crossfade"` (optical dissolve)
  - `"slide-left"`, `"slide-right"`, `"slide-up"`, `"slide-down"`
  - `"wipe-left"`, `"wipe-right"` (crisp mask wipe)
  - `"push-left"`, `"push-right"` (choreographed two-layer push)
  - `"blur-in"` (dissolve through optical blur)
  - `"zoom-through"` (camera flies through outgoing scene)
- `duration`: Transition duration in seconds (typically `0.3` - `0.6`).
