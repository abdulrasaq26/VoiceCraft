#!/usr/bin/env node
'use strict';

// Audits every voice in the Google Cloud TTS catalog by synthesizing a
// tiny sample with each one. Voices that fail are written to
// voice-blocklist.json, which the server loads at startup to hide them.
//
// Usage: npm run verify-voices   (requires configured credentials)
// Cost: ~3 characters per voice — negligible even across the full catalog.

const fs = require('fs');
const path = require('path');
const tts = require('../lib/google-tts');

const CONCURRENCY = 4;
const BLOCKLIST_PATH = path.join(__dirname, '..', 'voice-blocklist.json');

async function main() {
  if (!tts.credentialsConfigured()) {
    console.error('No credentials configured. Set GOOGLE_TTS_API_KEY or GOOGLE_APPLICATION_CREDENTIALS first.');
    process.exit(1);
  }

  console.log('Fetching voice catalog…');
  const raw = await tts.listVoices();
  const seen = new Set();
  const voices = raw.filter((v) => {
    if (!v.name || seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
  console.log(`Verifying ${voices.length} voices (concurrency ${CONCURRENCY})…`);

  const failures = [];
  let done = 0;
  const queue = [...voices];

  async function worker() {
    while (queue.length) {
      const voice = queue.shift();
      const languageCode = (voice.languageCodes && voice.languageCodes[0]) || 'en-US';
      try {
        await tts.synthesize({
          input: { text: 'Hi.' },
          voice: { name: voice.name, languageCode },
          audioConfig: { audioEncoding: 'MP3' }
        });
      } catch (err) {
        failures.push({ name: voice.name, error: err.message });
      }
      done++;
      if (done % 50 === 0 || done === voices.length) {
        process.stdout.write(`\r${done}/${voices.length} checked, ${failures.length} failing`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('');

  if (failures.length) {
    fs.writeFileSync(BLOCKLIST_PATH, JSON.stringify(failures.map((f) => f.name), null, 2) + '\n');
    console.log(`\n${failures.length} voice(s) failed and were written to voice-blocklist.json:`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    console.log('\nRestart the server to apply the blocklist.');
  } else {
    if (fs.existsSync(BLOCKLIST_PATH)) fs.unlinkSync(BLOCKLIST_PATH);
    console.log('\nAll voices verified OK. Blocklist cleared.');
  }
}

main().catch((err) => {
  console.error('verify-voices failed:', err.message);
  process.exit(1);
});
