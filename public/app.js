(() => {
  const textInput = document.getElementById('text-input');
  const charCount = document.getElementById('char-count');
  const ssmlToggle = document.getElementById('ssml-toggle');
  const languageSelect = document.getElementById('language-select');
  const voiceSelect = document.getElementById('voice-select');
  const formatSelect = document.getElementById('format-select');
  const rateSlider = document.getElementById('rate-slider');
  const pitchSlider = document.getElementById('pitch-slider');
  const volumeSlider = document.getElementById('volume-slider');
  const rateValue = document.getElementById('rate-value');
  const pitchValue = document.getElementById('pitch-value');
  const volumeValue = document.getElementById('volume-value');
  const speakBtn = document.getElementById('speak-btn');
  const resetBtn = document.getElementById('reset-btn');
  const statusBox = document.getElementById('status');
  const playerSection = document.getElementById('player-section');
  const audioPlayer = document.getElementById('audio-player');
  const downloadLink = document.getElementById('download-link');
  const spinner = speakBtn.querySelector('.spinner');
  const btnLabel = speakBtn.querySelector('.btn-label');

  const FORMAT_EXT = { MP3: 'mp3', OGG_OPUS: 'ogg', LINEAR16: 'wav' };
  const DEFAULT_LANGUAGE = 'en-US';

  let allVoices = [];
  let currentAudioUrl = null;

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

  function updateCharCount() {
    charCount.textContent = `${textInput.value.length} / 5000`;
  }

  function showStatus(message, type = 'error') {
    statusBox.textContent = message;
    statusBox.className = `status ${type}`;
    statusBox.hidden = false;
  }

  function clearStatus() {
    statusBox.hidden = true;
  }

  function setLoading(loading) {
    speakBtn.disabled = loading;
    spinner.hidden = !loading;
    btnLabel.textContent = loading ? 'Generating…' : 'Generate speech';
  }

  function voiceTier(name) {
    if (name.includes('Neural2')) return 'Neural2';
    if (name.includes('Studio')) return 'Studio';
    if (name.includes('Wavenet') || name.includes('WaveNet')) return 'WaveNet';
    if (name.includes('News')) return 'News';
    if (name.includes('Polyglot')) return 'Polyglot';
    if (name.includes('Journey')) return 'Journey';
    if (name.includes('Chirp')) return 'Chirp';
    return 'Standard';
  }

  function populateLanguages() {
    const codes = new Set();
    allVoices.forEach((v) => (v.languageCodes || []).forEach((c) => codes.add(c)));
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

  function populateVoices() {
    const lang = languageSelect.value;
    const voices = allVoices.filter((v) => (v.languageCodes || []).includes(lang));

    const groups = {};
    voices.forEach((v) => {
      const tier = voiceTier(v.name);
      (groups[tier] = groups[tier] || []).push(v);
    });

    voiceSelect.innerHTML = '';
    const tierOrder = ['Neural2', 'Studio', 'WaveNet', 'Journey', 'Chirp', 'News', 'Polyglot', 'Standard'];
    tierOrder
      .filter((tier) => groups[tier])
      .forEach((tier) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = tier;
        groups[tier].forEach((v) => {
          const option = document.createElement('option');
          option.value = v.name;
          const gender = v.ssmlGender
            ? v.ssmlGender.charAt(0) + v.ssmlGender.slice(1).toLowerCase()
            : '';
          option.textContent = gender ? `${v.name} · ${gender}` : v.name;
          optgroup.appendChild(option);
        });
        voiceSelect.appendChild(optgroup);
      });

    if (!voiceSelect.options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No voices available';
      voiceSelect.appendChild(option);
    }
  }

  async function loadVoices() {
    try {
      const response = await fetch('/api/voices');
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.hint || body.error || 'Failed to load voices');
      }
      allVoices = body.voices || [];
      if (!allVoices.length) {
        showStatus('The API returned no voices. Check that the Text-to-Speech API is enabled in your Google Cloud project.');
        return;
      }
      populateLanguages();
      populateVoices();
      clearStatus();
    } catch (err) {
      showStatus(`Could not load voices: ${err.message}`);
    }
  }

  async function synthesize() {
    const text = textInput.value.trim();
    if (!text) {
      showStatus('Enter some text first.');
      textInput.focus();
      return;
    }

    clearStatus();
    setLoading(true);

    try {
      const response = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          ssml: ssmlToggle.checked,
          voiceName: voiceSelect.value,
          languageCode: languageSelect.value,
          audioFormat: formatSelect.value,
          speakingRate: Number(rateSlider.value),
          pitch: Number(pitchSlider.value),
          volumeGainDb: Number(volumeSlider.value)
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.hint ? `${body.error} — ${body.hint}` : body.error || `Request failed (${response.status})`);
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
    } catch (err) {
      showStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    textInput.value = '';
    ssmlToggle.checked = false;
    rateSlider.value = 1;
    pitchSlider.value = 0;
    volumeSlider.value = 0;
    updateSliderOutputs();
    updateCharCount();
    clearStatus();
    playerSection.hidden = true;
    audioPlayer.pause();
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
  }

  function updateSliderOutputs() {
    rateValue.textContent = `${Number(rateSlider.value).toFixed(2).replace(/0$/, '')}×`;
    pitchValue.textContent = Number(pitchSlider.value).toFixed(1);
    volumeValue.textContent = `${Number(volumeSlider.value).toFixed(1)} dB`;
  }

  textInput.addEventListener('input', updateCharCount);
  languageSelect.addEventListener('change', populateVoices);
  [rateSlider, pitchSlider, volumeSlider].forEach((slider) =>
    slider.addEventListener('input', updateSliderOutputs)
  );
  speakBtn.addEventListener('click', synthesize);
  resetBtn.addEventListener('click', resetForm);
  textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') synthesize();
  });

  updateCharCount();
  updateSliderOutputs();
  loadVoices();
})();
