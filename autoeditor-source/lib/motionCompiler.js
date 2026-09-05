/**
 * Deterministic Motion Compiler for motion-v3
 * 
 * Takes high-level AI directives (e.g., sceneRole, motionIntensity) and 
 * resolves them into raw, exact keyframes and layer definitions for HyperFrames.
 */

function generateCameraAnimations(camera, intensity, durationSec) {
  if (camera && camera.keyframes && camera.keyframes.length > 0) {
    const propsMap = {};
    camera.keyframes.forEach(kf => {
      let timeSec = kf.time !== undefined ? kf.time : (kf.t !== undefined ? kf.t * durationSec : 0);
      for (const p in kf) {
        if (p === "t" || p === "time" || p === "easing") continue;
        if (!propsMap[p]) propsMap[p] = { property: p, keyframes: [], easing: camera.easing || "power2.inOut" };
        propsMap[p].keyframes.push({ time: timeSec, value: kf[p] });
      }
    });
    return Object.values(propsMap);
  }

  // Fallback / Auto-generate based on intensity if no keyframes provided
  const amt = 0.02 * (intensity || 2); 
  if (amt === 0) return [];

  // Default gentle cinematic push
  return [
    { 
      property: "scale", 
      keyframes: [{ time: 0, value: 1 }, { time: durationSec, value: 1 + amt }], 
      easing: "power1.inOut" 
    }
  ];
}

export function compileV3Clip(v3Clip, clipContext, projectConfig) {
  const duration = clipContext.duration;
  
  // 1. Camera / Base Motion
  const animations = generateCameraAnimations(v3Clip.camera, v3Clip.motionIntensity, duration);

  // 2. Effects
  const effects = Array.isArray(v3Clip.effects) ? v3Clip.effects : [];
  
  // 3. Transitions
  const transitionIn = v3Clip.transitionIn || null;
  const transitionOut = v3Clip.transitionOut || null;

  // 4. Typography Layers (Sub-layers anchored to this clip)
  const typographyLayers = [];
  if (v3Clip.typography && Array.isArray(v3Clip.typography)) {
    v3Clip.typography.forEach((typo, idx) => {
      typographyLayers.push({
        id: `ai_typo_${clipContext.name}_${idx}`,
        type: "text",
        start: clipContext.start + (typo.start || 0),
        duration: typo.duration || duration,
        typography: {
          text: typo.text || "",
          preset: typo.preset || "fade-up",
          size: typo.size || "xl",
          position: typo.position || "center",
          background: typo.background || "none",
          color: typo.color || (projectConfig && projectConfig.palette ? projectConfig.palette.primary : "#FFFFFF"),
          emphasisWords: typo.emphasisWords || [],
          accentColor: typo.accentColor || (projectConfig && projectConfig.palette ? projectConfig.palette.accent : "#00E5FF")
        },
        animations: [],
        effects: []
      });
    });
  }

  return {
    animations,
    effects,
    transitionIn,
    transitionOut,
    typographyLayers
  };
}
