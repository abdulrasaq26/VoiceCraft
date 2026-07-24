// Channel Brain — cross-project memory that turns the app from a tool into a
// system. It learns this channel's preferred style/voice/tone from past
// projects, and which title themes actually perform from logged results, then
// biases every future generation (script + SEO) and informs the Director.
//
// It is GLOBAL and cross-project — deliberately NOT part of a project's working
// set, so it survives project resets and accumulates over a whole channel.
//
// window.BlvckBrain
//   learnCurrent()          fold the current project's choices into memory
//   logPerformance(entry)   record a published video's stats
//   preferences()           learned style/voice/tone (with counts)
//   insights()              what performs, derived from logged results
//   promptBlock()           a CHANNEL MEMORY block for generation prompts
//   snapshot()              compact memory for the Director
(() => {
  'use strict';

  const LS_KEY = 'blvck-tts:brain';

  function read() { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  function write(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* quota */ } }
  function readLS(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }

  function current() {
    const b = read() || {};
    return {
      channel: b.channel || '',
      projects: b.projects || {},
      performance: Array.isArray(b.performance) ? b.performance : []
    };
  }

  function channelName() { const c = readLS('blvck-tts:channel'); return (c && c.name) || ''; }
  const A = () => window.BlvckAssets;

  // Most frequent non-empty value across an array.
  function mode(values) {
    const counts = new Map();
    values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let best = '', n = 0;
    counts.forEach((c, v) => { if (c > n) { n = c; best = v; } });
    return { value: best, count: n };
  }

  function firstSentence(s) {
    const m = String(s || '').trim().match(/^.{10,140}?[.!?]/);
    return m ? m[0] : String(s || '').trim().slice(0, 120);
  }

  // Build a digest of the current project's creative choices.
  function currentDigest() {
    const assets = A();
    const opts = (assets && assets.scriptOptions()) || {};
    const voice = (assets && assets.voiceSettings()) || {};
    const seo = (assets && assets.seo()) || null;
    const bible = (assets && assets.bible()) || null;
    const script = (assets && assets.script()) || '';
    const style = (localStorage.getItem('blvck-tts:sb-style') || '').trim() || (bible && bible.visualStyle) || '';
    let thumb = '';
    if (seo && seo.thumbnails && seo.thumbnails.length) {
      const rec = seo.thumbnails.find((t) => t.version === seo.recommendedThumbnail) || seo.thumbnails[0];
      thumb = (rec && rec.text) || '';
    }
    return {
      title: (assets && assets.title()) || '',
      visualStyle: style,
      voiceId: voice.voiceId || '',
      tone: opts.tone || '',
      scriptType: opts.type || '',
      thumbnailText: thumb,
      hook: firstSentence(script),
      topic: (assets && assets.researchTopic && assets.researchTopic()) || (assets && assets.title()) || '',
      at: Date.now()
    };
  }

  // Is there enough in the current project to be worth remembering?
  function digestIsMeaningful(d) {
    return !!(d && (d.visualStyle || d.voiceId || d.tone || d.hook));
  }

  const api = {
    get: current,

    // Fold the current project's choices into memory, keyed by project title so
    // editing the same project updates its entry instead of duplicating it.
    learnCurrent() {
      const d = currentDigest();
      if (!digestIsMeaningful(d)) return null;
      const b = current();
      b.channel = channelName() || b.channel;
      const key = (d.title || 'untitled').toLowerCase();
      b.projects[key] = d;
      write(b);
      emit();
      return d;
    },

    logPerformance(entry) {
      const e = entry || {};
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const rec = {
        title: String(e.title || '').trim(),
        theme: String(e.theme || '').trim().toLowerCase(),
        views: num(e.views),
        ctr: num(e.ctr),
        retention: num(e.retention),
        at: Date.now()
      };
      if (!rec.title && rec.ctr == null && rec.views == null) return null;
      const b = current();
      b.channel = channelName() || b.channel;
      b.performance.push(rec);
      write(b);
      emit();
      return rec;
    },

    deletePerformance(index) {
      const b = current();
      if (index >= 0 && index < b.performance.length) { b.performance.splice(index, 1); write(b); emit(); }
    },

    // Learned defaults across projects.
    preferences() {
      const projects = Object.values(current().projects);
      const field = (f) => mode(projects.map((p) => p[f]));
      return {
        projectCount: projects.length,
        visualStyle: field('visualStyle'),
        voiceId: field('voiceId'),
        tone: field('tone'),
        scriptType: field('scriptType')
      };
    },

    // What performs, derived from logged results.
    insights() {
      const perf = current().performance;
      if (!perf.length) return { count: 0, themes: [], headline: '' };
      const round = (n) => Math.round(n * 10) / 10;
      const groups = new Map();
      perf.forEach((p) => {
        const key = p.theme || 'general';
        if (!groups.has(key)) groups.set(key, { theme: key, ctr: [], ret: [], views: [], n: 0 });
        const g = groups.get(key);
        g.n++;
        if (p.ctr != null) g.ctr.push(p.ctr);
        if (p.retention != null) g.ret.push(p.retention);
        if (p.views != null) g.views.push(p.views);
      });
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const themes = [...groups.values()].map((g) => ({
        theme: g.theme, n: g.n,
        avgCtr: g.ctr.length ? round(avg(g.ctr)) : null,
        avgRet: g.ret.length ? round(avg(g.ret)) : null,
        avgViews: g.views.length ? Math.round(avg(g.views)) : null
      })).sort((a, b) => (b.avgCtr || 0) - (a.avgCtr || 0));

      const withCtr = themes.filter((t) => t.avgCtr != null && t.theme !== 'general');
      let headline = '';
      if (withCtr.length >= 2 && withCtr[0].avgCtr > withCtr[withCtr.length - 1].avgCtr) {
        const best = withCtr[0], worst = withCtr[withCtr.length - 1];
        headline = `“${best.theme}” titles outperform “${worst.theme}” — avg CTR ${best.avgCtr}% vs ${worst.avgCtr}%.`;
      } else if (withCtr.length === 1) {
        headline = `“${withCtr[0].theme}” titles average ${withCtr[0].avgCtr}% CTR.`;
      }
      const allCtr = perf.map((p) => p.ctr).filter((v) => v != null);
      const allRet = perf.map((p) => p.retention).filter((v) => v != null);
      return {
        count: perf.length,
        themes,
        headline,
        avgCtr: allCtr.length ? round(avg(allCtr)) : null,
        avgRet: allRet.length ? round(avg(allRet)) : null
      };
    },

    // A compact CHANNEL MEMORY block to bias generation prompts.
    promptBlock() {
      const p = this.preferences();
      const i = this.insights();
      const lines = [];
      const name = channelName() || current().channel;
      if (name) lines.push(`Channel: ${name}.`);
      if (p.tone.value) lines.push(`Preferred tone: ${p.tone.value}.`);
      if (p.visualStyle.value) lines.push(`Preferred visual style: ${p.visualStyle.value}.`);
      if (p.voiceId.value) lines.push(`Preferred narration voice: ${p.voiceId.value}.`);
      if (i.headline) lines.push(`What performs: ${i.headline}`);
      if (i.count && i.avgCtr != null) lines.push(`Across ${i.count} logged video(s): avg CTR ${i.avgCtr}%${i.avgRet != null ? `, retention ${i.avgRet}%` : ''}.`);
      if (!lines.length) return '';
      return 'CHANNEL MEMORY (bias toward what has worked for this channel; do not contradict the brief):\n- ' + lines.join('\n- ');
    },

    snapshot() {
      const p = this.preferences();
      const i = this.insights();
      if (!p.projectCount && !i.count) return null;
      return {
        channel: channelName() || current().channel,
        learnedFromProjects: p.projectCount,
        preferred: { visualStyle: p.visualStyle.value, voiceId: p.voiceId.value, tone: p.tone.value, scriptType: p.scriptType.value },
        performance: { logged: i.count, avgCtr: i.avgCtr, avgRet: i.avgRet, headline: i.headline, topThemes: i.themes.slice(0, 3) }
      };
    },

    on(fn) { window.addEventListener('blvck-brain-changed', fn); },
  };

  function emit() {
    window.dispatchEvent(new CustomEvent('blvck-brain-changed'));
    if (window.BlvckAssets) { try { window.BlvckAssets.emit(); } catch { /* ignore */ } }
  }

  window.BlvckBrain = api;
})();
