// Native Node.js Kokoro Local Server for Blvck-TTS v5.0
import http from 'http';
import { KokoroTTS } from 'kokoro-js';

const PORT = 8880;
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

console.log('⏳ Loading Kokoro 82M ONNX model (CPU mode)...');

// Initialize Kokoro TTS in Node.js with CPU execution provider
const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
  dtype: 'q8',
  device: 'cpu'  // Supported Node.js devices: "cpu" or "dml"
});

console.log('✅ Kokoro TTS Model loaded successfully!');

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  // GET /v1/models (Health check)
  if (req.url === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify({ data: [{ id: 'kokoro', object: 'model' }] }));
  }

  // POST /v1/audio/speech (OpenAI TTS Compatible endpoint)
  if (req.url === '/v1/audio/speech' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const text = payload.input || '';
        const voice = payload.voice || 'af_heart';

        console.log(`🎙️ Synthesizing ("${voice}"): "${text.slice(0, 50)}..."`);

        // Generate audio
        const audio = await tts.generate(text, { voice });
        const wavBuffer = await audio.toWav();

        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Access-Control-Allow-Origin': '*',
          'Content-Length': wavBuffer.byteLength
        });
        res.end(Buffer.from(wavBuffer));
      } catch (err) {
        console.error('❌ Kokoro Synthesis Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🚀 Kokoro Node.js Local Server running at http://localhost:${PORT}`);
});