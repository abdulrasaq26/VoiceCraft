// Episode Series Memory for Blvck-TTS v4.0
// Manages Channel -> Series -> Episodes hierarchy for cross-episode lore & continuity
(() => {
  'use strict';

  const SERIES_STORAGE_KEY = 'blvck:series_memory';

  let seriesStore = {
    activeSeriesId: 'born-back-then-main',
    series: {
      'born-back-then-main': {
        name: 'Born Back Then - Black Death Series',
        description: 'Chronicles of life during the 14th century Black Death pandemic across Europe.',
        episodes: [] // [{ id: 'ep1', title: 'The Outbreak 1347', summary: '...', characters: ['Thomas'], keyEvents: [] }]
      }
    }
  };

  function loadSeriesStore() {
    try {
      const raw = localStorage.getItem(SERIES_STORAGE_KEY);
      if (raw) {
        seriesStore = { ...seriesStore, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[SeriesMemory] Load failed:', e);
    }
  }

  function saveSeriesStore() {
    try {
      localStorage.setItem(SERIES_STORAGE_KEY, JSON.stringify(seriesStore));
    } catch (e) {
      console.warn('[SeriesMemory] Save failed:', e);
    }
  }

  loadSeriesStore();

  function getActiveSeries() {
    return seriesStore.series[seriesStore.activeSeriesId] || null;
  }

  function addEpisode(epData) {
    const active = getActiveSeries();
    if (active) {
      active.episodes.push({
        id: `ep-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...epData
      });
      saveSeriesStore();
    }
  }

  function buildSeriesContextBlock() {
    const active = getActiveSeries();
    if (!active || !active.episodes.length) return '';

    const lastEps = active.episodes.slice(-3); // Last 3 episodes for context
    const lines = [`SERIES CANON (${active.name}):`];

    lastEps.forEach((ep, idx) => {
      lines.push(`- Previous Ep ${idx + 1} ("${ep.title}"): ${ep.summary || 'N/A'}`);
      if (ep.characters && ep.characters.length) {
        lines.push(`  Recurring Characters: ${ep.characters.join(', ')}`);
      }
    });

    return lines.join('\n');
  }

  window.SeriesMemory = {
    getStore: () => seriesStore,
    getActiveSeries,
    addEpisode,
    buildSeriesContextBlock
  };
})();
