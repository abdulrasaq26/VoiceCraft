// Curated ElevenLabs voice catalog.
(() => {
  'use strict';

  const TIER_BADGE = { elite: '⭐ Elite', premium: 'Premium', standard: 'Standard' };
  const TIER_LABEL = { elite: 'Elite', premium: 'Premium', standard: 'Standard' };

  const ROWS = [
    // --- Elite ---
    ['21m00Tcm4TlvDq8ikWAM', 'Rachel',    'FEMALE', 'elite',   'American',        'young adult',   ['narration', 'documentary', 'audiobook'],           'Calm female narrator, ElevenLabs\' most-used voice'],
    ['pNInz6obpgDQGcFmaJgB', 'Adam',      'MALE',   'elite',   'American',        'middle-aged',   ['narration', 'documentary', 'cinematic'],           'Deep male narrator, cinematic and authoritative'],
    ['ErXwobaYiN019PkySvjV', 'Antoni',    'MALE',   'elite',   'American',        'young adult',   ['narration', 'conversational', 'audiobook'],         'Well-rounded male voice, versatile default'],
    ['EXAVITQu4vr4xnSDxMaL', 'Sarah',     'FEMALE', 'elite',   'American',        'young adult',   ['narration', 'documentary'],                          'Soft, professional female news voice'],
    ['IKne3meq5aSn9XLyUdCD', 'Charlie',   'MALE',   'elite',   'Australian',      'middle-aged',   ['narration', 'conversational', 'storytelling'],       'Natural, easy Australian male'],
    ['JBFqnCBsd6RMkjVDRZzb', 'George',    'MALE',   'elite',   'British',         'middle-aged',   ['narration', 'documentary', 'audiobook'],             'Warm British male, prestige narration'],
    ['XrExE9yKIg1WjnnlVkGX', 'Matilda',   'FEMALE', 'elite',   'American',        'middle-aged',   ['narration', 'storytelling', 'audiobook'],            'Warm, friendly female storyteller'],
    ['AZnzlk1XvdvUeBnXmlld', 'Domi',      'FEMALE', 'elite',   'American',        'young adult',   ['storytelling', 'dramatic', 'character'],             'Strong, expressive female'],
    ['TxGEqnHWrfWFTfGW9XjX', 'Josh',      'MALE',   'elite',   'American',        'young adult',   ['narration', 'cinematic', 'storytelling'],            'Deep young male voice'],
    ['VR6AewLTigWG4xSOukaG', 'Arnold',    'MALE',   'elite',   'American',        'middle-aged',   ['documentary', 'narration', 'cinematic'],             'Crisp, documentary-style male'],
    ['pqHfZKP75CvOlQylNhV4', 'Bill',      'MALE',   'elite',   'American',        'senior',        ['narration', 'documentary', 'audiobook'],             'Trustworthy older male voice'],
    ['onwK4e9ZLuTAKqWW03F9', 'Daniel',    'MALE',   'elite',   'British',         'middle-aged',   ['documentary', 'narration'],                          'British news-anchor delivery'],
    ['XB0fDUnXU5powFXDhCwa', 'Charlotte', 'FEMALE', 'elite',   'Swedish',         'young adult',   ['storytelling', 'character', 'dramatic'],             'Expressive Swedish-English female'],
    ['pFZP5JQG7iQjIQuC4Bku', 'Lily',      'FEMALE', 'elite',   'British',         'middle-aged',   ['narration', 'audiobook', 'documentary'],             'Warm British female narrator'],
    ['N2lVS1w4EtoT3dr4eOWO', 'Callum',    'MALE',   'elite',   'Transatlantic',   'middle-aged',   ['character', 'dramatic', 'cinematic'],                'Intense male, hypnotic character voice'],
    ['jsCqWAovK2LkecY7zXl4', 'Freya',     'FEMALE', 'elite',   'American',        'young adult',   ['storytelling', 'conversational', 'character'],       'Expressive young female']
  ];

  const ELEVEN_VOICES = ROWS.map(([id, name, gender, tier, accent, age, styles, descriptor]) => ({
    id,
    name,
    descriptor: descriptor || '',
    tier,
    tierLabel: TIER_LABEL[tier],
    badge: TIER_BADGE[tier],
    family: 'ElevenLabs',
    gender,
    accent,
    age,
    styles: styles.slice(),
    language: 'en-US',
    languageCodes: ['en-US']
  }));

  window.ELEVEN_VOICES = ELEVEN_VOICES;
  window.ELEVEN_STYLES = [
    'narration',
    'documentary',
    'storytelling',
    'educational',
    'character',
    'conversational',
    'cinematic',
    'audiobook',
    'dramatic',
    'asmr'
  ];
})();
