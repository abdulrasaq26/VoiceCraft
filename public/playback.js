// Playback Controller + Event Bus — the heartbeat.
//
// Before this, every subsystem owned a loop. The character engine advanced its
// own clock, visemes cycled on elapsed time, the whiteboard drew at a constant
// rate, and charts animated on setTimeout. Nothing could be seeked, scrubbing
// desynchronised everything, and a mouth could move while the narrator was
// silent — because "now" meant something different in each subsystem.
//
// There is one clock here and one requestAnimationFrame loop for the whole
// application. Subsystems no longer ask "how long since I started?" — they ask
// the controller what should be true at the current position, or subscribe to
// the moment it becomes true.
//
// Two ways to consume it, and both are pull-or-push off the SAME clock:
//
//   BlvckPlayback.on('wordStart', fn)   push — react when something happens
//   BlvckPlayback.time()                pull — draw whatever is true now
//
// Seeking, pausing and rate changes therefore keep every subsystem in step for
// free: there is nothing else to keep in step.
(() => {
  'use strict';

  // --- event bus -----------------------------------------------------------
  const listeners = new Map();

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  }

  function emit(type, payload) {
    const set = listeners.get(type);
    if (set) {
      set.forEach((fn) => {
        // A broken subscriber must never stop the clock or starve the others.
        try {
          fn(payload);
        } catch (err) {
          console.warn(`[Playback] listener for "${type}" threw:`, err.message);
        }
      });
    }
    const all = listeners.get('*');
    if (all) all.forEach((fn) => { try { fn(type, payload); } catch { /* ignore */ } });
  }

  // --- state ---------------------------------------------------------------
  let timeline = null;
  let events = [];          // scheduled semantic events, sorted by time
  let position = 0;         // seconds
  let playing = false;
  let rate = 1;
  let rafId = null;
  let lastFrame = 0;
  let audioEl = null;       // when present, the AUDIO is the clock

  // What was true on the previous frame, so transitions can be detected rather
  // than re-fired every frame.
  let prev = { word: null, sentence: null, pause: false, speaking: false, cursor: 0 };

  function setTimeline(tl, scheduledEvents) {
    timeline = tl || null;
    events = (scheduledEvents || []).slice().sort((a, b) => a.time - b.time);
    prev = { word: null, sentence: null, pause: false, speaking: false, cursor: 0 };
    emit('timelineChanged', { timeline, events });
  }

  /**
   * Bind an <audio> element as the clock.
   *
   * When narration is actually playing, the audio element IS the truth — a
   * separate rAF-accumulated timer drifts against it within seconds, which is
   * precisely the A/V desync this project has fought all the way through.
   */
  function bindAudio(el) {
    audioEl = el || null;
    if (audioEl) {
      audioEl.playbackRate = rate;
      emit('audioBound', { duration: audioEl.duration || 0 });
    }
  }

  const duration = () => (timeline && timeline.duration) || (audioEl && audioEl.duration) || 0;
  const time = () => position;
  const isPlaying = () => playing;
  const getRate = () => rate;

  // --- the single loop -----------------------------------------------------

  function tick(now) {
    rafId = null;
    if (!playing) return;

    if (audioEl && !audioEl.paused) {
      position = audioEl.currentTime;
    } else {
      const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
      position += dt * rate;
    }
    lastFrame = now;

    const total = duration();
    if (total && position >= total) {
      position = total;
      publish();
      pause();
      emit('ended', { time: position });
      return;
    }

    publish();
    rafId = requestAnimationFrame(tick);
  }

  /** Derive and emit everything that changed since the last frame. */
  function publish() {
    const S = window.BlvckSync;
    const t = position;

    if (timeline && S) {
      const word = S.wordAt(timeline, t);
      const sentence = S.sentenceAt(timeline, t);
      const paused = S.inPause(timeline, t);
      const speaking = !!word;

      if (word !== prev.word) {
        if (prev.word) emit('wordEnd', { word: prev.word, time: t });
        if (word) emit('wordStart', { word, time: t });
      }
      if (sentence !== prev.sentence) {
        if (prev.sentence) emit('sentenceEnd', { sentence: prev.sentence, time: t });
        if (sentence) emit('sentenceStart', { sentence, time: t });
      }
      if (paused !== prev.pause) emit(paused ? 'pauseStart' : 'pauseEnd', { time: t });
      if (speaking !== prev.speaking) emit(speaking ? 'speakingStart' : 'speakingEnd', { time: t });

      prev.word = word;
      prev.sentence = sentence;
      prev.pause = paused;
      prev.speaking = speaking;
    }

    // Scheduled semantic events, fired once as the cursor passes them.
    if (events.length) {
      for (const e of events) {
        if (e.time > prev.cursor && e.time <= t) emit(e.type, e);
      }
    }
    prev.cursor = t;

    // One frame signal for everything that draws.
    emit('frame', { time: t, playing, timeline });
  }

  // --- transport -----------------------------------------------------------

  function play() {
    if (playing) return;
    playing = true;
    lastFrame = 0;
    if (audioEl) {
      audioEl.currentTime = position;
      audioEl.playbackRate = rate;
      audioEl.play().catch(() => { /* autoplay policy; the clock still runs */ });
    }
    emit('play', { time: position });
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (audioEl) audioEl.pause();
    emit('pause', { time: position });
  }

  /**
   * Jump to a position.
   *
   * Re-seeds the previous-frame state from the new position instead of
   * replaying everything in between, so scrubbing backwards does not re-fire a
   * hundred stale events, and every subsystem simply redraws what is true
   * there.
   */
  function seek(t) {
    const total = duration();
    position = Math.max(0, total ? Math.min(t, total) : t);
    if (audioEl) audioEl.currentTime = position;

    const S = window.BlvckSync;
    prev = {
      word: timeline && S ? S.wordAt(timeline, position) : null,
      sentence: timeline && S ? S.sentenceAt(timeline, position) : null,
      pause: timeline && S ? S.inPause(timeline, position) : false,
      speaking: timeline && S ? !!S.wordAt(timeline, position) : false,
      cursor: position
    };
    emit('seek', { time: position });
    emit('frame', { time: position, playing, timeline });
  }

  function seekSentence(index) {
    if (!timeline || !timeline.sentences.length) return;
    const s = timeline.sentences[Math.max(0, Math.min(index, timeline.sentences.length - 1))];
    if (s) seek(s.start);
  }

  /** Jump to the words themselves — how a person actually navigates narration. */
  function seekPhrase(phrase) {
    const S = window.BlvckSync;
    if (!timeline || !S) return false;
    const hit = S.find(timeline, phrase);
    if (!hit) return false;
    seek(hit.start);
    return true;
  }

  function setRate(r) {
    rate = Math.max(0.25, Math.min(4, Number(r) || 1));
    if (audioEl) audioEl.playbackRate = rate;
    emit('rateChanged', { rate });
  }

  // --- pull-side helpers ---------------------------------------------------
  //
  // For subsystems that draw every frame rather than reacting to events. They
  // ask what is true NOW; they never track it themselves.

  function state() {
    const S = window.BlvckSync;
    const t = position;
    if (!timeline || !S) {
      return { time: t, playing, speaking: false, word: null, sentence: null, pause: false, mouth: 0.05 };
    }
    return {
      time: t,
      playing,
      word: S.wordAt(timeline, t),
      sentence: S.sentenceAt(timeline, t),
      pause: S.inPause(timeline, t),
      speaking: S.speakingAt(timeline, t),
      mouth: S.mouthAt(timeline, t),
      source: timeline.source,
      confidence: timeline.confidence
    };
  }

  /** Progress through the current sentence, 0..1 — what a whiteboard needs to
   *  draw at the pace of the explanation rather than a fixed speed. */
  function sentenceProgress() {
    const s = state().sentence;
    if (!s) return 0;
    const span = s.end - s.start || 1;
    return Math.max(0, Math.min(1, (position - s.start) / span));
  }

  function reset() {
    pause();
    position = 0;
    prev = { word: null, sentence: null, pause: false, speaking: false, cursor: 0 };
  }

  window.BlvckPlayback = {
    on, off, emit,
    setTimeline, bindAudio,
    play, pause, seek, seekSentence, seekPhrase, setRate, reset,
    time, duration, isPlaying, rate: getRate,
    state, sentenceProgress,
    timeline: () => timeline,
    events: () => events.slice()
  };
})();
