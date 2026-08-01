# Pipeline test script — "The Fertilizer Ban"

A ~60-second script chosen to exercise **every** visual path in one short run.
Niche: economic-history explainer (Johnny Harris / MagnatesMedia territory).

Why this topic: it is the only one I could find that naturally contains all
seven visual types without anything feeling forced — real geography (map), a
dated sequence (timeline), hard numbers (chart), a causal mechanism worth
drawing (whiteboard), filmable human moments (t2v), and a presenter argument
worth making to camera. If a beat type had to be shoehorned in, the test would
be measuring the wrong thing.

**Channel mode to select:** Documentary
**Resolution:** 480p
**Estimated cost:** 5 filmed beats ≈ 25 min GPU · 3 typeset beats ≈ instant

---

## The narration (paste this into Script)

> In April 2021, Sri Lanka banned chemical fertilizer overnight. The government
> called it the world's first fully organic agriculture.
>
> Farmers called it something else.
>
> Sri Lanka sits in the middle of the Indian Ocean's rice belt. Two million
> farmers. A third of the workforce. Working land that had run on imported
> nitrogen for fifty years.
>
> Here is what nobody modelled. Remove synthetic nitrogen and yields do not fall
> gradually. Soil nitrogen is drawn down within a single season. Rice needs it at
> tillering — and if you miss that window, the plant sets fewer grains. The loss
> is locked in months before anyone reaches the harvest.
>
> Within six months, rice production fell twenty percent. Tea, the country's
> largest export, fell eighteen. By November the ban was reversed. By March 2022
> the government itself had fallen.
>
> Fifty years of soil chemistry undone in one planting season. The lesson was
> never that organic farming fails. It is that transitions have a speed limit.

~165 words ≈ 62 seconds at documentary pace.

---

## What each beat is testing

| # | Narration | visualType | Host | Exercises |
|---|---|---|---|---|
| 1 | "In April 2021… organic agriculture." | `presenter` | `full` | Host reference conditioning, full-frame layout |
| 2 | "Farmers called it something else." | `t2v` | `none` | Text-to-video with no source image |
| 3 | "Sri Lanka sits in the middle…" | `map` | `corner` | Canvas map + overlay composited over it |
| 4 | "Here is what nobody modelled…" | `whiteboard` | `circle` | Canvas whiteboard, numbered steps, small overlay |
| 5 | "Within six months… fell eighteen." | `chart` | `none` | Canvas bar chart, accent on the payoff bar |
| 6 | "By November… had fallen." | `timeline` | `none` | Canvas timeline, dated rail |
| 7 | *(under narration)* | `broll` | `none` | Second t2v path, atmospheric |
| 8 | "Fifty years… speed limit." | `presenter` | `rect` | Host again — identity must match beat 1 |

**The consistency test is beats 1 and 8.** Same host, seven beats apart, at two
different overlay sizes. If the face drifts between them, the channel-host
system has failed at the one job it exists for.

---

## Channel Host profile to enter

```
Channel name:     (your channel)
Host name:        James
Gender:           Male
Age range:        35-45
Clothing:         Casual business
Personality:      Friendly and trustworthy
Speaking style:   measured, direct, warm
Overlay layout:   Circular avatar
Size:             Medium
Position:         Bottom right
Backdrop:         Studio
```

---

## Generating the host reference images

SDXL cannot run while LTX holds the GPU, so the portraits come from LTX itself
using a trick that is better than two separate generations anyway:

**Render one clip of the host turning their head**, then pull the front-facing
frame and the profile frame out of that single clip. Both images are then
guaranteed to be the same person — two independent generations never are.

Prompt used:

```
medium shot, static locked-off camera. a 35-45 year old man with short dark
hair and light stubble, wearing a casual business shirt, seated in a clean
modern studio with soft key lighting and a subtly blurred backdrop. he begins
facing the camera directly, then slowly turns his head to the left until his
profile is to camera. calm, friendly expression. shallow depth of field,
natural skin texture, documentary interview lighting
```

Settings: `mode: T2V`, `target_sec: 3`, `resolution: 480p`, `aspect: 16:9`,
fixed seed so it can be reproduced.

Then: frame at t=0.0s → **face reference**, frame at t≈2.6s → **side reference**.

---

## Order to run

1. Channel Host — upload the two frames, fill the profile above
2. Channel mode → **Documentary**, resolution → **480p**
3. Paste the narration into Script
4. Generate voice (Fish Speech)
5. Storyboard → generate scenes
6. **Plan shots with Director** — check the reported mix and retention notes
   *before* spending GPU time
7. Generate all scene clips (~25 min)
8. Auto-assemble from project
9. Play it through, then export

## What to watch for at each stage

- **After step 6:** does the plan report roughly the Documentary mix, and does
  it put the host on beats 1, 3, 4 and 8? Any retention warnings?
- **After step 7:** do the three canvas beats appear instantly while only five
  hit the GPU?
- **After step 8:** does the status line mention rescaling the picture track to
  the narration? Does the total runtime match the voice?
- **In playback:** subtitles on the right words; pictures on the right beat;
  host identical in beats 1 and 8.
