// Image Provider Adapters for Blvck-TTS v5.0
// Supports Fal.ai, Replicate, Cloudflare, BFL, and ComfyUI Local
(() => {
  'use strict';

  // Fal.ai FLUX Adapter
  async function falGenerateImage({ prompt, model = 'fal-ai/flux/dev', aspect_ratio = '16:9' }) {
    const key = window.ProviderManager.getActiveKey('fal');
    if (!key) throw new Error('Fal.ai key not configured.');

    const res = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_size: aspect_ratio === '16:9' ? 'landscape_16_9' : 'square_hd'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      window.ProviderManager.handleKeyError('fal', `HTTP ${res.status}: ${err}`);
      throw new Error(`Fal.ai Error (${res.status}): ${err}`);
    }

    const json = await res.json();
    const images = json.images || [];
    return images.map(img => img.url);
  }

  // Replicate FLUX Adapter
  async function replicateGenerateImage({ prompt, aspect_ratio = '16:9' }) {
    const key = window.ProviderManager.getActiveKey('replicate');
    if (!key) throw new Error('Replicate key not configured.');

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'black-forest-labs/flux-schnell',
        input: { prompt, aspect_ratio }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      window.ProviderManager.handleKeyError('replicate', `HTTP ${res.status}: ${err}`);
      throw new Error(`Replicate Error (${res.status}): ${err}`);
    }

    const json = await res.json();
    return json.output || [];
  }

  // OpenAI Image Generator Adapter (DALL-E 3 & ChatGPT gpt-image-2 via local proxy or direct API)
  async function openaiGenerateImage({ prompt, model, aspect_ratio = '16:9', quality = 'standard' }) {
    const PM = window.ProviderManager;
    const key = PM ? PM.getActiveKey('openai') : '';
    const oaEndpoint = (PM && PM.getPoolState('openai_oauth')?.endpoint) || 'http://127.0.0.1:10531/v1';

    // Map aspect ratios to OpenAI supported resolutions
    let size = '1024x1024';
    if (aspect_ratio === '16:9') size = '1792x1024';
    else if (aspect_ratio === '9:16') size = '1024x1792';

    // If using OAuth proxy (no direct API key), default to 'gpt-image-2'
    let targetModel = model || (key ? 'dall-e-3' : 'gpt-image-2');

    const makeReq = async (m) => {
      const body = { model: m, prompt, n: 1, size };
      if (m.startsWith('dall-e')) body.quality = quality;
      return await fetch('/api/proxy/openai-oauth/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openai-oauth-endpoint': oaEndpoint
        },
        body: JSON.stringify(body)
      }).catch(() => null);
    };

    let res = null;
    // 1. Try local OpenAI OAuth proxy first
    res = await makeReq(targetModel);
    if ((!res || !res.ok) && targetModel !== 'gpt-image-2') {
      res = await makeReq('gpt-image-2');
    }

    // 2. Direct OpenAI API key fallback if provided
    if ((!res || !res.ok) && key) {
      const body = { model: model || 'dall-e-3', prompt, n: 1, size, quality };
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }).catch(() => null);
    }

    if (!res || !res.ok) {
      const err = res ? await res.text() : 'Network error';
      throw new Error(`OpenAI Image Generation Error: ${err}\n\nMake sure "npx openai-oauth" is running or set your OpenAI API key in AI Settings.`);
    }

    const json = await res.json();
    const data = json.data || [];
    if (!data.length) throw new Error('No images returned by OpenAI backend.');

    return data.map(item => item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''));
  }

  // Cloudflare Worker AI Image Generator Adapter
  async function cloudflareWorkerGenerateImage({ prompt }) {
    const PM = window.ProviderManager;
    let endpoint = (PM && PM.getPoolState('cloudflare_worker')?.endpoint) || localStorage.getItem('blvck:cf_worker_endpoint') || '';
    let apiKey = (PM && PM.getPoolState('cloudflare_worker')?.key) || localStorage.getItem('blvck:cf_worker_key') || '';

    if (!endpoint) {
      throw new Error('Cloudflare Worker AI endpoint URL is not configured. Please set it in AI Settings.');
    }

    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost:3000';
    const proxyEndpoint = `${origin}/api/proxy/cf-worker`;

    const headers = {
      'Content-Type': 'application/json',
      'x-cf-worker-endpoint': endpoint.trim()
    };
    if (apiKey) {
      headers['x-cf-worker-key'] = apiKey.trim();
    }

    let res;
    try {
      res = await fetch(proxyEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt })
      });
    } catch (proxyErr) {
      console.warn('[Cloudflare Worker] Local proxy fetch failed, trying direct:', proxyErr);
      const directHeaders = { 'Content-Type': 'application/json' };
      if (apiKey) directHeaders['Authorization'] = `Bearer ${apiKey.trim()}`;
      res = await fetch(endpoint.trim(), {
        method: 'POST',
        headers: directHeaders,
        body: JSON.stringify({ prompt })
      });
    }

    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        throw new Error('Cloudflare Worker Error 401 (Unauthorized): Make sure the API Key set in AI Settings under "🔐 Cloudflare Worker API Key" matches your secret API_KEY in your Cloudflare Worker env.');
      }
      throw new Error(`Cloudflare Worker AI Error (${res.status}): ${err}`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    
    // 1. Handle JSON response (e.g. { image: "data:image/png;base64,...", status: true })
    if (contentType.includes('application/json')) {
      const json = await res.json();
      const imgData = json.image || json.result || json.url || json.data || (json.choices && json.choices[0]);
      if (typeof imgData === 'string') {
        if (imgData.startsWith('data:image')) {
          const r = await fetch(imgData);
          return await r.blob();
        } else if (imgData.startsWith('http')) {
          const r = await fetch(imgData);
          return await r.blob();
        } else {
          // Assume raw base64 string
          const r = await fetch(`data:image/jpeg;base64,${imgData}`);
          return await r.blob();
        }
      }
    }

    // 2. Handle HTML error fallback
    if (contentType.includes('text/html')) {
      const htmlText = await res.text();
      if (htmlText.includes('<!DOCTYPE html')) {
        throw new Error('Received web page (HTML) instead of image. Please make sure the local Node server is restarted and your Cloudflare Worker URL is correct.');
      }
    }

    // 3. Binary Image Blob (image/jpeg, image/png)
    const blob = await res.blob();
    return blob;
  }

  // Pollinations.ai FLUX / SD Adapter via server proxy (Bypasses Turnstile & CORS)
  async function pollinationsGenerateImage({ prompt, aspect_ratio = '16:9', model = 'flux', seed = null }) {
    let width = 1280;
    let height = 720;

    if (aspect_ratio === '1:1') { width = 1024; height = 1024; }
    else if (aspect_ratio === '9:16') { width = 720; height = 1280; }
    else if (aspect_ratio === '4:3') { width = 1024; height = 768; }
    else if (aspect_ratio === '3:4') { width = 768; height = 1024; }

    // The seed is what holds a storyboard together: one seed family plus one
    // style string keeps scenes recognisably part of the same video.
    const res = await fetch('/api/proxy/pollinations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, width, height, model, seed })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Pollinations.ai Error (${res.status}): ${err}`);
    }

    return await res.blob();
  }

  window.ImageAdapters = {
    pollinationsGenerateImage,
    falGenerateImage,
    replicateGenerateImage,
    openaiGenerateImage,
    cloudflareWorkerGenerateImage
  };
})();
