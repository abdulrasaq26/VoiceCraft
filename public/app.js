(() => {
  'use strict';

  // --- Elements ----------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const textInput = $('text-input');
  const charCount = $('char-count');
  const titleInput = $('title-input');
  const namingNote = $('naming-note');
  const languageSelect = $('language-select');
  const formatSelect = $('format-select');
  const voiceCard = $('voice-card');
  const voiceCardName = $('voice-card-name');
  const voiceCardDesc = $('voice-card-desc');
  const previewBtn = $('preview-btn');
  const instructionsInput = $('instructions-input');
  const instructionsNote = $('instructions-note');
  const templateSelect = $('template-select');
  // ElevenLabs voice_settings (0–100 in UI, sent as 0–1 to Puter).
  const stabilitySlider = $('stability-slider');
  const similaritySlider = $('similarity-slider');
  const styleSlider = $('style-slider');
  const speakerBoostToggle = $('speaker-boost-toggle');
  const stabilityValue = $('stability-value');
  const similarityValue = $('similarity-value');
  const styleValue = $('style-value');
  const capsNote = $('caps-note');
  const speakBtn = $('speak-btn');
  const resetBtn = $('reset-btn');
  const statusBox = $('status');
  const speakSpinner = speakBtn.querySelector('.spinner');
  const speakLabel = speakBtn.querySelector('.btn-label');

  // Batch queue elements
  const queueSection = $('queue-section');
  const progressFill = $('progress-fill');
  const queueStats = $('queue-stats');
  const queueEta = $('queue-eta');
  const pauseBtn = $('pause-btn');
  const resumeBtn = $('resume-btn');
  const retryBtn = $('retry-btn');
  const cancelBtn = $('cancel-btn');
  const clearBtn = $('clear-btn');
  const zipBtn = $('zip-btn');
  const zipSelectedBtn = $('zip-selected-btn');
  const downloadEachBtn = $('download-each-btn');
  const selectAllToggle = $('select-all');
  const queueList = $('queue-list');
  const rowAudio = $('row-audio');
  const subPreviewBtn = $('sub-preview-btn');
  const subSrtBtn = $('sub-srt-btn');
  const subVttBtn = $('sub-vtt-btn');
  const subCopyBtn = $('sub-copy-btn');
  const subtitleOnlyBtn = $('subtitle-only-btn');
  const subtitleModal = $('subtitle-modal');
  const subtitleTitle = $('subtitle-title');
  const subtitleView = $('subtitle-view');
  const subtitleCopy = $('subtitle-copy');
  const subtitleSrt = $('subtitle-srt');
  const subtitleVtt = $('subtitle-vtt');

  const voiceModal = $('voice-modal');
  const voiceSearch = $('voice-search');
  const voiceList = $('voice-list');
  const tierFilters = $('tier-filters');
  const genderFilters = $('gender-filters');
  const styleFilters = $('style-filters');

  const presetSelect = $('preset-select');
  const presetSaveBtn = $('preset-save-btn');
  const presetManageBtn = $('preset-manage-btn');
  const presetModal = $('preset-modal');
  const presetList = $('preset-list');
  const presetSaveForm = $('preset-save-form');
  const presetNameInput = $('preset-name-input');
  const presetProjectInput = $('preset-project-input');
  const presetSaveCancel = $('preset-save-cancel');
  const projectFilter = $('project-filter');

  // --- Constants ---------------------------------------------------------

  const FORMAT_EXT = { MP3: 'mp3', OGG_OPUS: 'ogg', LINEAR16: 'wav' };
  const DEFAULT_LANGUAGE = 'en-US';
  const RECENTS_MAX = 6;

  // The curated ElevenLabs catalog lives in `eleven-voices.js` (loaded before
  // this script). It exposes window.ELEVEN_VOICES and window.ELEVEN_STYLES.
  const ELEVEN_VOICES = window.ELEVEN_VOICES || [];
  const ELEVEN_STYLES = window.ELEVEN_STYLES || [];

  const LS = {
    settings: 'blvck-tts:settings',
    presets: 'blvck-tts:presets',
    favorites: 'blvck-tts:favorites',
    recents: 'blvck-tts:recents',
    narration: 'blvck-tts:narration',
    batch: 'blvck-tts:batch',
    instructionPresets: 'blvck-tts:instruction-presets'
  };

  const DEFAULT_TITLE = 'blvck-tts';

  // ElevenLabs-optimized instruction presets. Unlike Google TTS, ElevenLabs
  // has no speaking-rate / pitch knobs — delivery is shaped by (a) the
  // natural-language cues in the prompt itself and (b) the voice_settings.
  // Each preset therefore carries recommended voice_settings alongside a
  // performance brief written the way ElevenLabs responds to best:
  // concrete emotional direction, explicit pacing, emphasis, and pauses.
  const BUILTIN_TEMPLATES = [
    {
      label: 'Documentary Narrator',
      voice_settings: { stability: 0.6, similarity_boost: 0.85, style: 0.1, use_speaker_boost: true },
      text: `Perform this as a seasoned documentary narrator in the tradition of prestige nature and science films. Carry quiet authority — never raised, never rushed. The material is compelling on its own; your job is to guide the listener through it with complete confidence.

Delivery: measured and deliberate. Let sentences breathe. Take a short pause after each key fact so it lands, and slow slightly when introducing a new idea. Emphasis: place gentle, deliberate stress on numbers, names, and turning points — noticeable but never theatrical. Emotion: understated wonder — fascinated by the subject, but composed.

End sentences with soft downward inflections. Sustain a calm, intelligent, effortlessly authoritative tone the listener could follow for an hour without fatigue.`
    },
    {
      label: 'Historical Storyteller',
      voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.25, use_speaker_boost: true },
      text: `Perform this as the narrator of a slow-burn history channel — empires, battles, forgotten figures. Make the past feel vivid, cinematic, and personal, holding the listener from the first line to the last.

Open with gravity and intrigue, as if letting them in on a secret history. Build like a story: set the scene, introduce the players, raise the stakes, deliver the payoff. Pacing: vary your rhythm — quicken slightly through action and momentum, then slow right down for consequences and human moments. Pauses: leave a full beat of silence after a shocking fact or a date that changed everything, and let it land before moving on.

Emotion: lift with energy at turning points; drop to a low, hushed register for tragedy and betrayal. Tone: knowledgeable, a little dramatic, occasionally wry — never dry or academic. Pronounce historical names and places carefully and confidently. Above all, sustain tension: every sentence should quietly ask "and then what happened?"`
    },
    {
      label: 'Calm Educator',
      voice_settings: { stability: 0.7, similarity_boost: 0.8, style: 0.05, use_speaker_boost: true },
      text: `Perform this as an experienced teacher explaining something that matters to a student you respect. Clarity is the obsession: the listener must follow every step of the reasoning the first time they hear it.

Delivery: precise and deliberate, at a moderate, even pace. Slow down noticeably for definitions, transitions between ideas, and anything the listener needs to remember. Emphasis: surgical — stress the term being defined, the word that changes the meaning, the number that matters. Pauses: rest for a beat after each complete idea — a silence that says "make sure you have this before we move on."

Emotion: patient, focused, warm but serious — confident in the listener's ability to understand. No theatrics, no condescension, no swings in energy. Just the calm assurance of someone who knows the subject deeply and wants you to know it too.`
    },
    {
      label: 'YouTube Explainer',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      text: `Perform this as a sharp, high-retention YouTube explainer host. From the first word you're switched on, bright, and genuinely glad the viewer showed up — your delivery makes them want to stay for the whole video.

Delivery: brisk and punchy. Hit the first word of each sentence a little harder to keep momentum driving forward. Dynamics: spike with real enthusiasm for reveals, results, and anything surprising — let the voice actually smile — then pull back to a confiding, almost conspiratorial tone for tips and asides. That contrast is what makes the pacing addictive. Emphasis: land the key word in every sentence hard and clear.

Talk TO the viewer, not AT them. Short sentences. No filler. End each section on an upward hook that pulls straight into the next moment.`
    },
    {
      label: 'Cinematic Narrator',
      voice_settings: { stability: 0.45, similarity_boost: 0.9, style: 0.3, use_speaker_boost: true },
      text: `Perform this as a cinematic trailer narrator — the voice over the teaser for a prestige film. Every line carries weight and inevitability.

Delivery: deep, deliberate, and controlled, with a low resonant register. Pacing: slow and spacious — let long pauses hang between phrases so tension builds in the silence. Emphasis: drop hard, deliberate stress onto the pivotal word of each line. Dynamics: start restrained and intimate, then swell in gravity toward the climactic line before pulling back to a near-whisper for the final beat.

Emotion: awe, foreboding, grandeur. Never chipper, never fast. The listener should feel the scale of what's coming in their chest.`
    },
    {
      label: 'Audiobook Style',
      voice_settings: { stability: 0.65, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
      text: `Perform this as a professional audiobook narrator settling a listener in for a long session. Sustainable, immersive, and effortless to follow for hours.

Delivery: smooth and even, at a comfortable reading pace — never rushed, never dragging. Keep energy swings gentle so the listener can drift into the story without jolts. Characters: suggest each voice lightly through subtle shifts in pace and warmth rather than broad impressions. Pauses: breathe naturally at commas, rest a beat between sentences, and rest longer between paragraphs and scene changes.

Emphasis: soft and natural, falling where a thoughtful reader would place it. Emotion: present but restrained — color the prose without ever overpowering it. The listener should forget they're being read to.`
    },
    {
      label: 'Dramatic Storytelling',
      voice_settings: { stability: 0.3, similarity_boost: 0.85, style: 0.5, use_speaker_boost: true },
      text: `Perform this with full dramatic commitment — a gifted storyteller performing around a fire, holding the room. This is a performance, not a reading.

Dynamics: use the whole range. Drop to a tense, urgent near-whisper for suspense and secrets; rise to real intensity at the climax; pull back sharply for the aftermath. Pacing: rush breathlessly through danger and action, then slam on the brakes for the moment that matters. Pauses: use silence as a weapon — a long, loaded pause right before the reveal.

Emotion: lean all the way in — fear, awe, grief, triumph, whatever the moment demands, felt and audible. Emphasis: hit the charged words hard. Keep the listener on the edge of their seat, never sure what's coming next.`
    },
    {
      label: 'Conversational',
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
      text: `Perform this as if chatting with a friend — relaxed, natural, completely unforced. Nothing should sound like a script, a broadcast, or a performance.

Delivery: easy, everyday pace with the loose rhythm of real conversation — some sentences quick and offhand, others slower where a thought deserves it. Natural little pauses beat perfect fluency. Emphasis: falls where it would in real speech — on the surprising word, the funny detail, the thing you'd lean in to say.

Emotion: light and good-humored, with an audible smile behind most sentences. Warm and inclusive, as if the listener is nodding along across the table. Contractions, casual phrasing, gentle inflections — the overall feeling is: this is just us, talking.`
    }
  ];

  // --- Persistent state --------------------------------------------------

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full or unavailable — non-fatal */
      }
    }
  };

  let allVoices = [];
  const voiceById = new Map();
  let currentVoiceId = null;
  let favorites = new Set(store.get(LS.favorites, []));
  let recents = store.get(LS.recents, []);
  let presets = store.get(LS.presets, []);
  // narration: { title } — remembers the last project name entered
  const narration = store.get(LS.narration, { title: '' });
  const filters = { search: '', tier: 'all', gender: 'all', style: 'all' };
  let activeSubtitles = null; // { project, cues } currently shown in the modal

  // --- Small helpers -----------------------------------------------------

  const LANGUAGE_NAMES = (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      return null;
    }
  })();

  function languageLabel(code) {
    if (LANGUAGE_NAMES) {
      const name = LANGUAGE_NAMES.of(code);
      if (name && name !== code) return `${name} (${code})`;
    }
    return code;
  }

  function showStatus(message, type = 'error') {
    statusBox.textContent = message;
    statusBox.className = `status ${type}`;
    statusBox.hidden = false;
  }

  function clearStatus() {
    statusBox.hidden = true;
  }

  // --- Script chunking ---------------------------------------------------

  const CHUNK_TARGET = 1000; // aim for ~1000 chars per audio part
  const CHUNK_HARD_MAX = 1800; // a lone long sentence may fill a whole part up to here

  // Split a paragraph into sentence-like units, keeping the terminal
  // punctuation attached so nothing is cut mid-sentence.
  function splitSentences(paragraph) {
    const matches = paragraph.match(/[^.!?…]*[.!?…]+(?=\s|$)|[^.!?…]+$/g);
    return (matches || [paragraph]).map((s) => s.trim()).filter(Boolean);
  }

  // Fallback for a single sentence longer than the hard max: break on clause
  // punctuation, then on spaces, never exceeding the hard max.
  function splitLongSentence(sentence, hardMax) {
    const parts = [];
    let rest = sentence.trim();
    while (rest.length > hardMax) {
      let cut = -1;
      for (const punct of ['; ', ', ', ': ', ' — ', ' ']) {
        cut = rest.lastIndexOf(punct, hardMax);
        if (cut > hardMax * 0.5) {
          cut += punct.length;
          break;
        }
      }
      if (cut <= 0) cut = hardMax; // no boundary found: hard cut
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  // Chunk an entire script into ~target-char parts on sentence boundaries.
  // Paragraph breaks are respected as hard boundaries.
  function chunkScript(text, target = CHUNK_TARGET, hardMax = CHUNK_HARD_MAX) {
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const units = [];
    for (const para of paragraphs) {
      for (const sentence of splitSentences(para)) {
        if (sentence.length > hardMax) units.push(...splitLongSentence(sentence, hardMax));
        else units.push(sentence);
      }
    }

    const chunks = [];
    let current = '';
    for (const unit of units) {
      const candidate = current ? `${current} ${unit}` : unit;
      if (candidate.length <= target) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = unit;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function estimateChunks(text) {
    const trimmed = text.trim();
    return trimmed ? chunkScript(trimmed).length : 0;
  }

  function updateCharCount() {
    const len = textInput.value.length;
    const parts = estimateChunks(textInput.value);
    charCount.textContent = parts > 1 ? `${len} characters · ~${parts} parts` : `${len} characters`;
  }

  // --- Project naming ----------------------------------------------------

  // Strip characters that are invalid in filenames; collapse whitespace.
  function sanitizeName(name) {
    return name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  function currentProject() {
    return sanitizeName(titleInput.value) || DEFAULT_TITLE;
  }

  function saveNarration() {
    narration.title = titleInput.value;
    store.set(LS.narration, narration);
  }

  function partName(project, part) {
    return `${project} Part ${part}`;
  }

  function updateNamingNote() {
    const project = currentProject();
    const parts = estimateChunks(textInput.value);
    if (parts > 1) {
      namingNote.textContent = `Outputs: “${partName(project, 1)}”, “${partName(project, 2)}”, … (${parts} parts).`;
    } else {
      namingNote.textContent = `Output: “${partName(project, 1)}”. Longer scripts are split into numbered parts automatically.`;
    }
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  async function copyText(text, label = 'Subtitles') {
    try {
      await navigator.clipboard.writeText(text);
      showStatus(`${label} copied to clipboard.`, 'info');
      return;
    } catch {
      /* clipboard API unavailable or blocked — fall back below */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showStatus(`${label} copied to clipboard.`, 'info');
    } catch {
      showStatus('Could not copy automatically — open “Preview” and copy manually.');
    }
    ta.remove();
  }

  // --- Subtitles ---------------------------------------------------------
  // Real SRT/VTT subtitles whose timing comes from the actual generated
  // audio: each part's decoded duration is distributed across its cues, and
  // a running offset keeps one continuous timeline across the whole project.
  // When no audio is available (standalone use), timing is estimated from
  // character count and the speaking rate.

  const SUB_MAX_LINE = 42; // chars per line (readable on mobile)
  const SUB_MAX_CUE = 84; // chars per cue (≈ 2 lines)
  const SUB_CHARS_PER_SEC = 14; // estimation baseline at speaking rate 1.0
  const SUB_MIN_CUE_MS = 900; // keep very short cues on screen long enough

  let subtitleCache = { key: null, cues: null };

  // Decode the true duration (seconds) of an audio blob.
  async function audioDuration(blob) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        const d = decoded.duration;
        ctx.close();
        if (isFinite(d) && d > 0) return d;
      }
    } catch {
      /* fall back to the media element below */
    }
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        const d = a.duration;
        URL.revokeObjectURL(url);
        resolve(isFinite(d) && d > 0 ? d : 0);
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      a.src = url;
    });
  }

  function estimateDurationSec(text, rate) {
    const cps = SUB_CHARS_PER_SEC * (Number(rate) || 1);
    return Math.max(0.6, text.replace(/\s+/g, ' ').trim().length / cps);
  }

  // Wrap a cue's text into 1–2 balanced lines without splitting words.
  function wrapLines(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= SUB_MAX_LINE) return [t];
    const mid = Math.floor(t.length / 2);
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== ' ') continue;
      const first = i;
      const second = t.length - (i + 1);
      if (first <= SUB_MAX_LINE && second <= SUB_MAX_LINE) {
        const dist = Math.abs(i - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
    }
    if (best === -1) {
      const idx = t.lastIndexOf(' ', SUB_MAX_LINE);
      if (idx <= 0) return [t];
      return [t.slice(0, idx).trim(), t.slice(idx + 1).trim()];
    }
    return [t.slice(0, best).trim(), t.slice(best + 1).trim()];
  }

  function packUnits(units, max) {
    const out = [];
    let cur = '';
    for (const unit of units) {
      const cand = cur ? `${cur} ${unit}` : unit;
      if (cand.length <= max) {
        cur = cand;
      } else {
        if (cur) out.push(cur);
        cur = unit;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // Split one segment's text into cue-sized text blocks on natural boundaries.
  function splitIntoCueTexts(text) {
    const cues = [];
    for (const sentence of splitSentences(text.replace(/\s+/g, ' ').trim())) {
      if (sentence.length <= SUB_MAX_CUE) {
        cues.push(sentence);
        continue;
      }
      // Break long sentences on clause punctuation, then pack; if a phrase is
      // still too long, pack its words.
      const phrases = sentence.split(/(?<=[,;:—])\s+/).map((s) => s.trim()).filter(Boolean);
      const expanded = [];
      for (const phrase of phrases) {
        if (phrase.length <= SUB_MAX_CUE) expanded.push(phrase);
        else expanded.push(...packUnits(phrase.split(/\s+/), SUB_MAX_CUE));
      }
      cues.push(...packUnits(expanded, SUB_MAX_CUE));
    }
    return cues;
  }

  // segments: [{ text, durationSec }] in order. Returns numbered cues with a
  // continuous timeline.
  function cuesFromSegments(segments) {
    const cues = [];
    let offsetMs = 0;
    for (const seg of segments) {
      const texts = splitIntoCueTexts(seg.text);
      const totalChars = texts.reduce((a, t) => a + t.length, 0) || 1;
      const segDurMs = Math.max(0, seg.durationSec * 1000);
      let acc = 0;
      for (const text of texts) {
        const dur = segDurMs * (text.length / totalChars);
        const startMs = Math.round(offsetMs + acc);
        const endMs = Math.round(offsetMs + acc + dur);
        cues.push({ startMs, endMs, lines: wrapLines(text) });
        acc += dur;
      }
      offsetMs += segDurMs;
    }
    // Enforce a readable minimum without breaking continuity (only pushes the
    // very last cue's end out; interior cues stay aligned to the audio).
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].endMs - cues[i].startMs < SUB_MIN_CUE_MS) {
        const wanted = cues[i].startMs + SUB_MIN_CUE_MS;
        if (i + 1 < cues.length) cues[i].endMs = Math.min(wanted, cues[i + 1].startMs);
        else cues[i].endMs = wanted;
      }
    }
    return cues.map((c, i) => ({ index: i + 1, ...c }));
  }

  // forceScript: always caption the pasted script (used by the standalone
  // button), even when a completed audio batch exists.
  async function computeCues(forceScript = false) {
    if (!forceScript && batch) {
      const key = `${batch.id}:${batch.items.filter((i) => i.status === 'done').length}`;
      if (subtitleCache.key === key && subtitleCache.cues) return subtitleCache.cues;
      // ElevenLabs has no per-request speaking-rate; assume 1× for estimation.
      const rate = 1;
      const segments = [];
      for (const item of batch.items) {
        const blob = memBlobs.get(item.index);
        let dur = blob ? await audioDuration(blob) : 0;
        if (!dur) dur = estimateDurationSec(item.text, rate);
        segments.push({ text: item.text, durationSec: dur });
      }
      const cues = cuesFromSegments(segments);
      subtitleCache = { key, cues };
      return cues;
    }
    // Standalone: estimate from the pasted script (recomputed every time so
    // edits to the script are always reflected).
    const text = textInput.value.trim();
    if (!text) return [];
    // Rate is fixed at 1× for ElevenLabs (no per-request speaking-rate knob).
    return cuesFromSegments([{ text, durationSec: estimateDurationSec(text, 1) }]);
  }

  function fmtTime(ms, sep) {
    const total = Math.max(0, Math.round(ms));
    const h = Math.floor(total / 3600000);
    const m = Math.floor((total % 3600000) / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}${sep}${String(millis).padStart(3, '0')}`;
  }

  function toSRT(cues) {
    return (
      cues
        .map((c) => `${c.index}\n${fmtTime(c.startMs, ',')} --> ${fmtTime(c.endMs, ',')}\n${c.lines.join('\n')}`)
        .join('\n\n') + '\n'
    );
  }

  function toVTT(cues) {
    return (
      'WEBVTT\n\n' +
      cues
        .map((c) => `${c.index}\n${fmtTime(c.startMs, '.')} --> ${fmtTime(c.endMs, '.')}\n${c.lines.join('\n')}`)
        .join('\n\n') +
      '\n'
    );
  }

  function toPlainText(cues) {
    return cues.map((c) => c.lines.join('\n')).join('\n\n') + '\n';
  }

  function subtitleProject() {
    return batch ? batch.project : currentProject();
  }

  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    downloadBlobUrl(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function openSubtitleModal(forceScript = false) {
    const cues = await computeCues(forceScript);
    if (!cues.length) {
      showStatus('There’s nothing to caption yet.');
      return;
    }
    const project = forceScript ? currentProject() : subtitleProject();
    const source = !forceScript && batch ? 'from generated audio' : 'estimated from script';
    activeSubtitles = { project, cues };
    subtitleTitle.textContent = `${project} — subtitles (${cues.length} cues, ${source})`;
    subtitleView.textContent = toSRT(cues);
    openModal(subtitleModal);
  }

  function updateSliderOutputs() {
    stabilityValue.textContent = String(Math.round(Number(stabilitySlider.value)));
    similarityValue.textContent = String(Math.round(Number(similaritySlider.value)));
    styleValue.textContent = String(Math.round(Number(styleSlider.value)));
  }

  // Read the ElevenLabs voice_settings from the UI (0–1 range).
  function collectVoiceSettings() {
    return {
      stability: Number(stabilitySlider.value) / 100,
      similarity_boost: Number(similaritySlider.value) / 100,
      style: Number(styleSlider.value) / 100,
      use_speaker_boost: Boolean(speakerBoostToggle.checked)
    };
  }

  function applyVoiceSettings(vs) {
    if (!vs) return;
    if (Number.isFinite(vs.stability)) stabilitySlider.value = Math.round(vs.stability * 100);
    if (Number.isFinite(vs.similarity_boost)) similaritySlider.value = Math.round(vs.similarity_boost * 100);
    if (Number.isFinite(vs.style)) styleSlider.value = Math.round(vs.style * 100);
    if (typeof vs.use_speaker_boost === 'boolean') speakerBoostToggle.checked = vs.use_speaker_boost;
    updateSliderOutputs();
  }

  function genderText(gender) {
    if (gender === 'FEMALE') return 'Female';
    if (gender === 'MALE') return 'Male';
    return '';
  }

  function currentVoice() {
    return voiceById.get(currentVoiceId) || null;
  }

  // --- Settings persistence (last-used memory) ---------------------------

  function collectSettings() {
    return {
      voiceId: currentVoiceId,
      language: languageSelect.value,
      instructions: instructionsInput.value,
      voice_settings: collectVoiceSettings(),
      format: formatSelect.value
    };
  }

  function persistSettings() {
    store.set(LS.settings, collectSettings());
  }

  function applySettings(s) {
    if (!s) return;
    if (s.language && [...languageSelect.options].some((o) => o.value === s.language)) {
      languageSelect.value = s.language;
    }
    if (s.voiceId && voiceById.has(s.voiceId)) {
      currentVoiceId = s.voiceId;
      const v = voiceById.get(s.voiceId);
      if (!v.languageCodes.includes(languageSelect.value)) {
        languageSelect.value = v.language;
      }
    }
    if (typeof s.instructions === 'string') instructionsInput.value = s.instructions;
    applyVoiceSettings(s.voice_settings);
    if (s.format && FORMAT_EXT[s.format]) formatSelect.value = s.format;
    updateSliderOutputs();
    renderVoiceCard();
    persistSettings();
  }

  // --- Voice catalog -----------------------------------------------------

  async function loadVoices() {
    try {
      // Voices come from whichever TTS provider is selected (ElevenLabs,
      // Polly, OpenAI, Gemini, xAI). Falls back to the ElevenLabs catalog.
      const providerId = (window.BlvckAI && window.BlvckAI.ttsProvider && window.BlvckAI.ttsProvider()) || 'elevenlabs';
      allVoices = (window.getTtsVoices ? window.getTtsVoices(providerId) : ELEVEN_VOICES.slice());
      applyProviderCapabilities(providerId);
      voiceById.clear();
      allVoices.forEach((v) => voiceById.set(v.id, v));
      if (!allVoices.length) {
        voiceCardName.textContent = 'No voices available';
        showStatus('This voice provider has no voices configured.');
        return;
      }

      populateLanguages();

      // Last-used settings win; otherwise the default preset; otherwise
      // the best voice for the default language.
      const saved = store.get(LS.settings, null);
      const defaultPreset = presets.find((p) => p.isDefault);
      if (saved && saved.voiceId && voiceById.has(saved.voiceId)) {
        applySettings(saved);
      } else if (defaultPreset) {
        applySettings(defaultPreset.settings);
      } else {
        currentVoiceId = pickDefaultVoice(languageSelect.value);
        renderVoiceCard();
      }
      clearStatus();
    } catch (err) {
      voiceCardName.textContent = 'Voices unavailable';
      showStatus(`Could not load voices: ${err.message}`);
    }
  }

  function populateLanguages() {
    const codes = new Set();
    allVoices.forEach((v) => v.languageCodes.forEach((c) => codes.add(c)));
    const sorted = [...codes].sort();
    languageSelect.innerHTML = '';
    sorted.forEach((code) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = languageLabel(code);
      languageSelect.appendChild(option);
    });
    languageSelect.value = sorted.includes(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : sorted[0] || '';
  }

  function voicesForLanguage(lang) {
    return allVoices.filter((v) => v.languageCodes.includes(lang));
  }

  function pickDefaultVoice(lang) {
    const candidates = voicesForLanguage(lang);
    return candidates.length ? candidates[0].id : null; // list is tier-sorted
  }

  function renderVoiceCard() {
    const v = currentVoice();
    if (!v) {
      voiceCardName.textContent = 'Choose a voice…';
      voiceCardDesc.textContent = '';
      syncCapabilityUI();
      return;
    }
    voiceCardName.innerHTML = '';
    voiceCardName.append(v.name, ' ');
    voiceCardName.appendChild(badgeEl(v));
    voiceCardDesc.textContent = v.descriptor;
    syncCapabilityUI();
  }

  function badgeEl(v) {
    const badge = document.createElement('span');
    badge.className = `badge ${v.tier}`;
    badge.textContent = v.badge;
    return badge;
  }

  // Every voice within a provider accepts the same options, so this only
  // refreshes the note below the card based on the active provider.
  function syncCapabilityUI() {
    if (capsNote) capsNote.hidden = true;
    const v = currentVoice();
    if (!v) {
      instructionsNote.textContent = '';
      return;
    }
    const providerId = (window.BlvckAI && window.BlvckAI.ttsProvider()) || 'elevenlabs';
    const notes = {
      elevenlabs: 'ElevenLabs listens to natural-language delivery cues in the prompt — describe emotion, pacing, emphasis, and pauses directly.',
      gemini: 'Gemini follows the instructions above as spoken-style direction (e.g. “speak warmly, slower on the key facts”).',
      openai: 'OpenAI uses the instructions above to steer tone and delivery.',
      xai: 'xAI supports inline tags in your script: [pause], [laugh], <whisper>…</whisper>.',
      polly: 'Amazon Polly renders plain text; pick the engine (Neural/Generative) in ⚙ AI settings for higher quality.'
    };
    instructionsNote.textContent = notes[providerId] || notes.elevenlabs;
  }

  // Show provider-relevant controls: the stability/similarity/style sliders
  // only apply to ElevenLabs, so hide them for other providers.
  function applyProviderCapabilities(providerId) {
    const def = window.getTtsProvider ? window.getTtsProvider(providerId) : null;
    const caps = (def && def.caps) || { voiceSettings: true };
    const vs = document.querySelector('.vs-sliders');
    if (vs) vs.style.display = caps.voiceSettings ? '' : 'none';
  }

  // --- Voice preview -----------------------------------------------------
  // The audio element streams the ElevenLabs blob URL and play() is called
  // synchronously inside the tap handler, which keeps previews working
  // under mobile autoplay policies (iOS Safari, Chrome for Android).

  const previewAudio = new Audio();
  previewAudio.preload = 'none';
  let previewState = 'idle'; // idle | loading | playing
  let previewVoiceId = null;
  let previewUrl = null; // object URL for the current ElevenLabs preview blob
  let activePreviewButtons = [];

  function previewButtonsFor(voiceId) {
    const buttons = [];
    if (voiceId === currentVoiceId) buttons.push(previewBtn);
    voiceList.querySelectorAll(`.btn.icon[data-preview="${CSS.escape(voiceId)}"]`).forEach((b) => buttons.push(b));
    return buttons;
  }

  function setPreviewButtonState(state) {
    activePreviewButtons.forEach((btn) => {
      if (!btn.isConnected && btn !== previewBtn) return;
      const icon = btn.querySelector('.preview-icon');
      const spinner = btn.querySelector('.spinner');
      if (icon) {
        icon.hidden = state === 'loading';
        icon.textContent = state === 'playing' ? '■' : '▶';
      }
      if (spinner) spinner.hidden = state !== 'loading';
      btn.title = state === 'playing' ? 'Stop preview' : 'Preview this voice';
    });
  }

  function stopPreview() {
    previewAudio.pause();
    previewAudio.removeAttribute('src');
    previewState = 'idle';
    setPreviewButtonState('idle');
    activePreviewButtons = [];
    previewVoiceId = null;
  }

  function startPreview(voiceId) {
    // One preview at a time; a second tap on the same voice stops it.
    if (previewState === 'loading') return;
    if (previewVoiceId === voiceId && previewState === 'playing') {
      stopPreview();
      return;
    }
    stopPreview();

    const v = voiceById.get(voiceId);
    if (!v) {
      showStatus('Select a voice to preview.');
      return;
    }

    clearStatus();
    previewVoiceId = voiceId;
    previewState = 'loading';
    activePreviewButtons = previewButtonsFor(voiceId);
    setPreviewButtonState('loading');

    // ElevenLabs runs client-side; fetch the sample as a blob then play.
    // Previews use the LIVE voice_settings so users hear their own tuning.
    const phrase = 'Hello! This is a preview of my voice.';
    window.BlvckAI.speak(phrase, v.id, { voice_settings: collectVoiceSettings(), instructions: instructionsInput.value.trim() })
      .then((blob) => {
        if (previewVoiceId !== voiceId) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        previewAudio.src = previewUrl;
        return previewAudio.play();
      })
      .catch((err) => {
        if (previewVoiceId !== voiceId) return;
        if (err && err.name === 'NotAllowedError') {
          showStatus('Your browser blocked audio playback. Tap the preview button again to allow it.');
        } else {
          showStatus(`Voice preview failed: ${err.message}`);
        }
        stopPreview();
      });
  }

  previewAudio.addEventListener('playing', () => {
    previewState = 'playing';
    setPreviewButtonState('playing');
  });
  previewAudio.addEventListener('ended', stopPreview);
  previewAudio.addEventListener('error', async () => {
    if (!previewVoiceId) return;
    const failedId = previewVoiceId;
    const src = previewAudio.currentSrc || previewAudio.src;
    stopPreview();
    let message = 'This voice preview could not be generated.';
    try {
      const response = await fetch(src);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        message = body.hint ? `${body.error} — ${body.hint}` : body.error || message;
      }
    } catch {
      message = 'Could not reach the server to generate the preview. Check your connection and try again.';
    }
    showStatus(`Voice preview failed: ${message}`);
    markVoiceUnavailable(failedId);
  });

  function markVoiceUnavailable(voiceId) {
    voiceList
      .querySelectorAll(`.voice-item[data-id="${CSS.escape(voiceId)}"]`)
      .forEach((row) => row.classList.add('unavailable'));
  }

  // --- Voice browser modal -----------------------------------------------

  function openModal(modal) {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeModal(modal) {
    modal.hidden = true;
    if (voiceModal.hidden && presetModal.hidden && subtitleModal.hidden) {
      document.body.classList.remove('modal-open');
    }
  }

  function matchesFilters(v) {
    if (filters.tier !== 'all' && v.tier !== filters.tier) return false;
    if (filters.gender !== 'all' && v.gender !== filters.gender) return false;
    if (filters.style !== 'all' && !(v.styles || []).includes(filters.style)) return false;
    if (filters.search) {
      const haystack = `${v.name} ${v.descriptor} ${v.accent || ''} ${v.age || ''} ${(v.styles || []).join(' ')} ${v.id}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  }

  function renderVoiceList() {
    const lang = languageSelect.value;
    const inLanguage = voicesForLanguage(lang).filter(matchesFilters);
    voiceList.innerHTML = '';

    if (!inLanguage.length) {
      const empty = document.createElement('div');
      empty.className = 'voice-empty';
      empty.textContent = 'No voices match your search or filters.';
      voiceList.appendChild(empty);
      return;
    }

    const ids = new Set(inLanguage.map((v) => v.id));
    const favSection = inLanguage.filter((v) => favorites.has(v.id));
    const recentSection = recents
      .filter((id) => ids.has(id) && !favorites.has(id))
      .map((id) => voiceById.get(id));

    const appendSection = (title, voices) => {
      if (!voices.length) return;
      const heading = document.createElement('div');
      heading.className = 'voice-section-title';
      heading.textContent = title;
      voiceList.appendChild(heading);
      voices.forEach((v) => voiceList.appendChild(voiceRow(v)));
    };

    appendSection('★ Favorites', favSection);
    appendSection('Recently used', recentSection);
    for (const tier of ['elite', 'premium', 'standard']) {
      appendSection(
        { elite: '⭐ Elite Voices', premium: 'Premium Voices', standard: 'Character & Specialty Voices' }[tier],
        inLanguage.filter((v) => v.tier === tier)
      );
    }
  }

  function voiceRow(v) {
    const row = document.createElement('div');
    row.className = 'voice-item' + (v.id === currentVoiceId ? ' selected' : '');
    row.dataset.id = v.id;

    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'fav-btn' + (favorites.has(v.id) ? ' active' : '');
    fav.textContent = favorites.has(v.id) ? '★' : '☆';
    fav.title = favorites.has(v.id) ? 'Remove from favorites' : 'Add to favorites';
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(v.id);
    });

    const info = document.createElement('div');
    info.className = 'voice-item-info';
    const nameLine = document.createElement('div');
    nameLine.className = 'voice-item-name';
    nameLine.append(v.name);
    nameLine.appendChild(badgeEl(v));
    const gender = genderText(v.gender);
    if (gender) {
      const chip = document.createElement('span');
      chip.className = 'badge gender';
      chip.textContent = gender;
      nameLine.appendChild(chip);
    }

    const desc = document.createElement('div');
    desc.className = 'voice-item-desc';
    desc.textContent = v.descriptor;

    // Metadata line: accent · age · styles.
    const meta = document.createElement('div');
    meta.className = 'voice-item-meta';
    const metaBits = [];
    if (v.accent) metaBits.push(v.accent);
    if (v.age) metaBits.push(v.age);
    if (metaBits.length) {
      const origin = document.createElement('span');
      origin.className = 'voice-meta-origin';
      origin.textContent = metaBits.join(' · ');
      meta.appendChild(origin);
    }
    (v.styles || []).slice(0, 3).forEach((s) => {
      const tag = document.createElement('span');
      tag.className = 'voice-style-tag';
      tag.textContent = s;
      meta.appendChild(tag);
    });

    info.append(nameLine, desc, meta);

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'btn icon';
    preview.dataset.preview = v.id;
    preview.title = 'Preview this voice';
    preview.innerHTML = '<span class="preview-icon">▶</span><span class="spinner small" hidden></span>';
    preview.addEventListener('click', (e) => {
      e.stopPropagation();
      startPreview(v.id);
    });

    row.append(fav, info, preview);
    row.addEventListener('click', () => {
      selectVoice(v.id);
      closeModal(voiceModal);
    });
    return row;
  }

  function selectVoice(voiceId) {
    currentVoiceId = voiceId;
    renderVoiceCard();
    persistSettings();
  }

  function toggleFavorite(voiceId) {
    if (favorites.has(voiceId)) favorites.delete(voiceId);
    else favorites.add(voiceId);
    store.set(LS.favorites, [...favorites]);
    renderVoiceList();
  }

  function recordRecent(voiceId) {
    recents = [voiceId, ...recents.filter((id) => id !== voiceId)].slice(0, RECENTS_MAX);
    store.set(LS.recents, recents);
  }

  // --- Audio persistence (IndexedDB, with in-memory mirror) --------------

  const DB_NAME = 'blvck-tts';
  const DB_STORE = 'audio';
  const memBlobs = new Map(); // index -> Blob (session source of truth)
  const urls = new Map(); // index -> object URL

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, blob) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(blob, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      /* persistence is best-effort; the in-memory mirror still works */
    }
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const rq = tx.objectStore(DB_STORE).get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => reject(rq.error);
      });
      db.close();
      return value;
    } catch {
      return null;
    }
  }

  async function idbDeletePrefix(prefix) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const rq = store.openCursor();
        rq.onsuccess = () => {
          const cursor = rq.result;
          if (cursor) {
            if (String(cursor.key).startsWith(prefix)) cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      /* ignore */
    }
  }

  // --- Batch generation queue --------------------------------------------

  let batch = null; // { id, project, ext, audioFormat, settings, items[] }
  let running = false;
  let paused = false;
  let cancelRequested = false;
  const durations = []; // ms per completed part, for ETA
  const selected = new Set(); // selected item indices

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function itemFileName(item) {
    return `${partName(batch.project, item.part)}.${batch.ext}`;
  }

  // Persist batch metadata (no blobs — those live in IndexedDB).
  function persistBatch() {
    if (!batch) {
      localStorage.removeItem(LS.batch);
      return;
    }
    store.set(LS.batch, batch);
  }

  async function clearBatch() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.clear();
    memBlobs.clear();
    selected.clear();
    durations.length = 0;
    if (batch) await idbDeletePrefix(`${batch.id}:`);
    batch = null;
    persistBatch();
    queueSection.hidden = true;
    rowAudio.hidden = true;
    rowAudio.pause();
  }

  async function synthesizeChunk(text, s) {
    return window.BlvckAI.speak(text, s.voiceId, {
      voice_settings: s.voice_settings,
      instructions: s.instructions,
      model: s.ttsModel
    });
  }

  function buildBatch(v, chunks, script) {
    return {
      id: `batch-${Date.now()}`,
      project: currentProject(),
      script, // original full text (kept for future features: translation, etc.)
      ext: FORMAT_EXT[formatSelect.value] || 'mp3',
      audioFormat: formatSelect.value,
      createdAt: Date.now(),
      settings: {
        voiceId: v.id,
        languageCode: languageSelect.value,
        audioFormat: formatSelect.value,
        voice_settings: collectVoiceSettings(),
        ttsModel: null, // reserved for future per-batch model overrides
        instructions: instructionsInput.value.trim()
      },
      items: chunks.map((text, i) => ({ index: i, part: i + 1, text, status: 'pending', error: null }))
    };
  }

  async function startGeneration() {
    if (running) return;
    const text = textInput.value.trim();
    if (!text) {
      showStatus('Enter a script first.');
      textInput.focus();
      return;
    }
    const v = currentVoice();
    if (!v) {
      showStatus('Choose a voice first.');
      return;
    }

    clearStatus();
    stopPreview();
    await clearBatch();

    const chunks = chunkScript(text);
    batch = buildBatch(v, chunks, text);
    persistBatch();
    recordRecent(v.id);
    persistSettings();

    queueSection.hidden = false;
    renderQueue();
    runQueue();
  }

  async function runQueue() {
    if (running || !batch) return;
    running = true;
    paused = false;
    cancelRequested = false;
    speakBtn.disabled = true;
    speakLabel.textContent = 'Generating…';
    speakSpinner.hidden = false;
    updateControls();

    for (const item of batch.items) {
      if (cancelRequested) break;
      if (item.status === 'done') continue;

      while (paused && !cancelRequested) await sleep(200);
      if (cancelRequested) break;

      item.status = 'generating';
      item.error = null;
      persistBatch();
      renderQueue();

      const t0 = performance.now();
      try {
        const blob = await synthesizeChunk(item.text, batch.settings);
        memBlobs.set(item.index, blob);
        if (urls.has(item.index)) URL.revokeObjectURL(urls.get(item.index));
        urls.set(item.index, URL.createObjectURL(blob));
        await idbPut(`${batch.id}:${item.index}`, blob);
        item.status = 'done';
        durations.push(performance.now() - t0);
      } catch (err) {
        item.status = 'error';
        item.error = err.message;
      }
      persistBatch();
      renderQueue();
    }

    running = false;
    speakBtn.disabled = false;
    speakLabel.textContent = 'Generate speech';
    speakSpinner.hidden = true;
    updateControls();
    renderQueue();

    const remaining = batch.items.filter((i) => i.status !== 'done').length;
    const errors = batch.items.filter((i) => i.status === 'error').length;
    if (cancelRequested) {
      showStatus(`Cancelled. ${batch.items.length - remaining} of ${batch.items.length} parts completed.`, 'info');
    } else if (errors) {
      showStatus(`${errors} part(s) failed. Use “Retry failed” to try them again.`);
    } else if (!remaining) {
      showStatus(`All ${batch.items.length} part(s) generated.`, 'info');
    }
  }

  // --- Progress + rendering ----------------------------------------------

  function formatDuration(ms) {
    const secs = Math.round(ms / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  }

  function updateProgress() {
    if (!batch) return;
    const total = batch.items.length;
    const done = batch.items.filter((i) => i.status === 'done').length;
    const errors = batch.items.filter((i) => i.status === 'error').length;
    const generating = batch.items.find((i) => i.status === 'generating');
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;

    if (generating) {
      queueStats.textContent = `Generating ${partName(batch.project, generating.part)} — ${generating.part} of ${total} · ${pct}%`;
    } else {
      queueStats.textContent = `${done} of ${total} complete · ${pct}%${errors ? ` · ${errors} failed` : ''}`;
    }

    const remaining = batch.items.filter((i) => i.status === 'pending' || i.status === 'generating').length;
    if (running && remaining && durations.length) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      queueEta.textContent = `~${formatDuration(avg * remaining)} remaining`;
    } else {
      queueEta.textContent = '';
    }
  }

  function updateControls() {
    const hasDone = batch && batch.items.some((i) => i.status === 'done');
    const hasError = batch && batch.items.some((i) => i.status === 'error');
    const hasPending = batch && batch.items.some((i) => i.status === 'pending');

    pauseBtn.hidden = !(running && !paused);
    resumeBtn.hidden = !((running && paused) || (!running && hasPending));
    resumeBtn.textContent = running ? 'Resume' : 'Continue';
    cancelBtn.hidden = !running;
    retryBtn.hidden = !(!running && hasError);
    clearBtn.hidden = !batch;

    zipBtn.disabled = !hasDone;
    downloadEachBtn.disabled = !hasDone;
    zipSelectedBtn.disabled = selected.size === 0;
  }

  function renderQueue() {
    if (!batch) {
      queueSection.hidden = true;
      return;
    }
    updateProgress();
    updateControls();

    queueList.innerHTML = '';
    for (const item of batch.items) {
      const row = document.createElement('div');
      row.className = 'queue-item';
      if (item.status === 'generating') row.classList.add('is-generating');
      if (item.status === 'error') row.classList.add('is-error');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selected.has(item.index);
      check.disabled = item.status !== 'done';
      check.addEventListener('change', () => {
        if (check.checked) selected.add(item.index);
        else selected.delete(item.index);
        syncSelectAll();
        updateControls();
      });

      const info = document.createElement('div');
      info.className = 'queue-item-info';
      const name = document.createElement('div');
      name.className = 'queue-item-name';
      name.textContent = itemFileName(item);
      const preview = document.createElement('div');
      preview.className = 'queue-item-preview';
      preview.textContent = item.status === 'error' ? item.error : `${item.text.slice(0, 90)}${item.text.length > 90 ? '…' : ''}`;
      info.append(name, preview);

      const badge = document.createElement('span');
      const label = { pending: 'Queued', generating: 'Generating…', done: 'Ready', error: 'Failed' }[item.status];
      badge.className = `queue-item-status status-${item.status}`;
      badge.textContent = label;

      const actions = document.createElement('div');
      actions.className = 'queue-item-actions';
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.textContent = '▶';
      playBtn.title = 'Play';
      playBtn.disabled = item.status !== 'done';
      playBtn.addEventListener('click', () => playItem(item));
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.textContent = '↓';
      dl.title = 'Download';
      dl.disabled = item.status !== 'done';
      dl.addEventListener('click', () => downloadItem(item));
      actions.append(playBtn, dl);

      row.append(check, info, badge, actions);
      queueList.appendChild(row);
    }
    syncSelectAll();
  }

  function syncSelectAll() {
    if (!batch) return;
    const doneItems = batch.items.filter((i) => i.status === 'done');
    selectAllToggle.checked = doneItems.length > 0 && doneItems.every((i) => selected.has(i.index));
    selectAllToggle.disabled = doneItems.length === 0;
  }

  // --- Playback + downloads ----------------------------------------------

  function playItem(item) {
    const url = urls.get(item.index);
    if (!url) return;
    rowAudio.src = url;
    rowAudio.hidden = false;
    rowAudio.play().catch(() => {});
  }

  function downloadBlobUrl(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadItem(item) {
    const url = urls.get(item.index);
    if (url) downloadBlobUrl(url, itemFileName(item));
  }

  async function downloadEach() {
    const done = batch.items.filter((i) => i.status === 'done');
    for (const item of done) {
      downloadItem(item);
      await sleep(400); // stagger so browsers don't block the batch
    }
  }

  async function zipDownload(items, { includeSubtitles = false } = {}) {
    if (!items.length) return;
    const files = [];
    for (const item of items) {
      const blob = memBlobs.get(item.index) || (await idbGet(`${batch.id}:${item.index}`));
      if (!blob) continue;
      files.push({ name: itemFileName(item), data: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (!files.length) return;
    if (includeSubtitles) {
      const cues = await computeCues();
      if (cues.length) {
        const enc = new TextEncoder();
        files.push({ name: `${batch.project}.srt`, data: enc.encode(toSRT(cues)) });
        files.push({ name: `${batch.project}.vtt`, data: enc.encode(toVTT(cues)) });
      }
    }
    const zipBlob = window.BlvckZip.create(files);
    const url = URL.createObjectURL(zipBlob);
    downloadBlobUrl(url, `${batch.project}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // --- Restore an in-progress batch after refresh ------------------------

  async function restoreBatch() {
    const saved = store.get(LS.batch, null);
    if (!saved || !saved.items || !saved.items.length) return;
    batch = saved;
    for (const item of batch.items) {
      if (item.status === 'generating') item.status = 'pending'; // was interrupted
      if (item.status === 'done') {
        const blob = await idbGet(`${batch.id}:${item.index}`);
        if (blob) {
          memBlobs.set(item.index, blob);
          urls.set(item.index, URL.createObjectURL(blob));
        } else {
          item.status = 'pending'; // audio lost — regenerate
        }
      }
    }
    persistBatch();
    queueSection.hidden = false;
    renderQueue();
    const pending = batch.items.filter((i) => i.status !== 'done').length;
    if (pending) {
      showStatus(`Restored a batch with ${pending} part(s) left. Click “Continue” to finish.`, 'info');
    }
  }

  // --- Presets -----------------------------------------------------------

  function savePresets() {
    store.set(LS.presets, presets);
    renderPresetSelect();
  }

  function presetMeta(p) {
    const v = voiceById.get(p.settings.voiceId);
    const parts = [];
    if (v) parts.push(`Voice: ${v.name}`);
    const vs = p.settings.voice_settings;
    if (vs) {
      const s = Math.round((vs.stability ?? 0.5) * 100);
      const sim = Math.round((vs.similarity_boost ?? 0.85) * 100);
      const st = Math.round((vs.style ?? 0.1) * 100);
      parts.push(`Stab ${s} · Sim ${sim} · Style ${st}${vs.use_speaker_boost === false ? '' : ' · Boost'}`);
    }
    if (p.settings.instructions) parts.push(p.settings.instructions.slice(0, 60));
    if (p.project) parts.push(`Project: ${p.project}`);
    return parts.join(' · ') || '—';
  }

  function renderPresetSelect() {
    const previous = presetSelect.value;
    presetSelect.innerHTML = '<option value="">Presets…</option>';
    presets.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = (p.isDefault ? '★ ' : '') + p.name;
      presetSelect.appendChild(option);
    });
    if ([...presetSelect.options].some((o) => o.value === previous)) {
      presetSelect.value = previous;
    }
  }

  function renderPresetList() {
    const project = projectFilter.value;
    const projects = [...new Set(presets.map((p) => p.project).filter(Boolean))];
    projectFilter.hidden = projects.length === 0;
    const keep = projectFilter.value;
    projectFilter.innerHTML = '<option value="">All projects</option>';
    projects.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      projectFilter.appendChild(option);
    });
    if ([...projectFilter.options].some((o) => o.value === keep)) projectFilter.value = keep;

    presetList.innerHTML = '';
    const visible = project ? presets.filter((p) => p.project === project) : presets;
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'voice-empty';
      empty.textContent = 'No presets yet. Dial in your settings, then hit “Save preset”.';
      presetList.appendChild(empty);
      return;
    }

    visible.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'preset-item';

      const info = document.createElement('div');
      info.className = 'preset-item-info';
      const name = document.createElement('div');
      name.className = 'preset-item-name';
      name.innerHTML = p.isDefault ? '<span class="default-star">★</span> ' : '';
      name.append(p.name);
      const meta = document.createElement('div');
      meta.className = 'preset-item-meta';
      meta.textContent = presetMeta(p);
      info.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'preset-item-actions';
      const btn = (label, handler, danger = false) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (danger) b.className = 'danger';
        b.addEventListener('click', handler);
        return b;
      };
      actions.append(
        btn('Apply', () => {
          applySettings(p.settings);
          closeModal(presetModal);
          showStatus(`Preset “${p.name}” applied.`, 'info');
        }),
        btn(p.isDefault ? 'Unset default' : 'Set default', () => {
          const wasDefault = p.isDefault;
          presets.forEach((x) => (x.isDefault = false));
          p.isDefault = !wasDefault;
          savePresets();
          renderPresetList();
        }),
        btn('Rename', () => {
          const next = prompt('New preset name:', p.name);
          if (next && next.trim()) {
            p.name = next.trim().slice(0, 60);
            savePresets();
            renderPresetList();
          }
        }),
        btn('Duplicate', () => {
          presets.push({
            ...p,
            id: `preset-${Date.now()}`,
            name: `${p.name} (copy)`.slice(0, 60),
            isDefault: false,
            settings: { ...p.settings }
          });
          savePresets();
          renderPresetList();
        }),
        btn('Delete', () => {
          if (!confirm(`Delete preset “${p.name}”?`)) return;
          presets = presets.filter((x) => x.id !== p.id);
          savePresets();
          renderPresetList();
        }, true)
      );

      row.append(info, actions);
      presetList.appendChild(row);
    });
  }

  function openPresetSaveForm() {
    openModal(presetModal);
    presetSaveForm.hidden = false;
    renderPresetList();
    presetNameInput.focus();
  }

  // --- Events ------------------------------------------------------------

  textInput.addEventListener('input', () => {
    updateCharCount();
    updateNamingNote();
  });

  titleInput.addEventListener('input', () => {
    saveNarration();
    updateNamingNote();
  });

  languageSelect.addEventListener('change', () => {
    stopPreview();
    const v = currentVoice();
    if (!v || !v.languageCodes.includes(languageSelect.value)) {
      currentVoiceId = pickDefaultVoice(languageSelect.value);
      renderVoiceCard();
    }
    persistSettings();
    if (!voiceModal.hidden) renderVoiceList();
  });

  voiceCard.addEventListener('click', () => {
    openModal(voiceModal);
    renderVoiceList();
    if (window.matchMedia('(min-width: 641px)').matches) voiceSearch.focus();
  });

  previewBtn.addEventListener('click', () => {
    if (currentVoiceId) startPreview(currentVoiceId);
    else showStatus('Choose a voice first.');
  });

  voiceSearch.addEventListener('input', () => {
    filters.search = voiceSearch.value.trim().toLowerCase();
    renderVoiceList();
  });

  tierFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filters.tier = chip.dataset.tier;
    tierFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderVoiceList();
  });

  genderFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filters.gender = chip.dataset.gender;
    genderFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderVoiceList();
  });

  // Build the style-filter chips from the catalog's style vocabulary.
  if (styleFilters) {
    const styleLabels = {
      narration: 'Narration', documentary: 'Documentary', storytelling: 'Storytelling',
      educational: 'Educational', character: 'Character', conversational: 'Conversational',
      cinematic: 'Cinematic', audiobook: 'Audiobook', dramatic: 'Dramatic', asmr: 'ASMR'
    };
    ELEVEN_STYLES.forEach((s) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.style = s;
      chip.textContent = styleLabels[s] || s;
      styleFilters.appendChild(chip);
    });
    styleFilters.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      filters.style = chip.dataset.style;
      styleFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderVoiceList();
    });
  }

  // Custom instruction presets: the user's own delivery briefs, saved as a
  // reusable starting point (text + recommended voice_settings), shown in the
  // same dropdown under a "My presets" group.
  let customTemplates = store.get(LS.instructionPresets, []);

  function saveCustomTemplates() {
    store.set(LS.instructionPresets, customTemplates);
  }

  function renderTemplateSelect() {
    templateSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Instruction presets…';
    templateSelect.appendChild(placeholder);

    const builtinGroup = document.createElement('optgroup');
    builtinGroup.label = 'Built-in presets';
    BUILTIN_TEMPLATES.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = `builtin:${i}`;
      o.textContent = t.label;
      builtinGroup.appendChild(o);
    });
    templateSelect.appendChild(builtinGroup);

    if (customTemplates.length) {
      const myGroup = document.createElement('optgroup');
      myGroup.label = 'My presets';
      customTemplates.forEach((t) => {
        const o = document.createElement('option');
        o.value = `custom:${t.id}`;
        o.textContent = t.label;
        myGroup.appendChild(o);
      });
      templateSelect.appendChild(myGroup);
    }

    const actionGroup = document.createElement('optgroup');
    actionGroup.label = 'Actions';
    const saveOpt = document.createElement('option');
    saveOpt.value = '__save__';
    saveOpt.textContent = '＋ Save current instructions as preset…';
    actionGroup.appendChild(saveOpt);
    if (customTemplates.length) {
      const delOpt = document.createElement('option');
      delOpt.value = '__delete__';
      delOpt.textContent = '🗑 Delete a custom preset…';
      actionGroup.appendChild(delOpt);
    }
    templateSelect.appendChild(actionGroup);
  }

  function applyTemplate(t) {
    if (!t) return;
    instructionsInput.value = t.text;
    if (t.voice_settings) applyVoiceSettings(t.voice_settings);
    updateSliderOutputs();
    persistSettings();
  }

  function saveCurrentAsTemplate() {
    const text = instructionsInput.value.trim();
    if (!text) {
      showStatus('Write some voice instructions first, then save them as a preset.');
      return;
    }
    const name = (window.prompt('Name this instruction preset:', '') || '').trim();
    if (!name) return;
    customTemplates.push({
      id: `tpl-${Date.now()}`,
      label: name,
      text,
      voice_settings: collectVoiceSettings()
    });
    saveCustomTemplates();
    renderTemplateSelect();
    showStatus(`Instruction preset “${name}” saved.`, 'info');
  }

  function deleteCustomTemplate() {
    if (!customTemplates.length) return;
    const list = customTemplates.map((t, i) => `${i + 1}. ${t.label}`).join('\n');
    const answer = (window.prompt(`Delete which preset? Enter its number:\n\n${list}`, '') || '').trim();
    const idx = Number(answer) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= customTemplates.length) return;
    const [removed] = customTemplates.splice(idx, 1);
    saveCustomTemplates();
    renderTemplateSelect();
    showStatus(`Deleted “${removed.label}”.`, 'info');
  }

  renderTemplateSelect();

  templateSelect.addEventListener('change', () => {
    const val = templateSelect.value;
    templateSelect.value = '';
    if (!val) return;
    if (val === '__save__') return saveCurrentAsTemplate();
    if (val === '__delete__') return deleteCustomTemplate();
    if (val.startsWith('builtin:')) {
      applyTemplate(BUILTIN_TEMPLATES[Number(val.slice(8))]);
    } else if (val.startsWith('custom:')) {
      applyTemplate(customTemplates.find((t) => t.id === val.slice(7)));
    }
  });

  [stabilitySlider, similaritySlider, styleSlider].forEach((slider) =>
    slider.addEventListener('input', () => {
      updateSliderOutputs();
      persistSettings();
    })
  );
  speakerBoostToggle.addEventListener('change', persistSettings);
  [instructionsInput, formatSelect].forEach((el) =>
    el.addEventListener('change', persistSettings)
  );

  speakBtn.addEventListener('click', startGeneration);
  textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') startGeneration();
  });

  // Queue controls
  pauseBtn.addEventListener('click', () => {
    paused = true;
    updateControls();
    showStatus('Paused. The current part finishes, then generation waits.', 'info');
  });
  resumeBtn.addEventListener('click', () => {
    if (running) {
      paused = false;
      updateControls();
      clearStatus();
    } else {
      clearStatus();
      runQueue();
    }
  });
  cancelBtn.addEventListener('click', () => {
    cancelRequested = true;
    paused = false;
  });
  retryBtn.addEventListener('click', () => {
    if (!batch) return;
    batch.items.forEach((i) => {
      if (i.status === 'error') i.status = 'pending';
    });
    persistBatch();
    clearStatus();
    runQueue();
  });
  clearBtn.addEventListener('click', async () => {
    if (running) return;
    if (!confirm('Clear this batch and its generated audio?')) return;
    await clearBatch();
    clearStatus();
  });

  zipBtn.addEventListener('click', () => {
    if (batch) zipDownload(batch.items.filter((i) => i.status === 'done'), { includeSubtitles: true });
  });
  zipSelectedBtn.addEventListener('click', () => {
    if (batch) zipDownload(batch.items.filter((i) => i.status === 'done' && selected.has(i.index)));
  });
  downloadEachBtn.addEventListener('click', () => {
    if (batch) downloadEach();
  });
  selectAllToggle.addEventListener('change', () => {
    if (!batch) return;
    const doneItems = batch.items.filter((i) => i.status === 'done');
    if (selectAllToggle.checked) doneItems.forEach((i) => selected.add(i.index));
    else selected.clear();
    renderQueue();
  });

  // Subtitles (timed from the batch's generated audio)
  async function downloadSubtitles(kind) {
    const cues = await computeCues();
    if (!cues.length) {
      showStatus('There’s nothing to caption yet.');
      return;
    }
    const project = subtitleProject();
    if (kind === 'srt') downloadText(`${project}.srt`, toSRT(cues), 'application/x-subrip');
    else if (kind === 'vtt') downloadText(`${project}.vtt`, toVTT(cues), 'text/vtt');
    else if (kind === 'txt') downloadText(`${project}.txt`, toPlainText(cues), 'text/plain;charset=utf-8');
  }

  subPreviewBtn.addEventListener('click', () => openSubtitleModal(false));
  subSrtBtn.addEventListener('click', () => downloadSubtitles('srt'));
  subVttBtn.addEventListener('click', () => downloadSubtitles('vtt'));
  subCopyBtn.addEventListener('click', async () => {
    const cues = await computeCues();
    if (cues.length) copyText(toSRT(cues));
    else showStatus('There’s nothing to caption yet.');
  });

  // Subtitle preview modal actions
  subtitleCopy.addEventListener('click', () => {
    if (activeSubtitles) copyText(toSRT(activeSubtitles.cues));
  });
  subtitleSrt.addEventListener('click', () => {
    if (activeSubtitles) downloadText(`${activeSubtitles.project}.srt`, toSRT(activeSubtitles.cues), 'application/x-subrip');
  });
  subtitleVtt.addEventListener('click', () => {
    if (activeSubtitles) downloadText(`${activeSubtitles.project}.vtt`, toVTT(activeSubtitles.cues), 'text/vtt');
  });

  // Standalone: subtitles from the currently pasted script (timing estimated,
  // no audio) — always uses the current textarea, even if a batch exists.
  subtitleOnlyBtn.addEventListener('click', () => {
    if (!textInput.value.trim()) {
      showStatus('Paste a script first to generate subtitles.');
      textInput.focus();
      return;
    }
    openSubtitleModal(true);
  });

  resetBtn.addEventListener('click', () => {
    textInput.value = '';
    instructionsInput.value = '';
    applyVoiceSettings({ stability: 0.5, similarity_boost: 0.85, style: 0.1, use_speaker_boost: true });
    updateCharCount();
    updateNamingNote();
    clearStatus();
    stopPreview();
    persistSettings();
  });

  presetSelect.addEventListener('change', () => {
    const p = presets.find((x) => x.id === presetSelect.value);
    if (p) {
      applySettings(p.settings);
      showStatus(`Preset “${p.name}” applied.`, 'info');
    }
  });

  presetSaveBtn.addEventListener('click', openPresetSaveForm);
  presetManageBtn.addEventListener('click', () => {
    openModal(presetModal);
    presetSaveForm.hidden = true;
    renderPresetList();
  });

  presetSaveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = presetNameInput.value.trim().slice(0, 60);
    if (!name) return;
    const project = presetProjectInput.value.trim().slice(0, 60);
    const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!confirm(`A preset named “${name}” already exists. Overwrite it?`)) return;
      existing.settings = collectSettings();
      existing.project = project;
    } else {
      presets.push({
        id: `preset-${Date.now()}`,
        name,
        project,
        settings: collectSettings(),
        isDefault: presets.length === 0
      });
    }
    savePresets();
    presetNameInput.value = '';
    presetProjectInput.value = '';
    presetSaveForm.hidden = true;
    renderPresetList();
    showStatus(`Preset “${name}” saved.`, 'info');
  });

  presetSaveCancel.addEventListener('click', () => {
    presetSaveForm.hidden = true;
  });

  projectFilter.addEventListener('change', renderPresetList);

  [voiceModal, presetModal, subtitleModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!voiceModal.hidden) closeModal(voiceModal);
      if (!presetModal.hidden) closeModal(presetModal);
      if (!subtitleModal.hidden) closeModal(subtitleModal);
    }
  });

  // Reload the voice catalog when the TTS provider changes in AI settings.
  window.addEventListener('blvck:tts-provider-changed', () => {
    stopPreview();
    loadVoices();
  });

  // --- Init --------------------------------------------------------------

  titleInput.value = narration.title || '';
  updateNamingNote();
  updateCharCount();
  updateSliderOutputs();
  renderPresetSelect();
  loadVoices();
  restoreBatch();
})();
