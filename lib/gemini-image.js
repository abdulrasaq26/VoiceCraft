'use strict';

require('dotenv').config();

// Server-side proxy for Google's Gemini image generation API. The API key
// stays on the server, exactly like the TTS provider. MOCK mode (MOCK_TTS=1
// or MOCK_IMAGE=1) returns a locally-generated PNG so the UI can be built and
// tested without a key or billing.

const zlib = require('zlib');

const API_KEY = process.env.GEMINI_API_KEY || '';
const MOCK = process.env.MOCK_IMAGE === '1' || process.env.MOCK_TTS === '1';
// The free-tier image model. Override via env if you use Imagen or a newer
// model (see README).
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS) || 60000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function configured() {
  return Boolean(MOCK || API_KEY);
}

function authMode() {
  if (MOCK) return 'mock';
  return API_KEY ? 'api-key' : 'unconfigured';
}

/**
 * Generate an image from a text prompt.
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
async function generateImage(prompt, { aspect } = {}) {
  const text = aspect ? `${prompt}\n\nAspect ratio: ${aspect}.` : prompt;

  if (MOCK) {
    return { buffer: mockPng(hashString(text)), mime: 'image/png' };
  }

  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts: [{ text }] }],
    // Image-output models need IMAGE among the response modalities.
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok) {
    throw httpError(response.status, data?.error?.message || `Image generation failed (${response.status})`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.map((p) => p.inlineData || p.inline_data).find((d) => d && d.data);
  if (!inline) {
    // The model replied with text but no image — usually a wrong model name
    // or a prompt the model refused.
    const textReply = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
    throw httpError(
      502,
      textReply
        ? `The model returned text instead of an image: “${textReply}”. Check GEMINI_IMAGE_MODEL supports image output.`
        : 'No image was returned. Verify GEMINI_IMAGE_MODEL is an image-generation model.'
    );
  }
  return {
    buffer: Buffer.from(inline.data, 'base64'),
    mime: inline.mimeType || inline.mime_type || 'image/png'
  };
}

// --- Mock image (a real PNG) -------------------------------------------

function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Deterministic diagonal gradient so different prompts render different
// (but repeatable) mock images.
function mockPng(seed) {
  const w = 256;
  const h = 256;
  const r0 = seed & 0xff;
  const g0 = (seed >> 8) & 0xff;
  const b0 = (seed >> 16) & 0xff;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 3 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const i = rowStart + 1 + x * 3;
      raw[i] = Math.round(r0 * (1 - t) + 255 * t) & 0xff;
      raw[i + 1] = Math.round(g0 * (1 - t) + 40 * t) & 0xff;
      raw[i + 2] = Math.round(b0 * (1 - t) + 90 * t) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { generateImage, configured, authMode, MODEL };
