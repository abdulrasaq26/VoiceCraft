// Curated ElevenLabs voice catalog.
//
// Puter cannot enumerate the ElevenLabs Voice Library at runtime (that
// endpoint is not exposed to Puter's free tier), so this file ships a
// hand-picked catalog of the most widely-known ElevenLabs "premade" voice
// IDs, augmented with the metadata the app needs to filter and describe
// them (accent, age, style tags, tier).
//
// Every entry uses a real, publicly documented ElevenLabs voice ID. If a
// specific voice isn't available on your Puter account, drop the row or
// swap the ID — the rest of the catalog keeps working.
(() => {
  'use strict';

  // Style tag glossary (kept short so the filter UI stays readable):
  //   narration      — long-form voiceover: documentaries, essays, YouTube.
  //   documentary    — measured, authoritative, "prestige TV" delivery.
  //   storytelling   — vivid, cinematic, character-aware narration.
  //   educational    — clear, patient teacher voice for how-to / lessons.
  //   character      — theatrical / persona voices for scripted dialogue.
  //   conversational — casual, everyday-podcast register.
  //   cinematic      — trailer / promo voiceover.
  //   audiobook      — sustained long-form reading, minimal energy swings.
  //   dramatic       — emotional / high-intensity delivery.
  //   asmr           — whispered / meditative delivery.

  // Tuple order: [id, name, gender, tier, accent, age, styles, descriptor]
  //   gender: 'FEMALE' | 'MALE' | 'NEUTRAL'
  //   tier:   'elite' (widely-used flagship voices)
  //         | 'premium' (solid additions to the roster)
  //         | 'standard' (character / niche voices)
  const ROWS = [
    // --- Elite (the ElevenLabs default "premade" flagship voices) ---
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
    ['jsCqWAovK2LkecY7zXl4', 'Freya',     'FEMALE', 'elite',   'American',        'young adult',   ['storytelling', 'conversational', 'character'],       'Expressive young female'],

    // --- Premium (solid additions to the roster) ---
    ['9BWtsMINqrJLrRacOk9x', 'Aria',      'FEMALE', 'premium', 'American',        'middle-aged',   ['storytelling', 'conversational', 'documentary'],     'Expressive middle-aged female'],
    ['Xb7hH8MSUJpSbSDYk0k2', 'Alice',     'FEMALE', 'premium', 'British',         'middle-aged',   ['documentary', 'narration'],                          'Confident British news voice'],
    ['oWAxZDx7w5VEj9dCyTzz', 'Grace',     'FEMALE', 'premium', 'US-Southern',     'young adult',   ['storytelling', 'audiobook'],                         'Gentle American-Southern female'],
    ['iP95p4xoKVk53GoZ742B', 'Chris',     'MALE',   'premium', 'American',        'middle-aged',   ['conversational', 'narration', 'educational'],        'Casual, everyman American male'],
    ['nPczCjzI2devNBz1zQrb', 'Brian',     'MALE',   'premium', 'American',        'middle-aged',   ['narration', 'documentary', 'audiobook'],             'Deep, resonant male voice'],
    ['LcfcDJNUP1GQjkzn1xUU', 'Emily',     'FEMALE', 'premium', 'American',        'young adult',   ['educational', 'asmr', 'narration'],                  'Calm meditation / educational voice'],
    ['MF3mGyEYCl7XYWbV9V6O', 'Elli',      'FEMALE', 'premium', 'American',        'young adult',   ['storytelling', 'dramatic', 'character'],             'Emotional young female'],
    ['pMsXgVXv3BLzUgSXRplE', 'Serena',    'FEMALE', 'premium', 'American',        'middle-aged',   ['narration', 'conversational'],                       'Pleasant American female narrator'],
    ['CwhRBWXzGAHq8TQ4Fs17', 'Roger',     'MALE',   'premium', 'American',        'middle-aged',   ['documentary', 'narration'],                          'Confident male voice'],
    ['GBv7mTt0atIp3Br8iCZE', 'Thomas',    'MALE',   'premium', 'American',        'young adult',   ['educational', 'asmr', 'narration'],                  'Calm male, meditation and lessons'],
    ['flq6f7yk4E4fJM5XTYuZ', 'Michael',   'MALE',   'premium', 'American',        'senior',        ['audiobook', 'narration', 'documentary'],             'Orotund older male, gravitas narration'],
    ['g5CIjZEefAph4nQFvHAz', 'Ethan',     'MALE',   'premium', 'American',        'young adult',   ['asmr', 'educational', 'conversational'],             'Soft young male, ASMR delivery'],
    ['FGY2WhTYpPnrIDTdsKH5', 'Laura',     'FEMALE', 'premium', 'American',        'young adult',   ['conversational', 'storytelling'],                    'Upbeat young female for social content'],
    ['piTKgcLEGmPE4e6mEKli', 'Nicole',    'FEMALE', 'premium', 'American',        'young adult',   ['asmr', 'storytelling'],                              'Whispered ASMR female voice'],
    ['29vD33N1CtxCmqQRPOHJ', 'Drew',      'MALE',   'premium', 'American',        'middle-aged',   ['narration', 'documentary'],                          'Well-rounded American male news voice'],
    ['5Q0t7uMcjvnagumLfvZi', 'Paul',      'MALE',   'premium', 'American',        'middle-aged',   ['documentary', 'narration'],                          'Ground reporter, live-news delivery'],
    ['TX3LPaxmHKxFdv7VOQHJ', 'Liam',      'MALE',   'premium', 'American',        'young adult',   ['narration', 'audiobook'],                            'Articulate young male reader'],
    ['bIHbv24MWmeRgasZH58o', 'Will',      'MALE',   'premium', 'American',        'young adult',   ['conversational', 'storytelling'],                    'Friendly young male voice'],
    ['Zlb1dXrM653N07WRdFW3', 'Joseph',    'MALE',   'premium', 'British',         'middle-aged',   ['audiobook', 'narration', 'documentary'],             'Articulate British male narrator'],
    ['yoZ06aMxZJJ28mfd3POQ', 'Sam',       'MALE',   'premium', 'American',        'young adult',   ['storytelling', 'character'],                         'Raspy young male, indie-doc feel'],

    // --- Standard (character / niche voices) ---
    ['CYw3kZ02Hs0563khs1Fj', 'Dave',      'MALE',   'standard', 'British-Essex',  'young adult',   ['conversational', 'character'],                       'Cheeky British-Essex male'],
    ['D38z5RcWu1voky8WS1ja', 'Fin',       'MALE',   'standard', 'Irish',          'senior',        ['storytelling', 'character', 'audiobook'],            'Weathered Irish sailor, storytelling'],
    ['SOYHLrjzK2X1ezoPC6cr', 'Harry',     'MALE',   'standard', 'American',       'young adult',   ['character', 'dramatic'],                             'Anxious young male, scripted drama'],
    ['ODq5zmih8GrVes37Dizd', 'Patrick',   'MALE',   'standard', 'American',       'middle-aged',   ['character', 'dramatic'],                             'Shouty male, high-intensity delivery'],
    ['2EiwWnXFnvU5JabPnv8n', 'Clyde',     'MALE',   'standard', 'American',       'middle-aged',   ['character', 'storytelling'],                         'War-veteran character voice'],
    ['ZQe5CZNOzWyzPSCn5a3c', 'James',     'MALE',   'standard', 'Australian',     'senior',        ['narration', 'audiobook'],                            'Calm older Australian narrator'],
    ['bVMeCyTHy58xNoL34h3p', 'Jeremy',    'MALE',   'standard', 'American-Irish', 'young adult',   ['storytelling', 'dramatic'],                          'Excited Irish-American male'],
    ['t0jbNlBVZ17f02VDIeMI', 'Jessie',    'MALE',   'standard', 'American',       'senior',        ['character', 'storytelling'],                         'Raspy old-timer character voice'],
    ['jBpfuIE2acCO8z3wKNLl', 'Gigi',      'FEMALE', 'standard', 'American',       'young adult',   ['character'],                                         'Childish, cartoonish female character'],
    ['z9fAnlkpzviPz146aGWa', 'Glinda',    'FEMALE', 'standard', 'American',       'middle-aged',   ['character', 'dramatic'],                             'Witchy character voice'],
    ['zcAOhNBS3c14rBihAFp1', 'Giovanni',  'MALE',   'standard', 'Italian',        'young adult',   ['character', 'storytelling'],                         'Italian-accented male character'],
    ['zrHiDhphv9ZnVXBqCLjz', 'Mimi',      'FEMALE', 'standard', 'Swedish',        'young adult',   ['character', 'storytelling'],                         'Swedish-English female character']
  ];

  const TIER_BADGE = { elite: '⭐ Elite', premium: 'Premium', standard: 'Standard' };
  const TIER_LABEL = { elite: 'Elite', premium: 'Premium', standard: 'Standard' };

  window.ELEVEN_VOICES = ROWS.map(([id, name, gender, tier, accent, age, styles, descriptor]) => ({
    id,
    name,
    descriptor,
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

  // Sorted style list for the filter chips.
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
