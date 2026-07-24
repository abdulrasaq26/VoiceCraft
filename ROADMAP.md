# Blvck-TTS — Roadmap

> **Vision shift:** Blvck-TTS is not a general "AI video studio." It is becoming an
> **autonomous YouTube channel operating system** — one idea in, an entire channel that
> researches, produces, packages, publishes, and *learns from its own analytics*, out.
>
> The north star: **one idea → the channel runs itself.**

The tools are already strong. The product is the **connective tissue** — orchestration,
memory, and automation matter more than adding another model. This roadmap front-loads the
**orchestration spine** and the **research grounding**, because they multiply the value of
every existing module.

Full strategic dossier (audit of all 19 modules, orchestration architecture, cost strategy):
the *Blvck-TTS Product Audit & AI Director 2.0 Blueprint* artifact.

---

## Status legend

`✅ shipped` · `🔨 in progress` · `⬜ planned`

---

## Phase 0 — The spine · *orchestration & grounding* (P0, now)

The two changes that convert a shelf of tools into an intelligent studio.

- ✅ **AI Director 2.0 — model-capability registry + task-aware router.**
  `public/model-registry.js` scores every discoverable model on reasoning / storytelling /
  planning / coding / structure / speed / cost / reliability, and routes each task
  (research, script, storyboard, SEO, image-prompt, code, audit…) to the best available
  model — replacing the old one-size regex. Unknown/self-hosted models get a heuristic
  profile so any Puter instance routes sensibly. Wired through `ai-provider.js`
  (`resolveChatModel(task)`, `_chatResilient(…, task)`, `modelForTask(task)`).
- ✅ **Cost objective dial** — Maximum Quality / Balanced / Lowest Cost, in ⚙ AI settings,
  reweights every model pick. Default: Balanced.
- ✅ **Fallback & recovery (chat)** — self-healing retry that cycles the task-ranked models
  and never clobbers the user's explicit choice; auth lapses re-surface the connection banner.
- ⬜ **Generalize fallback to all modalities** — extend the same ladder to image, video and
  TTS (image already has a candidate ladder; make it registry-driven).
- ✅ **Research System** — `public/research.js` + the `/api/research` prompt route turn a
  topic into a structured brief (summary, angles, hooks, key facts *with confidence +
  verify flags*, entities, timeline, keywords, title directions) via the strongest
  reasoning model (task `research`). Stored in project memory; **grounds the script**
  (auto-injected into the script prompt) **and SEO** (keywords fed to the SEO prompt);
  hands off to the Script studio; shows an honesty disclaimer so nothing is presented as
  verified fact. *Next:* optional live-web sourcing where the Puter instance supports it.
- ⬜ **Per-stage routing in auto-run** — the Director auto-run picks the right model for
  each stage automatically, with a quiet "using *model* for *task*" transparency line.
- ⬜ **Idea → full draft quickstart** — one prompt runs the whole gated pipeline; value in
  the first session.

## Phase 1 — The brain · *quality, cost & memory* (P1, next)

Where the channel starts getting **smarter with every video**.

- ⬜ **Channel Brain (cross-project memory).** The single highest-leverage addition after the
  spine. Per-channel profile that remembers: visual style, narration style, audience,
  thumbnail style, **CTR winners**, **retention winners**, best topics, best hooks — and
  biases every future generation. *"Mystery + danger titles outperform daily-life titles"*
  becomes an automatic bias, not a manual note. Builds on the existing channel knowledge
  base + project-memory snapshot.
- ⬜ **Story-level retention optimization.** Score every script *before* production —
  hook strength, open loops, curiosity triggers, tension points, re-engagement beats, CTA
  placement — e.g. *"Retention 91/100 · weak tension min 8–10 · move the ox injury earlier."*
- ⬜ **Cost meter & pre-flight estimates** — expected credits/time on every generate button;
  a running per-project tally and optional budget cap that shifts to cheaper models near the limit.
- ⬜ **Editor upgrades** — music bed + auto-duck under narration, brand kit
  (intro/outro/lower-thirds), transition library.
- ⬜ **Character consistency 2.0** — canonical character sheets (turnaround + expressions)
  reused as the reference everywhere, plus a drift audit. Image variations / upscale;
  image-to-video from the approved still.
- ⬜ **Continuous QC** — the audit runs in the background per stage, flagging a weak hook,
  drifting character, or low-CTR thumbnail with one-click fixes.
- ⬜ **Performance** — bounded-concurrency generation, result caching, usage telemetry.

## Phase 2 — The channel · *packaging, scale & distribution* (P2, later)

- ⬜ **Thumbnail Lab.** Generate ~10 thumbnail variants, score curiosity / contrast / emotion /
  readability, and let the Director pick the winner. CTR is the highest-leverage growth lever —
  a great thumbnail on a mediocre video beats the reverse.
- ⬜ **Historical Continuity Engine** *(Born Back Then)* — a timeline database of characters,
  villages, events and recurring references so future episodes stay canon automatically
  (Ep. 1 = 1345 → Ep. 6 = same village → Black Death foreshadowing). A genuine moat few
  channels can match.
- ⬜ **Publish & schedule** — YouTube Data API: upload, schedule, thumbnail, chapters, end screens.
- ⬜ **Auto-repurpose** — Shorts, chapters, and a full metadata package generated on finish.
- ⬜ **Asset Library** — tagged, searchable, reusable across projects; quota meter; Puter-FS offload.
- ⬜ **Projects** — series/season grouping, templates, cloud backup, portable export.
- ⬜ **Editable, versioned, series-scoped Story Bible** enforcing canon across episodes.
- ⬜ **Mobile** — PWA + a Director-led guided stepper + on-device narration capture.

## Phase 3 — The moat · *intelligence & business* (P3, vision)

- ⬜ **One-Click Channel.** *Channel: Born Back Then · Goal: 100K · 3 videos/week* → the
  Director researches topics, builds a calendar, and produces + packages + schedules every
  video with minimal intervention. The full realization of the channel-OS vision.
- ⬜ **Analytics feedback loop** — pull real YouTube CTR/retention back into the Channel Brain
  so recommendations are grounded in *this channel's* actual performance.
- ⬜ **Collaboration** — shared projects, review roles, comments (team/agency tier).
- ⬜ **Template & style marketplace**; **enterprise** workspaces, roles, audit logs, brand governance.

---

## Priority summary (per the founder review)

1. **AI Director 2.0** — without it everything stays disconnected. *(Phase 0 — router shipped)*
2. **Research module** — critical for a history channel; current AI hallucinations hurt quality.
3. **Automatic data hand-off** — script → TTS → subtitles → storyboard → images → editor, no
   download/upload. *(project-memory store shipped; extend to all assets)*
4. **Channel Brain** — memory across projects; turns the app from a tool into a system.
5. **Thumbnail Lab** — CTR is everything.

*Ship the orchestration spine and research grounding first; every later phase compounds on that
foundation instead of bolting onto a pile of disconnected panels.*
