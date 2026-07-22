'use strict';

// Turns Google's technical voice list into a curated catalog: human names,
// descriptors, quality tiers, and per-family capability rules that decide
// which synthesis parameters a voice actually accepts.

const TIERS = {
  elite: { label: 'Elite', badge: '⭐ Elite', rank: 0 },
  premium: { label: 'Premium', badge: 'Premium', rank: 1 },
  standard: { label: 'Standard', badge: 'Standard', rank: 2 },
  experimental: { label: 'Experimental', badge: 'Experimental', rank: 3 }
};

const FAMILY_PATTERNS = [
  ['Chirp3-HD', /chirp3-hd/i],
  ['Chirp-HD', /chirp-hd/i],
  ['Chirp', /chirp/i],
  ['Gemini', /gemini/i],
  ['Journey', /journey/i],
  ['Studio', /studio/i],
  ['Neural2', /neural2/i],
  ['Wavenet', /wavenet/i],
  ['News', /news/i],
  ['Casual', /casual/i],
  ['Polyglot', /polyglot/i],
  ['Standard', /standard/i]
];

function familyOf(voiceId) {
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(voiceId)) return family;
  }
  return 'Other';
}

function tierOf(voiceId) {
  switch (familyOf(voiceId)) {
    case 'Chirp3-HD':
    case 'Chirp-HD':
    case 'Studio':
      return 'elite';
    case 'Neural2':
    case 'Wavenet':
      return 'premium';
    case 'Standard':
      return 'standard';
    default:
      return 'experimental';
  }
}

// Which synthesis parameters each family accepts. Sending an unsupported
// parameter makes the Google API reject the whole request with HTTP 400,
// which is how voices end up looking "broken".
function capabilitiesFor(voiceId) {
  const family = familyOf(voiceId);
  if (['Chirp3-HD', 'Chirp-HD', 'Chirp', 'Journey', 'Gemini', 'Other'].includes(family)) {
    return { rate: false, pitch: false, ssml: false };
  }
  if (family === 'Studio') {
    return { rate: true, pitch: false, ssml: true };
  }
  return { rate: true, pitch: true, ssml: true };
}

// Only Gemini-TTS voices accept free-text style prompts.
function promptCapable(voiceId) {
  return familyOf(voiceId) === 'Gemini';
}

// Hand-picked names for the most popular English voices. The expected
// gender is validated against the live API response; on mismatch we fall
// back to generated naming rather than mislabel a voice.
const CURATED = {
  'en-US-Neural2-A': ['MALE', 'Ethan', 'Casual Everyday Male Voice'],
  'en-US-Neural2-C': ['FEMALE', 'Sarah', 'Warm Female Narrator'],
  'en-US-Neural2-D': ['MALE', 'James', 'Deep Professional Male Voice'],
  'en-US-Neural2-E': ['FEMALE', 'Emma', 'Friendly Conversational Voice'],
  'en-US-Neural2-F': ['FEMALE', 'Olivia', 'Bright Engaging Storyteller'],
  'en-US-Neural2-G': ['FEMALE', 'Sophia', 'Calm Reassuring Voice'],
  'en-US-Neural2-H': ['FEMALE', 'Ava', 'Energetic Female Presenter'],
  'en-US-Neural2-I': ['MALE', 'Michael', 'Documentary Style Voice'],
  'en-US-Neural2-J': ['MALE', 'Daniel', 'Confident Business Voice'],
  'en-US-Studio-O': ['FEMALE', 'Isabella', 'Studio-Grade Female Narrator'],
  'en-US-Studio-Q': ['MALE', 'William', 'Studio-Grade Broadcaster'],
  'en-GB-Neural2-A': ['FEMALE', 'Charlotte', 'Elegant British Narrator'],
  'en-GB-Neural2-B': ['MALE', 'Henry', 'Refined British Voice'],
  'en-GB-Neural2-C': ['FEMALE', 'Amelia', 'Friendly British Voice'],
  'en-GB-Neural2-D': ['MALE', 'Oliver', 'Confident British Presenter'],
  'en-GB-Neural2-F': ['FEMALE', 'Grace', 'Polished British Storyteller']
};

const NAMES = {
  FEMALE: [
    'Sarah', 'Emma', 'Olivia', 'Sophia', 'Ava', 'Isabella', 'Mia', 'Charlotte',
    'Amelia', 'Harper', 'Grace', 'Chloe', 'Lily', 'Ella', 'Zoe', 'Hannah',
    'Nora', 'Ruby', 'Ivy', 'Stella', 'Naomi', 'Violet', 'Aurora', 'Hazel',
    'Luna', 'Clara', 'Alice', 'Maya', 'Elena', 'Leah', 'Julia', 'Rosa',
    'Nina', 'Iris', 'Daisy', 'Faith', 'Jade', 'Skye', 'Pearl', 'Wren'
  ],
  MALE: [
    'James', 'Michael', 'Daniel', 'Ethan', 'William', 'Henry', 'Alexander',
    'Benjamin', 'Lucas', 'Noah', 'Oliver', 'Samuel', 'David', 'Joseph',
    'Owen', 'Leo', 'Jack', 'Ryan', 'Nathan', 'Adam', 'Aaron', 'Marcus',
    'Felix', 'Hugo', 'Theo', 'Miles', 'Jasper', 'Silas', 'Victor', 'Oscar',
    'Elliot', 'Grant', 'Reid', 'Cole', 'Blake', 'Wade', 'Dean', 'Seth',
    'Rhys', 'Finn'
  ],
  NEUTRAL: [
    'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn',
    'Rowan', 'Sage', 'Emery', 'Kai', 'Remy', 'Shay', 'Ariel', 'Devon'
  ]
};

const ADJECTIVES = [
  'Warm', 'Bright', 'Calm', 'Confident', 'Smooth', 'Clear', 'Rich',
  'Gentle', 'Bold', 'Crisp', 'Steady', 'Velvety'
];

const ROLES = {
  elite: ['Cinematic Narrator', 'Studio Narrator', 'Lifelike Storyteller', 'Podcast Host', 'Audiobook Narrator'],
  premium: ['Narrator', 'Presenter', 'Conversational Voice', 'Storyteller', 'News Voice', 'Business Voice'],
  standard: ['Everyday Voice', 'Reader', 'Announcer', 'Assistant Voice'],
  experimental: ['Character Voice', 'Specialty Voice', 'Broadcast Voice']
};

// FNV-1a: stable across runs so a voice always gets the same human name.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function genderWord(gender) {
  if (gender === 'FEMALE') return 'Female';
  if (gender === 'MALE') return 'Male';
  return '';
}

function pick(list, seed) {
  return list[seed % list.length];
}

function generatedName(voiceId, gender, usedInLanguage) {
  const pool = NAMES[gender] || NAMES.NEUTRAL;
  const start = hash(voiceId) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length];
    if (!usedInLanguage.has(candidate)) return candidate;
  }
  // Pool exhausted for this language: disambiguate with the voice suffix.
  const suffix = voiceId.split('-').pop();
  return `${pool[start]} ${suffix}`;
}

function generatedDescriptor(voiceId, gender, tier) {
  const seed = hash(`${voiceId}:desc`);
  const adj = pick(ADJECTIVES, seed);
  const role = pick(ROLES[tier] || ROLES.experimental, seed >>> 8);
  return [adj, genderWord(gender), role].filter(Boolean).join(' ');
}

/**
 * Enrich the raw Google listVoices output.
 * - Dedupes by technical voice name
 * - Assigns stable human names (unique per language) and descriptors
 * - Attaches tier, badge, and capability metadata
 */
function enrichVoices(rawVoices) {
  const seen = new Set();
  const deduped = [];
  for (const voice of rawVoices) {
    if (!voice || !voice.name || seen.has(voice.name)) continue;
    seen.add(voice.name);
    deduped.push(voice);
  }
  // Deterministic processing order keeps generated names stable even if
  // Google returns the list in a different order between calls.
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  const usedByLanguage = new Map();
  const enriched = deduped.map((voice) => {
    const id = voice.name;
    const language = (voice.languageCodes && voice.languageCodes[0]) || 'und';
    const gender = voice.ssmlGender || 'SSML_VOICE_GENDER_UNSPECIFIED';
    const tier = tierOf(id);

    if (!usedByLanguage.has(language)) usedByLanguage.set(language, new Set());
    const used = usedByLanguage.get(language);

    let name;
    let descriptor;
    const curated = CURATED[id];
    if (curated && curated[0] === gender) {
      [, name, descriptor] = curated;
    } else {
      name = generatedName(id, gender, used);
      descriptor = generatedDescriptor(id, gender, tier);
    }
    used.add(name);

    return {
      id,
      name,
      descriptor,
      tier,
      tierLabel: TIERS[tier].label,
      badge: TIERS[tier].badge,
      family: familyOf(id),
      gender,
      language,
      languageCodes: voice.languageCodes || [language],
      sampleRateHertz: voice.naturalSampleRateHertz,
      capabilities: capabilitiesFor(id),
      promptCapable: promptCapable(id)
    };
  });

  enriched.sort((a, b) => {
    const rank = TIERS[a.tier].rank - TIERS[b.tier].rank;
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });
  return enriched;
}

module.exports = { enrichVoices, capabilitiesFor, promptCapable, familyOf, tierOf, TIERS };
