// The narration transcript: word-level timing from Whisper, and the artifacts
// built from it.
//
// The distinction this file exists to enforce is between measured time and
// guessed time. AETHER has always had a word timeline — speech-timeline.js
// distributes a sentence across its duration by syllable weight — and that is
// a reasonable guess, but it is a guess. Its own header says so, and it already
// carries an 'aligned' tier waiting for real data.
//
// This module produces that real data's home. A transcript here is only ever
// built from something that actually listened to the audio; there is no code
// path that manufactures timings from character counts, because a plausible
// wrong timestamp is worse than an obviously absent one.
//
// Two artifacts, for two audiences:
//   transcript.json  the machine-readable source, with word timings. What the
//                    Director reads.
//   subtitles.srt    the human/export format. Derived from the transcript,
//                    never parsed back into it — reparsing an SRT throws away
//                    the word timings and keeps only the segment ones.
(() => {
  'use strict';

  const SCHEMA_VERSION = '1.0';

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  /**
   * Build a transcript from a speech-recognition result.
   *
   * `source` records how the timings were obtained, and it is not decorative:
   * everything downstream is allowed to treat 'whisper' as authoritative and
   * must not treat anything else that way.
   */
  function fromWhisper(result, { audioFingerprint = '', model = '' } = {}) {
    const rawSegments = (result && result.segments) || [];
    const segments = rawSegments.map((seg, i) => {
      const words = ((seg.words || []).map((w) => ({
        word: String(w.word == null ? w.text : w.word || '').trim(),
        start: num(w.start),
        end: num(w.end)
      })).filter((w) => w.word && w.end >= w.start));

      return {
        id: seg.id != null ? String(seg.id) : `seg_${String(i + 1).padStart(3, '0')}`,
        start: num(seg.start),
        end: num(seg.end),
        text: String(seg.text || '').trim(),
        words
      };
    }).filter((s) => s.text && s.end > s.start);

    const duration = num(result && result.duration,
      segments.length ? segments[segments.length - 1].end : 0);

    return {
      transcriptVersion: SCHEMA_VERSION,
      source: 'whisper',
      model: String(model || (result && result.model) || ''),
      language: String((result && result.language) || ''),
      audioDuration: duration,
      // Lets a later audio change be detected rather than assumed away.
      audioFingerprint: String(audioFingerprint || ''),
      createdAt: Date.now(),
      segments,
      wordCount: segments.reduce((n, s) => n + s.words.length, 0)
    };
  }

  /**
   * Build a transcript from BlvckSync's aligned timeline.
   *
   * This is the path that actually runs in production. Fish Speech generates
   * the narration, and the Fish backend already has faster_whisper resident
   * for voice cloning — so sync-engine.js asks it for forced alignment over
   * /v1/align and gets real word timings back. There is no second Whisper to
   * deploy and nothing competing with the Director for VRAM, because the model
   * is already loaded on the machine that made the audio.
   *
   * The tier is carried through honestly: only sync-engine's 'aligned' source
   * becomes a measured transcript. 'measured' means per-chunk durations with
   * words distributed inside them by syllable weight, and 'estimated' means
   * nothing but the text — neither is something to hang an edit on, so both
   * stay unmeasured and every guard downstream keeps refusing them.
   */
  function fromSyncTimeline(timeline, { script = '', audioFingerprint = '', model = '' } = {}) {
    if (!timeline || !Array.isArray(timeline.words)) return null;

    const words = timeline.words
      .map((w) => ({
        word: String(w.text == null ? w.word : w.text || '').trim(),
        start: num(w.start),
        end: num(w.end)
      }))
      .filter((w) => w.word && w.end >= w.start);
    if (!words.length) return null;

    // sync-engine already groups words into sentences; use its grouping rather
    // than re-splitting the text, so the segment boundaries match the audio.
    const sentences = Array.isArray(timeline.sentences) && timeline.sentences.length
      ? timeline.sentences
      : [{ start: words[0].start, end: words[words.length - 1].end }];

    const segments = sentences.map((sen, i) => {
      const from = num(sen.start), to = num(sen.end);
      const mine = words.filter((w) => w.start >= from - 0.01 && w.end <= to + 0.01);
      return {
        id: `seg_${String(i + 1).padStart(3, '0')}`,
        start: from,
        end: to,
        text: String(sen.text || mine.map((w) => w.word).join(' ')).trim(),
        words: mine
      };
    }).filter((s) => s.text && s.end > s.start);

    return {
      transcriptVersion: SCHEMA_VERSION,
      // Only real forced alignment counts as measured.
      source: timeline.source === 'aligned' ? 'whisper' : 'estimated',
      model: String(model || timeline.provider || ''),
      language: '',
      audioDuration: num(timeline.duration, words[words.length - 1].end),
      audioFingerprint: String(audioFingerprint || ''),
      createdAt: Date.now(),
      alignmentTier: timeline.source || 'estimated',
      script: String(script || ''),
      segments,
      wordCount: words.length
    };
  }

  /** Does this transcript carry real word timings, or only segment ones? */
  function hasWordTimings(transcript) {
    if (!transcript || !Array.isArray(transcript.segments)) return false;
    return transcript.segments.some((s) => s.words && s.words.length > 0);
  }

  /** Is the timing authoritative, or a guess we must not build an edit on? */
  function isMeasured(transcript) {
    return !!transcript && transcript.source === 'whisper';
  }

  // ── Word lookup ───────────────────────────────────────────────────────────

  /** Every word in the transcript, flattened, in spoken order. */
  function words(transcript) {
    if (!transcript || !Array.isArray(transcript.segments)) return [];
    return transcript.segments.flatMap((s) => s.words || []);
  }

  function normaliseWord(w) {
    return String(w || '').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, '');
  }

  /**
   * When was this phrase actually spoken?
   *
   * This is what lets a "40%" card appear as the narrator says "forty percent"
   * rather than at the top of the scene. Returns null when the phrase is not
   * found, because guessing a position would put the overlay on the wrong word.
   */
  function findPhrase(transcript, phrase, { after = 0 } = {}) {
    const needle = String(phrase || '').trim().split(/\s+/).map(normaliseWord).filter(Boolean);
    if (!needle.length) return null;

    const all = words(transcript).filter((w) => w.end > after);
    for (let i = 0; i <= all.length - needle.length; i++) {
      let hit = true;
      for (let j = 0; j < needle.length; j++) {
        const spoken = normaliseWord(all[i + j].word);
        // A spoken number may be written either way round ("40" vs "forty"),
        // so accept a containment match rather than only equality.
        if (spoken !== needle[j] && !spoken.includes(needle[j]) && !needle[j].includes(spoken)) {
          hit = false;
          break;
        }
      }
      if (hit) {
        return {
          start: all[i].start,
          end: all[i + needle.length - 1].end,
          matched: all.slice(i, i + needle.length).map((w) => w.word).join(' ')
        };
      }
    }
    return null;
  }

  /** The segment covering a moment, for anchoring a visual to a sentence. */
  function segmentAt(transcript, t) {
    if (!transcript) return null;
    return (transcript.segments || []).find((s) => t >= s.start && t <= s.end) || null;
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────

  function srtTimecode(seconds) {
    const total = Math.max(0, num(seconds));
    const ms = Math.round((total - Math.floor(total)) * 1000);
    const whole = Math.floor(total);
    const h = String(Math.floor(whole / 3600)).padStart(2, '0');
    const m = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
    const s = String(whole % 60).padStart(2, '0');
    return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
  }

  /**
   * A real SRT, from measured timings.
   *
   * Refuses to emit from an unmeasured transcript. A subtitle file that looks
   * right and drifts is harder to notice than one that was never produced.
   */
  function toSRT(transcript) {
    if (!isMeasured(transcript)) {
      throw new Error('Refusing to write subtitles from estimated timing — transcribe the audio first.');
    }
    return (transcript.segments || []).map((seg, i) =>
      `${i + 1}\n${srtTimecode(seg.start)} --> ${srtTimecode(seg.end)}\n${seg.text}\n`
    ).join('\n');
  }

  /** The alignment object speech-timeline.js already knows how to consume. */
  function toAlignment(transcript) {
    if (!hasWordTimings(transcript)) return null;
    return {
      duration: transcript.audioDuration,
      words: words(transcript).map((w) => ({ text: w.word, start: w.start, end: w.end })),
      phonemes: []
    };
  }

  /**
   * What the Director is given (spec section 6).
   *
   * Word timings are included but capped: a ten-minute narration is thousands
   * of words, and spending the model's context on all of them would crowd out
   * the script. Segments always travel in full; words travel for the segments
   * where they earn their place.
   */
  function forDirector(transcript, { maxWords = 400 } = {}) {
    if (!isMeasured(transcript)) return null;
    let budget = maxWords;
    return {
      audioDuration: transcript.audioDuration,
      timingSource: 'whisper',
      segments: (transcript.segments || []).map((s) => {
        const out = { id: s.id, start: round(s.start), end: round(s.end), text: s.text };
        if (budget > 0 && s.words.length) {
          out.words = s.words.slice(0, budget).map((w) => ({
            word: w.word, start: round(w.start), end: round(w.end)
          }));
          budget -= out.words.length;
        }
        return out;
      })
    };
  }

  function round(n) { return Math.round(num(n) * 100) / 100; }

  // ── Staleness (spec section 14) ───────────────────────────────────────────

  /**
   * Cheap fingerprint of the narration audio.
   *
   * Size and duration together are enough to notice a re-recording. Not
   * cryptographic — the point is to catch "the audio changed and the
   * timestamps did not", which is otherwise invisible until the finished video
   * is out of sync.
   */
  function fingerprint({ byteLength = 0, duration = 0 } = {}) {
    return `${Math.round(byteLength)}:${Math.round(num(duration) * 100)}`;
  }

  function isStale(transcript, audioInfo) {
    if (!transcript) return true;
    if (!transcript.audioFingerprint) return false;   // nothing to compare against
    return transcript.audioFingerprint !== fingerprint(audioInfo);
  }

  window.Transcript = {
    SCHEMA_VERSION,
    fromWhisper,
    fromSyncTimeline,
    hasWordTimings,
    isMeasured,
    words,
    findPhrase,
    segmentAt,
    toSRT,
    toAlignment,
    forDirector,
    fingerprint,
    isStale,
    srtTimecode
  };
})();
