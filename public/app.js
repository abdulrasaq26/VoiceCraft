(() => {
  'use strict';

  // --- Elements ----------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const textInput = $('text-input');
  const charCount = $('char-count');
  const titleInput = $('title-input');
  const namingNote = $('naming-note');
  const ssmlToggle = $('ssml-toggle');
  const languageSelect = $('language-select');
  const formatSelect = $('format-select');
  const voiceCard = $('voice-card');
  const voiceCardName = $('voice-card-name');
  const voiceCardDesc = $('voice-card-desc');
  const previewBtn = $('preview-btn');
  const instructionsInput = $('instructions-input');
  const instructionsNote = $('instructions-note');
  const templateSelect = $('template-select');
  const rateSlider = $('rate-slider');
  const pitchSlider = $('pitch-slider');
  const volumeSlider = $('volume-slider');
  const rateValue = $('rate-value');
  const pitchValue = $('pitch-value');
  const volumeValue = $('volume-value');
  const rateControl = $('rate-control');
  const pitchControl = $('pitch-control');
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

  // Curated ElevenLabs voices (used when the TTS provider is ElevenLabs/Puter).
  // If a specific voice ID isn't available on your Puter access, pick another.
  const ELEVEN_VOICES = [
    ['21m00Tcm4TlvDq8ikWAM', 'Rachel', 'FEMALE', 'Calm Female Narrator'],
    ['EXAVITQu4vr4xnSDxMaL', 'Sarah', 'FEMALE', 'Soft News Female'],
    ['XrExE9yKIg1WjnnlVkGX', 'Matilda', 'FEMALE', 'Warm Female Storyteller'],
    ['XB0fDUnXU5powFXDhCwa', 'Charlotte', 'FEMALE', 'Expressive Female'],
    ['pFZP5JQG7iQjIQuC4Bku', 'Lily', 'FEMALE', 'British Female Narrator'],
    ['AZnzlk1XvdvUeBnXmlld', 'Domi', 'FEMALE', 'Strong Female'],
    ['pNInz6obpgDQGcFmaJgB', 'Adam', 'MALE', 'Deep Male Narrator'],
    ['onwK4e9ZLuTAKqWW03F9', 'Daniel', 'MALE', 'British News Anchor'],
    ['JBFqnCBsd6RMkjVDRZzb', 'George', 'MALE', 'Warm British Male'],
    ['ErXwobaYiN019PkySvjV', 'Antoni', 'MALE', 'Well-Rounded Male'],
    ['VR6AewLTigWG4xSOukaG', 'Arnold', 'MALE', 'Crisp Documentary Male'],
    ['TxGEqnHWrfWFTfGW9XjX', 'Josh', 'MALE', 'Deep Young Male'],
    ['N2lVS1w4EtoT3dr4eOWO', 'Callum', 'MALE', 'Intense Male'],
    ['yoZ06aMxZJJ28mfd3POQ', 'Sam', 'MALE', 'Raspy Male']
  ].map(([id, name, gender, descriptor]) => ({
    id,
    name,
    descriptor,
    tier: 'elite',
    tierLabel: 'Elite',
    badge: '⭐ Elite',
    family: 'ElevenLabs',
    gender,
    language: 'en-US',
    languageCodes: ['en-US'],
    capabilities: { rate: false, rateMax: 4, pitch: false, ssml: false },
    promptCapable: false
  }));

  const LS = {
    settings: 'blvck-tts:settings',
    presets: 'blvck-tts:presets',
    favorites: 'blvck-tts:favorites',
    recents: 'blvck-tts:recents',
    narration: 'blvck-tts:narration',
    batch: 'blvck-tts:batch'
  };

  const DEFAULT_TITLE = 'blvck-tts';

  // Templates tune real API parameters (speed/pitch) alongside the
  // free-text instruction, so they shape delivery on every voice.
  const TEMPLATES = [
    {
      label: 'Documentary Narrator',
      rate: 0.95,
      pitch: -2,
      text: `You are a seasoned documentary narrator in the tradition of prestige nature and science films. Your voice carries quiet authority — you never need to raise it, because the material itself is compelling and your job is to guide the listener through it with complete confidence.

Speak at a measured, deliberate pace. Let sentences breathe. Pause briefly after key facts to give them weight, and slow down slightly when introducing a new idea so the listener can settle into it.

Keep your tone warm but objective. You are fascinated by the subject, and that fascination shows as understated wonder rather than excitement. Avoid any hint of salesmanship or performance — you are a trusted guide, not a presenter.

Articulate clearly and precisely, with gentle downward inflections at the ends of sentences. Emphasize numbers, names, and turning points softly but noticeably. The overall impression should be calm, intelligent, and effortlessly authoritative — the kind of voice a listener could follow for an hour without fatigue.`
    },
    {
      label: 'YouTube History Narration',
      rate: 0.98,
      pitch: -1,
      text: `You are the narrator of a popular YouTube history channel — think slow-burn storytelling about empires, battles, and forgotten figures. Your job is to make the past feel vivid, cinematic, and personal, keeping viewers hooked from the cold open to the final line.

Open with gravity and intrigue, as if letting the viewer in on a secret history. Build each section like a story: set the scene, introduce the players, raise the stakes, then deliver the payoff. Use a rise in energy when battles or turning points arrive, and drop to a lower register for tragedy, betrayal, and aftermath.

Pace yourself like a storyteller, not a lecturer. Vary your rhythm — quicken slightly during action and momentum, then slow right down for consequences and human moments. Leave a beat of silence after a shocking fact or a date that changed everything, letting it land before moving on.

Keep your tone conversational enough for a modern audience: knowledgeable, a little dramatic, occasionally wry, but never dry or academic. Pronounce historical names and places carefully and confidently.

Above all, sustain narrative tension. Every sentence should quietly ask "and then what happened?" — pulling the listener through centuries as if the outcome were still uncertain.`
    },
    {
      label: 'Energetic YouTube Presenter',
      rate: 1.15,
      pitch: 2,
      text: `You are a high-energy YouTube presenter whose channel thrives on momentum. From the first word you are switched on, bright, and glad the viewer showed up — your delivery makes people want to stay for the whole video.

Speak briskly and with punch. Hit the first word of each sentence a little harder to keep the rhythm driving forward. Use big, genuine enthusiasm for reveals, results, and anything surprising — let your voice actually smile.

Keep the energy dynamic rather than flat-out loud: spike for the exciting parts, then pull back to a confiding, almost conspiratorial tone for tips and asides, like you're letting the viewer in on something. That contrast is what keeps the pacing addictive.

Stay conversational and direct — talk *to* the viewer, not *at* them. Short sentences. Clear emphasis. No filler. End sections with an upward hook that propels straight into the next moment.`
    },
    {
      label: 'Calm Bedtime Storyteller',
      rate: 0.85,
      pitch: -1,
      text: `You are reading a bedtime story. Your single goal is to make the listener feel safe, settled, and gently drowsy — the voice of a kind parent reading by lamplight.

Speak slowly and softly, in a low, even register. Let your pace drift a little slower as the story goes on. Never spike in volume or energy, even during exciting moments — render them with hushed wonder instead of drama.

Round off every sentence gently, with soft, falling inflections. Pause often: at commas, between sentences, and especially between paragraphs. The silences are part of the lullaby.

Keep warmth in every word, as if smiling faintly while you read. Characters' voices should be only lightly suggested, never performed. By the final paragraph, your voice should feel like it is tucking the listener in.`
    },
    {
      label: 'Warm & Reassuring',
      rate: 0.92,
      pitch: -0.5,
      text: `You are a trusted friend delivering something the listener needs to hear. Whatever the words say, your voice says: it's okay, you're in good hands, we'll figure this out together.

Speak gently and unhurriedly, with a soft, steady warmth. Keep your volume moderate and your tone level — no sharp emphasis, no sudden shifts. Steadiness itself is the reassurance.

Let kindness color every sentence. Soften consonants slightly, let vowels linger just a touch, and end sentences with settled, downward inflections that feel like a hand on the shoulder.

Where the text delivers difficult or complicated information, slow down and become even more even-keeled — calm competence, never pity. The listener should finish feeling steadier than when they started.`
    },
    {
      label: 'Professional Presenter',
      rate: 1.0,
      pitch: 0,
      text: `You are presenting to a room of professionals whose time is valuable. Your delivery is polished, efficient, and quietly confident — the standard of a keynote speaker who has done this a hundred times.

Speak at a natural, businesslike pace with crisp articulation. Every word is clean; nothing is rushed and nothing drags. Project credibility through evenness rather than force.

Structure your delivery audibly: a slight pause and fresh energy at the start of each new point, measured emphasis on key terms and figures, and firm, conclusive endings to sentences that close an idea.

Remain personable but composed — a hint of warmth so you never sound robotic, but no jokes in your tone, no vocal fry, no uptalk. The impression is competence: someone worth listening to, saying exactly what needs to be said.`
    },
    {
      label: 'Confident Sales Pitch',
      rate: 1.08,
      pitch: 1,
      text: `You are delivering a persuasive pitch, and you genuinely believe in what you're presenting. Your conviction is the product — the listener should feel your certainty before they've even weighed the arguments.

Speak with forward-leaning energy: slightly brisk, always purposeful, never pushy. Confidence comes through a firm, upbeat tone and total fluency — no hesitation, no trailing off.

Emphasize benefits and outcomes with a bright lift, and land the key numbers and claims with deliberate, punchy stress. After the strongest points, pause a fraction longer than feels natural — let the value sink in.

Build toward the close. Momentum should rise gently through the pitch so the final call to action arrives with warmth and certainty, an easy handshake in vocal form: friendly, direct, and impossible to mistake.`
    },
    {
      label: 'Friendly Conversational',
      rate: 1.02,
      pitch: 0.5,
      text: `You are chatting with a friend — relaxed, natural, and completely unforced. Nothing about your delivery should sound like a script, a broadcast, or a performance.

Speak at an easy, everyday pace with the loose rhythm of real conversation: some sentences quick and offhand, others slower where a thought deserves it. Natural little pauses beat perfect fluency.

Keep the tone light and good-humored, with an audible smile behind most sentences. Emphasis falls where it would in real speech — on the surprising word, the funny detail, the thing you'd lean in to say.

Stay warm and inclusive, as if the listener is nodding along across the table. Contractions, casual phrasing, gentle inflections — the overall feeling is: this is just us, talking.`
    },
    {
      label: 'Serious Educator',
      rate: 0.95,
      pitch: -1,
      text: `You are an experienced teacher explaining something that matters, to a student you respect. Clarity is your obsession; the listener must be able to follow every step of the reasoning the first time they hear it.

Speak precisely and deliberately. Keep a moderate, even pace, slowing down noticeably for definitions, transitions between ideas, and anything the listener will need to remember.

Use emphasis surgically: stress the term being defined, the word that changes the meaning, the number that matters. Pause after each complete idea — a beat of silence that says "make sure you have this before we move on."

Your tone is serious but never cold: patient, focused, and confident in the listener's ability to understand. No theatrics, no condescension — just the calm assurance of someone who knows the subject deeply and wants you to know it too.`
    },
    {
      label: 'Slow & Clear',
      rate: 0.8,
      pitch: 0,
      text: `Your one job is maximum intelligibility. Every word must be effortlessly understood the first time — by non-native speakers, in noisy environments, or in recordings that will be slowed down or transcribed.

Speak slowly and evenly, well below a normal conversational pace. Give every syllable its full value. Do not rush the ends of words or sentences.

Enunciate crisply: clean consonants, fully-formed vowels, clear boundaries between words. Insert a distinct pause at every comma and a longer one at every full stop.

Keep the tone neutral, pleasant, and steady — no dramatic emphasis, no swings in energy. Think of an excellent language-learning recording: unhurried, friendly, and perfectly clear from the first word to the last.`
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
  const filters = { search: '', tier: 'all', gender: 'all' };
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
      const key = `${batch.id}:${batch.items.filter((i) => i.status === 'done').length}:${batch.settings.speakingRate}`;
      if (subtitleCache.key === key && subtitleCache.cues) return subtitleCache.cues;
      const rate = batch.settings.speakingRate;
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
    return cuesFromSegments([{ text, durationSec: estimateDurationSec(text, Number(rateSlider.value)) }]);
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
    rateValue.textContent = `${Number(rateSlider.value).toFixed(2).replace(/0$/, '')}×`;
    pitchValue.textContent = Number(pitchSlider.value).toFixed(1);
    volumeValue.textContent = `${Number(volumeSlider.value).toFixed(1)} dB`;
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
      rate: Number(rateSlider.value),
      pitch: Number(pitchSlider.value),
      volume: Number(volumeSlider.value),
      format: formatSelect.value,
      ssml: ssmlToggle.checked
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
    if (Number.isFinite(s.rate)) rateSlider.value = s.rate;
    if (Number.isFinite(s.pitch)) pitchSlider.value = s.pitch;
    if (Number.isFinite(s.volume)) volumeSlider.value = s.volume;
    if (s.format && FORMAT_EXT[s.format]) formatSelect.value = s.format;
    ssmlToggle.checked = Boolean(s.ssml);
    updateSliderOutputs();
    renderVoiceCard();
    persistSettings();
  }

  // --- Voice catalog -----------------------------------------------------

  async function loadVoices() {
    try {
      allVoices = ELEVEN_VOICES.slice();
      voiceById.clear();
      allVoices.forEach((v) => voiceById.set(v.id, v));
      if (!allVoices.length) {
        voiceCardName.textContent = 'No voices available';
        showStatus('The ElevenLabs voice catalog is empty.');
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

  // Grey out only what the voice's family truly can't do (Google rejects
  // the parameter), adjust the speed range, and say so visibly.
  function syncCapabilityUI() {
    const v = currentVoice();
    const caps = v ? v.capabilities : { rate: true, rateMax: 4, pitch: true, ssml: true };

    rateSlider.disabled = !caps.rate;
    const rateMax = caps.rateMax || 4;
    rateSlider.max = rateMax;
    if (Number(rateSlider.value) > rateMax) {
      rateSlider.value = rateMax;
      updateSliderOutputs();
    }

    pitchSlider.disabled = !caps.pitch;
    rateControl.classList.toggle('unsupported', !caps.rate);
    pitchControl.classList.toggle('unsupported', !caps.pitch);
    rateControl.title = caps.rate ? '' : 'This voice doesn’t support speed control';
    pitchControl.title = caps.pitch ? '' : 'This voice doesn’t support pitch control';
    const cantSsml = Boolean(v) && !caps.ssml;
    ssmlToggle.disabled = cantSsml;
    if (cantSsml && ssmlToggle.checked) ssmlToggle.checked = false;
    const ssmlLabel = ssmlToggle.closest('.ssml-toggle');
    if (ssmlLabel) {
      ssmlLabel.title = cantSsml
        ? `${v.family} voices only accept plain text — SSML isn’t available for this voice family. On Google, pick a Neural2, WaveNet, Studio, or Standard voice to use SSML.`
        : 'Treat input as SSML markup (pauses, pronunciation, emphasis, etc.)';
    }

    if (capsNote) {
      // Collect everything Google won't accept for this voice family so the
      // disabled controls (sliders + SSML) are explained in one place.
      const adjustments = [];
      if (!caps.rate) adjustments.push('speed');
      if (!caps.pitch) adjustments.push('pitch');
      const parts = [];
      if (adjustments.length) parts.push(`${adjustments.join(' or ')} adjustments`);
      if (cantSsml) parts.push('SSML input');
      const range = caps.rate && rateMax < 4 ? ` Speed is available up to ${rateMax}× for this voice.` : '';

      if (v && parts.length) {
        const plural = parts.length > 1;
        capsNote.textContent = `${v.name} (${v.family}) doesn’t support ${parts.join(' or ')}, so ${plural ? 'they’re' : 'it’s'} disabled here.${range}`;
        capsNote.hidden = false;
      } else if (v && caps.rate && rateMax < 4) {
        capsNote.textContent = `Google limits ${v.family} voices to ${rateMax}× speed.`;
        capsNote.hidden = false;
      } else {
        capsNote.hidden = true;
      }
    }

    if (!v) {
      instructionsNote.textContent = '';
    } else if (v.promptCapable) {
      instructionsNote.textContent = 'This voice understands free-text instructions and will follow them directly.';
    } else {
      instructionsNote.textContent =
        'This voice family doesn’t take free-text instructions directly — style templates shape its delivery through speed and pitch instead.';
    }
  }

  // --- Voice preview -----------------------------------------------------
  // The audio element streams the ElevenLabs blob URL and play() is called
  // synchronously inside the tap handler, which keeps previews working
  // under mobile autoplay policies (iOS Safari, Chrome for Android).

  const previewAudio = new Audio();
  previewAudio.preload = 'none';
  let previewState = 'idle'; // idle | loading | playing
  let previewVoiceId = null;
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
    const phrase = 'Hello! This is a preview of my voice.';
    window.BlvckAI.speak(phrase, v.id)
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
    if (filters.search) {
      const haystack = `${v.name} ${v.descriptor} ${v.id}`.toLowerCase();
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
    for (const tier of ['elite', 'premium', 'standard', 'experimental']) {
      appendSection(
        { elite: '⭐ Elite Voices', premium: 'Premium Voices', standard: 'Standard Voices', experimental: 'Experimental Voices' }[tier],
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
    desc.textContent = `${v.descriptor} · ${v.id}`;
    info.append(nameLine, desc);

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
        promptCapable: v.promptCapable,
        languageCode: languageSelect.value,
        ssml: ssmlToggle.checked,
        audioFormat: formatSelect.value,
        speakingRate: Number(rateSlider.value),
        pitch: Number(pitchSlider.value),
        volumeGainDb: Number(volumeSlider.value),
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

    // SSML must not be split (tags would break across parts); send as one part.
    const chunks = ssmlToggle.checked ? [text] : chunkScript(text);
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
    if (Number.isFinite(p.settings.rate) && p.settings.rate !== 1) parts.push(`${p.settings.rate}× speed`);
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

  TEMPLATES.forEach((t, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = t.label;
    templateSelect.appendChild(option);
  });

  templateSelect.addEventListener('change', () => {
    const t = TEMPLATES[Number(templateSelect.value)];
    if (!t) return;
    instructionsInput.value = t.text;
    const caps = currentVoice()?.capabilities || { rate: true, pitch: true };
    if (caps.rate) rateSlider.value = t.rate;
    if (caps.pitch) pitchSlider.value = t.pitch;
    updateSliderOutputs();
    persistSettings();
    templateSelect.value = '';
  });

  [rateSlider, pitchSlider, volumeSlider].forEach((slider) =>
    slider.addEventListener('input', () => {
      updateSliderOutputs();
      persistSettings();
    })
  );
  [instructionsInput, formatSelect, ssmlToggle].forEach((el) =>
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
    ssmlToggle.checked = false;
    rateSlider.value = 1;
    pitchSlider.value = 0;
    volumeSlider.value = 0;
    updateSliderOutputs();
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

  // --- Init --------------------------------------------------------------

  titleInput.value = narration.title || '';
  updateNamingNote();
  updateCharCount();
  updateSliderOutputs();
  renderPresetSelect();
  loadVoices();
  restoreBatch();
})();
