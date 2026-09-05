# Motion Design Rules & Creative Quality Standards

To ensure AutoEditor produces motion graphics comparable to high-end studios (and avoids the "cheap automated video" look), the AI Motion Director and Compiler must strictly obey these design laws.

---

## 1. The Cardinal Rule of Restraint
**Never apply every effect to every scene.**
- Professional motion design is defined by contrast: high-energy moments only feel powerful if preceded by calm, restrained moments.
- If a 60-second video has 10 clips, only 1 or 2 clips should be intensity `4` or `5`. The majority (`60-70%`) should be intensity `1` or `2`.
- Avoid "motion sickness": camera drift should be slow, controlled, and intentional (`scale 1.02 → 1.07` over 15 seconds is vastly superior to `scale 1.0 → 1.30`).

---

## 2. Facial & Subject Protection
**Never place large typography or graphic cards directly over human faces or key subject focal points.**
- If an image features a person on the right (e.g. runner, doctor, presenter), position kinetic text in the negative space on the left (`position: "negative-left"` or `"top"`).
- If the subject is centered, place typography either at the lower-third or top safe zone.
- Use backdrop pills (`background: "pill"`) or semi-transparent cards to guarantee text readability without having to blast pure white text over high-frequency backgrounds.

---

## 3. Typography Hierarchy & Rhythm
**Never output plain unformatted text blocks.**
- **Headline vs Subtitle**: Large impactful headlines (32-54px) should never compete with narration subtitles (18-24px).
- **Word-level Emphasis**: Highlight 1 to 2 key trigger words per phrase using color accents (e.g., `#00E5FF`, `#FFD600`) and slight scale punches.
- **Timing Alignment**: The typography must enter **in sync** with the speaker saying the word (derived from the SRT timing). A visual appearing 2 seconds before or after the audio feels amateur.

---

## 4. Visual Language & Color Cohesion
**Stick to a cohesive palette across the entire project.**
- Do not mix random neon colors across different clips.
- A project must declare its palette (e.g., Deep Navy `#0B111E`, Accent Cyan `#00F0FF`, White `#FFFFFF`, Slate `#94A3B8`).
- All pills, underlines, light sweeps, and glows must use colors from this palette.

---

## 5. Transition Motivation
**Every transition must have a narrative reason.**
- **Hard Cut**: Default for explanatory continuity between related scenes.
- **Crossfade**: Used for time passage, mood change, or emotional softening.
- **Push / Slide**: Used when comparing two ideas or moving laterally in a list.
- **Wipe**: Used for sharp thematic turns or chapter shifts.
- **Blur / Zoom-through**: Reserved for major revelations, flashbacks, or climaxes.

---

## 6. Seek-Safe Determinism
**Animations must be mathematically calculable at any arbitrary frame.**
- Never use random generators without a fixed seed.
- Never use continuous unanchored timers (`Date.now()`).
- All animations must be anchored to explicit clip or project seconds.
