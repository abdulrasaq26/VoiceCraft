(() => {
  'use strict';

  // --- Elements ----------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const textInput = $('text-input');
  const charCount = $('char-count');
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
  const playerSection = $('player-section');
  const audioPlayer = $('audio-player');
  const downloadLink = $('download-link');
  const waveformCanvas = $('waveform');
  const speakSpinner = speakBtn.querySelector('.spinner');
  const speakLabel = speakBtn.querySelector('.btn-label');

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

  const LS = {
    settings: 'blvck-tts:settings',
    presets: 'blvck-tts:presets',
    favorites: 'blvck-tts:favorites',
    recents: 'blvck-tts:recents'
  };

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
  const filters = { search: '', tier: 'all', gender: 'all' };
  let currentAudioUrl = null;

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

  function updateCharCount() {
    charCount.textContent = `${textInput.value.length} / 5000`;
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
      const response = await fetch('/api/voices');
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.hint || body.error || 'Failed to load voices');
      }
      allVoices = body.voices || [];
      voiceById.clear();
      allVoices.forEach((v) => voiceById.set(v.id, v));
      if (!allVoices.length) {
        voiceCardName.textContent = 'No voices available';
        showStatus('The API returned no voices. Check that the Text-to-Speech API is enabled in your Google Cloud project.');
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
    rateControl.title = caps.rate ? '' : 'Google’s API rejects speed control for this voice family';
    pitchControl.title = caps.pitch ? '' : 'Google’s API rejects pitch control for this voice family';
    ssmlToggle.disabled = v ? !caps.ssml : false;
    if (v && !caps.ssml && ssmlToggle.checked) ssmlToggle.checked = false;

    if (capsNote) {
      const limits = [];
      if (!caps.rate) limits.push('speed');
      if (!caps.pitch) limits.push('pitch');
      if (v && limits.length) {
        const range = caps.rate && rateMax < 4 ? ` Speed is available up to ${rateMax}× for this voice.` : '';
        capsNote.textContent = `${v.name} (${v.family}) doesn’t accept ${limits.join(' or ')} adjustments — Google’s API rejects the request if they’re sent, so they’re disabled here.${range}`;
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
  // The audio element streams /api/preview directly and play() is called
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

    const params = new URLSearchParams({ voiceName: v.id, languageCode: v.language });
    previewAudio.src = `/api/preview?${params}`;
    // play() must be called synchronously in the gesture handler.
    previewAudio.play().catch((err) => {
      if (previewVoiceId !== voiceId) return; // superseded by another action
      if (err.name === 'NotAllowedError') {
        showStatus('Your browser blocked audio playback. Tap the preview button again to allow it.');
        stopPreview();
      }
      // Other failures (e.g. server error) are handled by the 'error' event.
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
    if (voiceModal.hidden && presetModal.hidden) {
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

  // --- Synthesis ---------------------------------------------------------

  function setGenerating(loading) {
    speakBtn.disabled = loading;
    speakSpinner.hidden = !loading;
    speakLabel.textContent = loading ? 'Generating…' : 'Generate speech';
  }

  async function synthesize() {
    const text = textInput.value.trim();
    if (!text) {
      showStatus('Enter some text first.');
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
    setGenerating(true);

    try {
      const response = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          ssml: ssmlToggle.checked,
          voiceName: v.id,
          languageCode: languageSelect.value,
          audioFormat: formatSelect.value,
          speakingRate: Number(rateSlider.value),
          pitch: Number(pitchSlider.value),
          volumeGainDb: Number(volumeSlider.value),
          instructions: instructionsInput.value.trim()
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.hint ? `${body.error} — ${body.hint}` : body.error || `Request failed (${response.status})`
        );
      }

      const blob = await response.blob();
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = URL.createObjectURL(blob);
      audioPlayer.src = currentAudioUrl;
      const ext = FORMAT_EXT[formatSelect.value] || 'mp3';
      downloadLink.href = currentAudioUrl;
      downloadLink.download = `blvck-tts-${Date.now()}.${ext}`;
      playerSection.hidden = false;
      audioPlayer.play().catch(() => {
        /* Autoplay may be blocked; user can press play manually. */
      });

      drawWaveform(blob);
      recordRecent(v.id);
      persistSettings();

      const instructionsSent = instructionsInput.value.trim();
      if (instructionsSent && response.headers.get('X-Instructions-Applied') === '0' && !v.promptCapable) {
        showStatus(
          'Generated. Note: this voice doesn’t take free-text instructions directly — your speed and pitch settings shaped the delivery instead.',
          'info'
        );
      }
    } catch (err) {
      showStatus(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function drawWaveform(blob) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const audioBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const data = audioBuf.getChannelData(0);
      const canvas = waveformCanvas;
      const g = canvas.getContext('2d');
      const { width, height } = canvas;
      g.clearRect(0, 0, width, height);
      const bars = 240;
      const samplesPerBar = Math.max(1, Math.floor(data.length / bars));
      g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8b64c';
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        const startIdx = i * samplesPerBar;
        for (let j = startIdx; j < startIdx + samplesPerBar && j < data.length; j += 16) {
          const abs = Math.abs(data[j]);
          if (abs > peak) peak = abs;
        }
        const barHeight = Math.max(2, peak * height * 0.9);
        const x = (i / bars) * width;
        g.fillRect(x, (height - barHeight) / 2, Math.max(2, width / bars - 2), barHeight);
      }
      canvas.hidden = false;
      ctx.close();
    } catch {
      waveformCanvas.hidden = true;
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

  textInput.addEventListener('input', updateCharCount);

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

  speakBtn.addEventListener('click', synthesize);
  textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') synthesize();
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
    clearStatus();
    stopPreview();
    playerSection.hidden = true;
    waveformCanvas.hidden = true;
    audioPlayer.pause();
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
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

  [voiceModal, presetModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!voiceModal.hidden) closeModal(voiceModal);
      if (!presetModal.hidden) closeModal(presetModal);
    }
  });

  // --- Init --------------------------------------------------------------

  updateCharCount();
  updateSliderOutputs();
  renderPresetSelect();
  loadVoices();
})();
