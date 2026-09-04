export function validateAndMapMotionJSON(jsonString, slots) {
  let spec;
  try {
    spec = JSON.parse(jsonString);
  } catch (e) {
    return { valid: false, errors: ["Invalid JSON syntax."], matched: 0, unknown: [] };
  }

  if (!spec.schemaVersion || !spec.schemaVersion.startsWith("motion-")) {
    return { valid: false, errors: ["Missing or unsupported schemaVersion. Expected 'motion-v1' or similar."], matched: 0, unknown: [] };
  }

  if (!Array.isArray(spec.clips)) {
    return { valid: false, errors: ["Missing 'clips' array."], matched: 0, unknown: [] };
  }

  const errors = [];
  const unknownClips = [];
  let matchedCount = 0;
  
  // Create a fast lookup for existing slot IDs
  const validIds = new Set(slots.filter(s => !s.empty).map(s => s.id));

  // We will build a sanitized config map keyed by clipId
  const configMap = {};

  for (let i = 0; i < spec.clips.length; i++) {
    const c = spec.clips[i];
    if (!c.clipId) {
      errors.push(`Clip at index ${i} is missing a 'clipId'.`);
      continue;
    }

    if (!validIds.has(c.clipId)) {
      unknownClips.push(c.clipId);
      continue;
    }

    // Basic validation of motion structure
    const motionObj = c.motion || c; // Support both nested 'motion' object and flat properties
    if (motionObj.keyframes) {
      if (!Array.isArray(motionObj.keyframes)) {
        errors.push(`clipId '${c.clipId}' has invalid 'keyframes' (must be an array).`);
      } else {
        motionObj.keyframes.forEach((kf, kIdx) => {
          const tValue = kf.t !== undefined ? kf.t : kf.time;
          if (tValue === undefined || tValue < 0 || tValue > 1) {
            // Some AIs generate raw seconds for 'time' instead of normalized 't'. Allow it if it's >= 0.
            if (tValue === undefined || tValue < 0) {
              errors.push(`clipId '${c.clipId}' keyframe ${kIdx} has invalid 't' or 'time'.`);
            }
          }
          // The AI generated flat properties inside the keyframe object (e.g. {time: 0, scale: 1.2})
          // We don't strictly require a 'properties' object anymore, we just accept the whole keyframe
        });
      }
    }

    if (c.effects && !Array.isArray(c.effects)) {
      errors.push(`clipId '${c.clipId}' has invalid 'effects' (must be an array).`);
    }

    if (c.textAnimations && !Array.isArray(c.textAnimations)) {
      errors.push(`clipId '${c.clipId}' has invalid 'textAnimations' (must be an array).`);
    } else if (c.textAnimations) {
      c.textAnimations.forEach((txt, idx) => {
        if (!txt.text) errors.push(`clipId '${c.clipId}' textAnimation ${idx} missing 'text' property.`);
      });
    }

    matchedCount++;
    configMap[c.clipId] = c;
  }

  if (spec.overlays && !Array.isArray(spec.overlays)) {
    errors.push("If provided, 'overlays' must be an array of layers.");
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    errors,
    matched: matchedCount,
    unknown: unknownClips,
    config: isValid ? configMap : null,
    overlays: (isValid && spec.overlays) ? spec.overlays : []
  };
}
