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
    if (c.motion && c.motion.keyframes) {
      if (!Array.isArray(c.motion.keyframes)) {
        errors.push(`clipId '${c.clipId}' has invalid 'keyframes' (must be an array).`);
      } else {
        c.motion.keyframes.forEach((kf, kIdx) => {
          if (kf.t === undefined || kf.t < 0 || kf.t > 1) {
            errors.push(`clipId '${c.clipId}' keyframe ${kIdx} has invalid 't' (must be 0-1).`);
          }
          if (!kf.properties || typeof kf.properties !== 'object') {
            errors.push(`clipId '${c.clipId}' keyframe ${kIdx} missing 'properties' object.`);
          }
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
