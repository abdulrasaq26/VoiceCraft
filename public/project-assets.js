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
    research: 'blvck-tts:research',
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

    // The research brief for this project (topic facts, angles, keywords).
    research() { const r = read(K.research); return (r && r.brief) || null; },
    researchTopic() { const r = read(K.research); return (r && r.topic) || ''; },

    // Per-stage completion for the pipeline tracker.
    status() {
      const scenes = this.scenes();
      return {
        research: !!this.research(),
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
      const research = this.research();
      return {
        title: this.title(),
        channel: channel || null,
        channelBrain: window.BlvckBrain ? window.BlvckBrain.snapshot() : null,
        research: research ? { summary: clip(research.summary, 500), angles: (research.angles || []).slice(0, 6), keyFactCount: (research.keyFacts || []).length, keywords: research.keywords } : null,
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

  async function renderAssetLibrary() {
    const container = document.getElementById('asset-library-content');
    if (!container) return;

    const script = BlvckAssets.script();
    const research = BlvckAssets.research();
    const scenes = BlvckAssets.scenes();
    const seo = BlvckAssets.seo();
    const hasAudio = BlvckAssets.hasAudio();

    if (!script && !research && !scenes.length && !seo && !hasAudio) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px; color:var(--text-dim, #888);">
          <div style="font-size:2.5rem; margin-bottom:10px;">📁</div>
          <p>Your generated audio, script files, storyboard images, and video renders will appear here automatically as you create them.</p>
        </div>
      `;
      return;
    }

    let html = '<div class="asset-grid" style="display:flex; flex-direction:column; gap:20px;">';

    // 1. Script & Research Section
    if (script || research) {
      html += `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:15px;">
          <h3 style="margin:0 0 10px 0; color:var(--accent, #6366f1); font-size:1.1rem; display:flex; align-items:center; gap:8px;">
            📝 Script & Research Brief
          </h3>
          ${script ? `<p style="font-size:0.9rem; line-height:1.5; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; max-height:120px; overflow-y:auto; color:#eee;">${String(script).slice(0, 500)}...</p>` : ''}
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="btn ghost small" type="button" onclick="window.AetherRouter.switchWorkspace('script')">Open Script Studio →</button>
          </div>
        </div>
      `;
    }

    // 2. Audio Narration Section
    if (hasAudio) {
      const batch = read(K.batch);
      const items = (batch && batch.items) || [];
      html += `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:15px;">
          <h3 style="margin:0 0 10px 0; color:var(--accent, #6366f1); font-size:1.1rem; display:flex; align-items:center; gap:8px;">
            🎙️ Audio Narration (${items.filter(i=>i.status==='done').length} parts)
          </h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:10px;">
      `;
      for (const item of items) {
        if (item.status === 'done') {
          html += `
            <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px;">
              <div style="font-weight:bold; font-size:0.85rem; margin-bottom:6px; color:#fff;">Part ${item.part || item.index}: ${item.text.slice(0, 45)}...</div>
              <div id="asset-audio-container-${item.index}"><span style="font-size:0.8rem; color:#888;">Loading audio...</span></div>
            </div>
          `;
        }
      }
      html += `
          </div>
        </div>
      `;
    }

    // 3. Storyboard & Scene Stills Section
    if (scenes.length) {
      const doneScenes = scenes.filter(s => s.status === 'done');
      html += `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:15px;">
          <h3 style="margin:0 0 10px 0; color:var(--accent, #6366f1); font-size:1.1rem; display:flex; align-items:center; gap:8px;">
            🎬 Storyboard Scene Stills (${doneScenes.length} rendered)
          </h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px;">
      `;
      for (const s of doneScenes) {
        html += `
          <div style="background:rgba(0,0,0,0.4); border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
            <div id="asset-img-container-${s.index}" style="width:100%; height:110px; background:#111; display:flex; align-items:center; justify-content:center;">
              <span style="font-size:0.8rem; color:#666;">Scene ${s.index}</span>
            </div>
            <div style="padding:8px; font-size:0.75rem; color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              Scene ${s.index}: ${s.subtitle || s.sceneSummary || ''}
            </div>
          </div>
        `;
      }
      html += `
          </div>
        </div>
      `;
    }

    // 4. YouTube Thumbnails Section
    const projName = BlvckAssets.title() || 'Untitled';
    const thumbsMeta = JSON.parse(localStorage.getItem('blvck-tts:thumbnails') || '[]').filter((t) => t.project === projName || !t.project);
    if (thumbsMeta.length) {
      html += `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:15px;">
          <h3 style="margin:0 0 10px 0; color:var(--accent, #6366f1); font-size:1.1rem; display:flex; align-items:center; gap:8px;">
            🖼️ YouTube Thumbnails (${thumbsMeta.length} generated)
          </h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">
      `;
      for (const t of thumbsMeta) {
        html += `
          <div style="background:rgba(0,0,0,0.4); border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
            <div id="asset-thumb-container-${t.id}" style="width:100%; aspect-ratio:16/9; background:#111; display:flex; align-items:center; justify-content:center;">
              <span style="font-size:0.8rem; color:#666;">Thumbnail #${t.id}</span>
            </div>
            <div style="padding:8px; font-size:0.75rem; color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              Thumbnail Concept #${t.id}
            </div>
          </div>
        `;
      }
      html += `
          </div>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

    // Async hydration of Audio, Scene Images, and Thumbnails from IndexedDB
    if (hasAudio) {
      const batch = read(K.batch);
      if (batch && batch.items) {
        for (const item of batch.items) {
          if (item.status === 'done') {
            const el = document.getElementById(`asset-audio-container-${item.index}`);
            if (el) {
              try {
                const req = indexedDB.open('blvck-tts');
                req.onsuccess = () => {
                  const db = req.result;
                  if (db.objectStoreNames.contains('audio')) {
                    const r2 = db.transaction('audio', 'readonly').objectStore('audio').get(`${batch.id}:${item.index}`);
                    r2.onsuccess = () => {
                      if (r2.result) {
                        const url = URL.createObjectURL(r2.result);
                        el.innerHTML = `<audio src="${url}" controls style="width:100%; height:32px;"></audio>`;
                      }
                    };
                  }
                };
              } catch (_) {}
            }
          }
        }
      }
    }

    if (scenes.length) {
      for (const s of scenes) {
        if (s.status === 'done') {
          const el = document.getElementById(`asset-img-container-${s.index}`);
          if (el) {
            try {
              const req = indexedDB.open('blvck-storyboard');
              req.onsuccess = () => {
                const db = req.result;
                if (db.objectStoreNames.contains('images')) {
                  const r2 = db.transaction('images', 'readonly').objectStore('images').get(String(s.index));
                  r2.onsuccess = () => {
                    if (r2.result) {
                      const url = URL.createObjectURL(r2.result);
                      el.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />`;
                    }
                  };
                }
              };
            } catch (_) {}
          }
        }
      }
    }

    if (thumbsMeta.length) {
      for (const t of thumbsMeta) {
        const el = document.getElementById(`asset-thumb-container-${t.id}`);
        if (el) {
          try {
            const req = indexedDB.open('blvck-thumbnails');
            req.onsuccess = () => {
              const db = req.result;
              if (db.objectStoreNames.contains('images')) {
                const r2 = db.transaction('images', 'readonly').objectStore('images').get(`${projName}:thumb-${t.id}`);
                r2.onsuccess = () => {
                  if (r2.result) {
                    const url = URL.createObjectURL(r2.result);
                    el.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />`;
                  }
                };
              }
            };
          } catch (_) {}
        }
      }
    }
  }

  window.BlvckAssets = BlvckAssets;
  BlvckAssets.renderAssetLibrary = renderAssetLibrary;

  // Re-emit on cross-tab storage changes and on the storyboard's own event.
  window.addEventListener('storage', () => { BlvckAssets.emit(); renderAssetLibrary(); });
  window.addEventListener('blvck-storyboard-updated', () => { BlvckAssets.emit(); renderAssetLibrary(); });
  window.addEventListener('blvck-assets-changed', () => renderAssetLibrary());
  document.addEventListener('DOMContentLoaded', () => renderAssetLibrary());
})();
