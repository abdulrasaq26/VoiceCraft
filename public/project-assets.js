// Central project-asset store — the app's "project memory".
//
// Every module persists to its own localStorage key; this reads them into one
// coherent snapshot so stages can hand data to each other (script → TTS →
// storyboard → images → editor → YouTube) without downloading/re-uploading
// files, drives the pipeline progress tracker, and feeds the AI Production
// Director full context.
//
// window.BlvckAssets — read helpers + status() + snapshot() + change events.
(() => {
  'use strict';

  const K = {
    scriptLast: 'blvck-tts:script-last',
    narration: 'blvck-tts:narration',
    subtitles: 'blvck-tts:subtitles',
    batch: 'blvck-tts:batch',
    settings: 'blvck-tts:settings',
    storyboard: 'blvck-tts:storyboard',
    seo: 'blvck-tts:seo',
    channel: 'blvck-tts:channel',
    editor: 'blvck-tts:editor'
  };

  function read(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  }
  const el = (id) => document.getElementById(id);

  const BlvckAssets = {
    keys: K,

    // The working narration: the voice-studio text box wins (freshest), else
    // the last generated script.
    narrationText() {
      const live = el('text-input');
      if (live && live.value.trim()) return live.value.trim();
      const s = read(K.scriptLast);
      return (s && s.script) || '';
    },
    script() {
      const s = read(K.scriptLast);
      return (s && s.script) || this.narrationText();
    },
    scriptOptions() {
      const s = read(K.scriptLast);
      return (s && s.options) || null;
    },
    title() {
      const t = el('title-input');
      if (t && t.value.trim()) return t.value.trim();
      const n = read(K.narration);
      return (n && n.title) || '';
    },

    // Subtitles as an SRT string. Published by the TTS module; falls back to
    // storyboard cues if present.
    subtitlesSRT() {
      const stored = read(K.subtitles);
      if (stored && stored.srt) return stored.srt;
      const sb = read(K.storyboard);
      if (sb && Array.isArray(sb.cues) && sb.cues.length && sb.cues[0].timestamp) {
        return sb.cues
          .map((c, i) => `${i + 1}\n${(c.timestamp || '').replace(' - ', ' --> ')}\n${c.text}\n`)
          .join('\n');
      }
      return '';
    },
    setSubtitlesSRT(srt, source) {
      if (!srt) return;
      write(K.subtitles, { srt: String(srt), source: source || 'tts', at: Date.now() });
      this.emit();
    },

    hasAudio() {
      const b = read(K.batch);
      return !!(b && Array.isArray(b.items) && b.items.some((i) => i.status === 'done'));
    },
    audioParts() {
      const b = read(K.batch);
      if (!b || !Array.isArray(b.items)) return 0;
      return b.items.filter((i) => i.status === 'done').length;
    },
    voiceSettings() { return read(K.settings); },
    bible() { const sb = read(K.storyboard); return (sb && sb.bible) || null; },
    scenes() { const sb = read(K.storyboard); return (sb && Array.isArray(sb.scenes)) ? sb.scenes : []; },
    generatedScenes() { return this.scenes().filter((s) => s.status === 'done').length; },
    seo() { return read(K.seo); },
    channel() { return read(K.channel); },
    editor() { return read(K.editor); },

    // Per-stage completion for the pipeline tracker.
    status() {
      const scenes = this.scenes();
      return {
        script: !!this.script(),
        voice: this.hasAudio(),
        storyboard: scenes.length > 0,
        images: scenes.some((s) => s.status === 'done'),
        video: !!this.editor(),
        youtube: !!this.seo()
      };
    },

    // A compact context object for the AI Production Director. Trims large
    // fields so the prompt stays bounded.
    snapshot() {
      const scenes = this.scenes();
      const bible = this.bible();
      const seo = this.seo();
      const channel = this.channel();
      const clip = (s, n) => (s ? String(s).slice(0, n) : '');
      return {
        title: this.title(),
        channel: channel || null,
        scriptOptions: this.scriptOptions(),
        script: clip(this.script(), 6000),
        subtitles: clip(this.subtitlesSRT(), 3000),
        audio: { generated: this.hasAudio(), parts: this.audioParts(), voice: (this.voiceSettings() || {}).voiceId || null },
        bible: bible ? { title: bible.title, genre: bible.genre, period: bible.period, tone: bible.tone, audience: bible.audience, format: bible.format, visualStyle: bible.visualStyle, characters: (bible.characters || []).map((c) => c.name) } : null,
        scenes: scenes.slice(0, 40).map((s) => ({ index: s.index, camera: s.camera, action: s.detectedAction || s.sceneSummary, prompt: clip(s.prompt, 240), status: s.status })),
        sceneCount: scenes.length,
        generatedScenes: this.generatedScenes(),
        seo: seo ? { recommendedTitle: seo.recommendedTitle, titleCount: (seo.titles && seo.titles.seo || []).length, hasThumbnails: !!(seo.thumbnails && seo.thumbnails.length) } : null
      };
    },

    // --- change notification ---
    on(fn) { window.addEventListener('blvck-assets-changed', fn); },
    emit() { window.dispatchEvent(new CustomEvent('blvck-assets-changed')); }
  };

  window.BlvckAssets = BlvckAssets;

  // Re-emit on cross-tab storage changes and on the storyboard's own event.
  window.addEventListener('storage', () => BlvckAssets.emit());
  window.addEventListener('blvck-storyboard-updated', () => BlvckAssets.emit());
})();
