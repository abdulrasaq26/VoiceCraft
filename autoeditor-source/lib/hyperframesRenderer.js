const getBase = () => {
  return process.env.NEXT_PUBLIC_RENDERER_URL || "/api/auto-editor";
};

let _job = null; // { jobId, pollTimer }

async function awaitJobBlob(jobId, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let netFails = 0;
    
    const cleanup = () => {
      if (_job && _job.pollTimer) clearInterval(_job.pollTimer);
      _job = null;
    };
    
    const succeed = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      
      try {
        const fileRes = await fetch(`${getBase()}/render/${jobId}/file`, {
          headers: { 
            "ngrok-skip-browser-warning": "1"
          }
        });
        if (!fileRes.ok) throw new Error("Could not download the finished MP4");
        const blob = await fileRes.blob();
        resolve(blob);
      } catch (e) {
        reject(e);
      }
    };
    
    const failWith = (msg) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };

    const pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const r = await fetch(`${getBase()}/render/${jobId}`, {
           headers: { 
             "ngrok-skip-browser-warning": "1"
           }
        });
        if (!r.ok) throw new Error("bad status");
        
        const job = await r.json();
        netFails = 0;
        
        if (job) {
          if (onProgress && job.progress != null) onProgress(job.progress / 100);
          if (job.status === "completed" || job.status === "done") return succeed();
          if (job.status === "failed" || job.status === "error") return failWith(job.error || "Render failed on AWS Lambda");
        }
      } catch (e) {
        netFails++;
        if (netFails >= 150) failWith("Lost connection to VoiceCraft server"); // ~12 min unreachable (5000ms * 150)
      }
    }, 5000); // Poll every 5s for completion

    _job = { jobId, pollTimer };
  });
}

export async function renderVideoHyperframes(opts) {
  if (!getBase()) throw new Error("Renderer URL is not set (Settings → API Endpoint)");

  const {
    clips, imagesByName, videosByName = {}, audioFile, width, height, fps = 30,
    transitions, transitionDuration = 0.4, motions, motionAmount = 0.08,
    trims, volumes, speeds,
    fadeIn = 0, fadeOut = 0,
    captions = null, trimEnd,
    captionStyle = "word-reveal",
    lowerThird = null,
    onProgress,
  } = opts;

  if (_job) throw new Error("A render is already in progress.");

  const totalDuration = trimEnd || (clips.length > 0
    ? (clips[clips.length - 1].start + clips[clips.length - 1].duration)
    : 10);

  // ---- Build Composition JSON v2 ----
  const spec = {
    schemaVersion: 2,
    project: { width, height, fps, duration: totalDuration },
    assets: [],
    layers: [],
    audio: [],
  };

  // Audio asset
  if (audioFile) {
    spec.assets.push({ id: "audio_main", type: "audio", filename: audioFile.name });
    spec.audio.push({ assetId: "audio_main", start: 0, volume: 1.0 });
  }

  // Helper: resolve a motion preset name → keyframe animation array
  function buildMotionAnimations(motionName, duration, amount) {
    const amt = amount || 0.08;
    const MOTION_MAP = {
      "zoomin":            [{ property: "scale", keyframes: [{ time: 0, value: 1 }, { time: duration, value: 1 + amt }], easing: "power1.inOut" }],
      "zoomout":           [{ property: "scale", keyframes: [{ time: 0, value: 1 + amt }, { time: duration, value: 1 }], easing: "power1.inOut" }],
      "pan-left":          [{ property: "x", keyframes: [{ time: 0, value: 0 }, { time: duration, value: -60 }], easing: "power1.inOut" }],
      "pan-right":         [{ property: "x", keyframes: [{ time: 0, value: 0 }, { time: duration, value: 60 }], easing: "power1.inOut" }],
      "zoom-in-pan-right": [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: duration, value: 1 + amt }], easing: "power1.inOut" },
        { property: "x",     keyframes: [{ time: 0, value: 0 }, { time: duration, value: 50 }],     easing: "power1.inOut" },
      ],
      "zoom-in-pan-left": [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: duration, value: 1 + amt }], easing: "power1.inOut" },
        { property: "x",     keyframes: [{ time: 0, value: 0 }, { time: duration, value: -50 }],    easing: "power1.inOut" },
      ],
      "dramatic-push":     [{ property: "scale", keyframes: [{ time: 0, value: 1 }, { time: duration, value: 1 + amt * 2 }], easing: "power3.in" }],
      "parallax":          [{ property: "y", keyframes: [{ time: 0, value: 0 }, { time: duration, value: -30 }], easing: "none" }],
    };
    return MOTION_MAP[motionName] || [];
  }

  // ---- Visual layers (one per non-gap clip) ----
  let prevClipIndex = -1;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.gap) continue;

    const file = imagesByName[c.name] || videosByName[c.name];
    if (!file) continue;

    const assetId = `asset_${c.name}`;
    if (!spec.assets.find(a => a.id === assetId)) {
      const isVideo = !!videosByName[c.name];
      spec.assets.push({ id: assetId, type: isVideo ? "video" : "image", filename: file.name });
    }

    let animations = [];
    let effects = [];
    let transitionIn = null;
    let transitionOut = null;

    const ai = opts.aiMotion ? opts.aiMotion[c.name] : null;

    if (ai) {
      // AI Motion Override (Support both nested 'motion' object and flat clip object)
      const motionObj = ai.motion || ai;
      if (motionObj.keyframes) {
        const propsMap = {};
        motionObj.keyframes.forEach(kf => {
          // Some AIs emit 't' (0..1), others emit 'time' (raw seconds). Handle both.
          let timeSec = 0;
          if (kf.t !== undefined) {
              timeSec = kf.t * c.duration;
          } else if (kf.time !== undefined) {
              // If it's larger than 1, it's probably absolute seconds. If it's <= 1, it might be normalized or just a short clip.
              // The AI outputted { "time": 17.0, ... } so it's absolute seconds.
              timeSec = kf.time; 
          }
          
          // The AI might nest properties in kf.properties, or flatten them in kf.
          const props = kf.properties || kf;
          for (const p in props) {
            if (p === "t" || p === "time" || p === "properties" || p === "easing") continue;
            if (!propsMap[p]) propsMap[p] = { property: p, keyframes: [], easing: motionObj.easing || "power2.inOut" };
            propsMap[p].keyframes.push({ time: timeSec, value: props[p] });
          }
        });
        animations = Object.values(propsMap);
      }
      
      effects = ai.effects || [];
      transitionIn = ai.transitionIn || ai.transition || null; // Support flat 'transition' key
      transitionOut = ai.transitionOut || null;

      // Ensure transition duration is absolute, defaulting to opts if missing but type exists
      if (transitionIn && !transitionIn.duration) transitionIn.duration = transitionDuration;
      if (transitionOut && !transitionOut.duration) transitionOut.duration = transitionDuration;

    } else {
      // Standard UI behavior
      const motionName = (motions && motions[c.name]) ? motions[c.name] : "none";
      animations = buildMotionAnimations(motionName, c.duration, motionAmount);

      const transType = transitions ? (transitions[c.name] || null) : null;
      if (prevClipIndex >= 0 && transType && transType !== "cut") {
        transitionIn = { type: transType, duration: transitionDuration };
      } else if (i === 0 && fadeIn > 0) {
        transitionIn = { type: "fade", duration: fadeIn };
      }

      if (i === clips.length - 1 && fadeOut > 0) {
        transitionOut = { type: "fade", duration: fadeOut };
      }
    }

    spec.layers.push({
      id:           `layer_${i}`,
      type:         "visual",
      assetId,
      start:        c.start,
      duration:     c.duration,
      zIndex:       i,
      animations,
      effects,
      transitionIn,
      transitionOut,
    });

    // If the AI supplied textAnimations for this clip, add them as text layers
    if (ai && ai.textAnimations && Array.isArray(ai.textAnimations)) {
      ai.textAnimations.forEach((txtConfig, txtIdx) => {
        spec.layers.push({
          id:         `ai_txt_${c.name}_${txtIdx}`,
          type:       "text",
          zIndex:     100 + i + txtIdx,
          start:      c.start,
          duration:   c.duration,
          typography: {
            text:       txtConfig.text || "",
            preset:     txtConfig.preset || "word-reveal",
            size:       txtConfig.size || "xl",
            color:      txtConfig.color || "#FFFFFF",
            background: txtConfig.background || "none",
            position:   txtConfig.position || "center",
          },
          animations: [],
        });
      });
    }

    prevClipIndex = i;
  }

  // ---- Text / Caption layers ----
  if (captions && captions.length > 0) {
    captions.forEach((cap, i) => {
      const capDur = cap.end - cap.start;
      spec.layers.push({
        id:       `cap_${i}`,
        type:     "text",
        zIndex:   200 + i,
        start:    cap.start,
        duration: capDur,
        typography: {
          text:       cap.text || "",
          preset:     captionStyle || "word-reveal",
          size:       opts.captionSize || "lg",
          color:      "#FFFFFF",
          background: "none",
          position:   "bottom",
        },
        animations: [],
      });
    });
  }

  // ---- Lower-third layer ----
  if (lowerThird) {
    spec.layers.push({
      id:       "lower_third_0",
      type:     "lower-third",
      zIndex:   150,
      preset:   lowerThird.preset || "modern",
      start:    lowerThird.start || 0,
      duration: lowerThird.duration || 5,
      data:     lowerThird.data || {},
      transitionIn:  { type: lowerThird.transitionIn  || "slide-right", duration: 0.5 },
      transitionOut: { type: lowerThird.transitionOut || "slide-left",  duration: 0.4 },
      animations: [],
    });
  }

  // ---- AI Freeform Overlays ----
  if (opts.aiOverlays && Array.isArray(opts.aiOverlays)) {
    opts.aiOverlays.forEach((ol, idx) => {
      spec.layers.push({
        ...ol,
        id: ol.id || `ai_overlay_${idx}`,
        zIndex: ol.zIndex !== undefined ? ol.zIndex : (500 + idx)
      });
    });
  }

  const fd = new FormData();
  fd.append("spec", JSON.stringify(spec));
  if (opts.aws) fd.append("aws", JSON.stringify(opts.aws));
  if (audioFile) fd.append("audio_main", audioFile, audioFile.name);
  
  for (const [name, file] of Object.entries(imagesByName)) fd.append(`asset_${name}`, file, file.name);
  for (const [name, file] of Object.entries(videosByName)) fd.append(`asset_${name}`, file, file.name);

  let res;
  try {
    res = await fetch(`${getBase()}/render-hyperframes`, { 
        method: "POST", 
        body: fd,
        headers: { 
          "ngrok-skip-browser-warning": "1"
        }
    });
  } catch (e) {
    throw new Error(`AutoEditor server not reachable: ${e.message}`);
  }

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Render request failed (${res.status})`);
  }
  
  const { jobId } = await res.json();
  return await awaitJobBlob(jobId, onProgress);
}

export function cancelHyperframesRender() {
  if (!_job) return;
  clearInterval(_job.pollTimer);
  _job = null;
  // V10 doesn't have a /cancel endpoint yet, so we just stop polling on the client side
}
