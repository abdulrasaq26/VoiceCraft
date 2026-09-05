/**
 * AutoEditor Motion Schema v2 & v3 — Strict Validator & Normalizer
 *
 * This validates and normalizes AI output for motion specifications.
 * Supports both legacy `motion-v2` and new `motion-v3` (Director Mode).
 * 
 * Schema authority: docs/AI-MOTION-SCHEMA.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// Allowed value sets
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SCHEMA_VERSIONS = new Set(["motion-v2", "motion-v3"]);

const ALLOWED_STYLES = new Set([
  "cinematic-documentary", "tech-modern", "editorial-clean", 
  "bold-energetic", "minimal-dark"
]);

const ALLOWED_SCENE_ROLES = new Set([
  "intro", "setup", "explanation", "evidence", "statistic", 
  "comparison", "problem", "solution", "emotional", "emphasis", 
  "climax", "cta", "outro"
]);

const ALLOWED_TRANSITIONS = new Set([
  "cut", "fade", "crossfade",
  "slide-left", "slide-right", "slide-up", "slide-down",
  "wipe-left", "wipe-right",
  "push-left", "push-right",
  "blur-in", "zoom-through", "zoom",
]);

const ALLOWED_EFFECTS_V2 = new Set([
  "vignette", "glow", "shadow", "blur",
  "brightness", "contrast", "saturation", "grain", "hue-rotate",
]);

const ALLOWED_EFFECTS_V3 = new Set([
  "vignette", "glow", "grain", "blur", 
  "brightness", "contrast", "saturation", 
  "light-sweep", "accent-line", "shadow-bars", "shadow", "hue-rotate"
]);

const ALLOWED_EASINGS = new Set([
  "linear", "none",
  "power1.inOut", "power1.in", "power1.out",
  "power2.inOut", "power2.in", "power2.out",
  "power3.inOut", "power3.in", "power3.out",
  "back.out", "back.out(1.7)",
  "bounce.out",
]);

const ALLOWED_TYPOGRAPHY = new Set([
  "word-reveal", "char-cascade", "typewriter",
  "blur-reveal", "fade-up", "slide-up", "pop", "bounce",
  "masked-reveal", "scale-punch"
]);

const ALLOWED_SIZES = new Set(["sm", "md", "lg", "xl", "2xl"]);

const ALLOWED_POSITIONS = new Set([
  "top", "center", "bottom", "lower-third", 
  "negative-left", "negative-right"
]);

const ALLOWED_BACKGROUNDS = new Set(["none", "pill", "bar", "gradient", "card"]);

const ALLOWED_KEYFRAME_PROPS = new Set([
  "time", "scale", "x", "y", "opacity", "rotation", "rotationX", "rotationY"
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function err(errors, msg) {
  errors.push(msg);
}

function validateEasing(value, path, errors) {
  if (value !== undefined && !ALLOWED_EASINGS.has(value)) {
    // We normalize if the LLM hallucinated a slight variation
    // For now, strict enforcement, but could be forgiving here
    err(errors, `${path}: unknown easing "${value}". Allowed: ${[...ALLOWED_EASINGS].join(", ")}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyframe validator
// ─────────────────────────────────────────────────────────────────────────────

function validateKeyframe(kf, path, errors) {
  if (typeof kf !== "object" || kf === null || Array.isArray(kf)) {
    err(errors, `${path}: must be an object`);
    return;
  }

  if (kf.time === undefined) {
    err(errors, `${path}: missing required field "time"`);
  } else if (typeof kf.time !== "number" || kf.time < 0) {
    err(errors, `${path}.time: must be a non-negative number`);
  }

  for (const key of Object.keys(kf)) {
    if (!ALLOWED_KEYFRAME_PROPS.has(key)) {
      err(errors, `${path}: unknown keyframe property "${key}"`);
    }
  }

  for (const prop of ["scale", "x", "y", "opacity", "rotation", "rotationX", "rotationY"]) {
    if (kf[prop] !== undefined && typeof kf[prop] !== "number") {
      err(errors, `${path}.${prop}: must be a number`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V3 validators
// ─────────────────────────────────────────────────────────────────────────────

function validateProject(project, errors) {
  if (typeof project !== "object" || project === null) return;
  if (project.style && !ALLOWED_STYLES.has(project.style)) {
    err(errors, `project.style: unknown style "${project.style}"`);
  }
  if (project.palette) {
    if (typeof project.palette !== "object") {
      err(errors, `project.palette: must be an object`);
    }
  }
  if (project.defaultEasing) {
    validateEasing(project.defaultEasing, "project.defaultEasing", errors);
  }
}

function validateTransitionObject(trans, path, errors) {
  if (typeof trans !== "object" || trans === null) {
    err(errors, `${path}: must be an object`);
    return;
  }
  if (trans.type && !ALLOWED_TRANSITIONS.has(trans.type)) {
    err(errors, `${path}.type: unknown value "${trans.type}"`);
  }
  if (trans.duration !== undefined && typeof trans.duration !== "number") {
    err(errors, `${path}.duration: must be a number`);
  }
}

function validateTypography(typo, index, path, errors) {
  const p = `${path}.typography[${index}]`;
  if (typeof typo !== "object" || typo === null) {
    err(errors, `${p}: must be an object`);
    return;
  }
  if (typo.start !== undefined && typeof typo.start !== "number") err(errors, `${p}.start: must be a number`);
  if (typo.duration !== undefined && typeof typo.duration !== "number") err(errors, `${p}.duration: must be a number`);
  if (typo.text !== undefined && typeof typo.text !== "string") err(errors, `${p}.text: must be a string`);
  
  if (typo.preset && !ALLOWED_TYPOGRAPHY.has(typo.preset)) err(errors, `${p}.preset: unknown preset "${typo.preset}"`);
  if (typo.position && !ALLOWED_POSITIONS.has(typo.position)) err(errors, `${p}.position: unknown position "${typo.position}"`);
  if (typo.size && !ALLOWED_SIZES.has(typo.size)) err(errors, `${p}.size: unknown size "${typo.size}"`);
  if (typo.background && !ALLOWED_BACKGROUNDS.has(typo.background)) err(errors, `${p}.background: unknown background "${typo.background}"`);
  
  if (typo.emphasisWords) {
    if (!Array.isArray(typo.emphasisWords)) {
      err(errors, `${p}.emphasisWords: must be an array of strings`);
    }
  }
}

function validateEffectV3(eff, index, path, errors) {
  const p = `${path}.effects[${index}]`;
  if (typeof eff !== "object" || eff === null) {
    err(errors, `${p}: must be an object in v3`);
    return;
  }
  if (!eff.type) {
    err(errors, `${p}: missing "type"`);
  } else if (!ALLOWED_EFFECTS_V3.has(eff.type)) {
    err(errors, `${p}.type: unknown effect "${eff.type}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clip validator
// ─────────────────────────────────────────────────────────────────────────────

function validateClip(clip, index, validIds, version, errors) {
  const path = `clips[${index}]`;

  if (typeof clip !== "object" || clip === null) {
    err(errors, `${path}: must be an object`);
    return null;
  }

  if (!clip.clipId || typeof clip.clipId !== "string") {
    err(errors, `${path}: missing required field "clipId"`);
    return null;
  }

  if (!validIds.has(clip.clipId)) {
    err(errors, `${path}: clipId "${clip.clipId}" not found in timeline.`);
    return null;
  }

  if (version === "motion-v3") {
    // V3 validations
    if (clip.sceneRole && !ALLOWED_SCENE_ROLES.has(clip.sceneRole)) {
      err(errors, `${path}.sceneRole: unknown role "${clip.sceneRole}"`);
    }
    if (clip.motionIntensity !== undefined) {
      if (typeof clip.motionIntensity !== "number" || clip.motionIntensity < 0 || clip.motionIntensity > 5) {
        err(errors, `${path}.motionIntensity: must be a number between 0 and 5`);
      }
    }
    if (clip.camera) {
      if (typeof clip.camera !== "object") err(errors, `${path}.camera: must be an object`);
      else {
        if (clip.camera.keyframes) {
          if (!Array.isArray(clip.camera.keyframes)) err(errors, `${path}.camera.keyframes: must be an array`);
          else clip.camera.keyframes.forEach((kf, ki) => validateKeyframe(kf, `${path}.camera.keyframes[${ki}]`, errors));
        }
        if (clip.camera.easing) validateEasing(clip.camera.easing, `${path}.camera.easing`, errors);
      }
    }
    if (clip.typography) {
      if (!Array.isArray(clip.typography)) err(errors, `${path}.typography: must be an array`);
      else clip.typography.forEach((t, i) => validateTypography(t, i, path, errors));
    }
    if (clip.effects) {
      if (!Array.isArray(clip.effects)) err(errors, `${path}.effects: must be an array`);
      else clip.effects.forEach((eff, ei) => validateEffectV3(eff, ei, path, errors));
    }
    if (clip.transitionIn) validateTransitionObject(clip.transitionIn, `${path}.transitionIn`, errors);
    if (clip.transitionOut) validateTransitionObject(clip.transitionOut, `${path}.transitionOut`, errors);
  } else {
    // V2 validations
    if (clip.keyframes) {
      if (!Array.isArray(clip.keyframes)) err(errors, `${path}.keyframes: must be an array`);
      else clip.keyframes.forEach((kf, ki) => validateKeyframe(kf, `${path}.keyframes[${ki}]`, errors));
    }
    if (clip.easing) validateEasing(clip.easing, `${path}.easing`, errors);
    if (clip.transition) {
      if (typeof clip.transition !== "string") err(errors, `${path}.transition: must be a string in v2`);
      else if (!ALLOWED_TRANSITIONS.has(clip.transition)) err(errors, `${path}.transition: unknown value "${clip.transition}"`);
    }
    if (clip.effects) {
      if (!Array.isArray(clip.effects)) err(errors, `${path}.effects: must be an array of strings`);
      else clip.effects.forEach((eff, ei) => {
        if (typeof eff !== "string") err(errors, `${path}.effects[${ei}]: must be a string in v2`);
        else if (!ALLOWED_EFFECTS_V2.has(eff)) err(errors, `${path}.effects[${ei}]: unknown effect "${eff}"`);
      });
    }
  }

  return clip;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay validator (Mostly V2 legacy support)
// ─────────────────────────────────────────────────────────────────────────────

function validateOverlay(overlay, index, errors) {
  const path = `overlays[${index}]`;

  if (typeof overlay !== "object" || overlay === null) {
    err(errors, `${path}: must be an object`);
    return;
  }

  if (!overlay.type || overlay.type !== "text") {
    err(errors, `${path}: missing or invalid "type". Currently only "text" supported.`);
  }

  if (overlay.start === undefined || typeof overlay.start !== "number" || overlay.start < 0) {
    err(errors, `${path}.start: must be a non-negative number`);
  }

  if (overlay.duration === undefined || typeof overlay.duration !== "number" || overlay.duration <= 0) {
    err(errors, `${path}.duration: must be a positive number`);
  }

  if (!overlay.text || typeof overlay.text !== "string") {
    err(errors, `${path}: missing required field "text"`);
  }

  if (overlay.size && !ALLOWED_SIZES.has(overlay.size)) err(errors, `${path}.size: unknown value`);
  if (overlay.position && !ALLOWED_POSITIONS.has(overlay.position)) err(errors, `${path}.position: unknown value`);
  if (overlay.background && !ALLOWED_BACKGROUNDS.has(overlay.background)) err(errors, `${path}.background: unknown value`);
  if (overlay.typography && !ALLOWED_TYPOGRAPHY.has(overlay.typography)) err(errors, `${path}.typography: unknown preset`);
  if (overlay.easing) validateEasing(overlay.easing, `${path}.easing`, errors);
  if (overlay.effects) {
    if (!Array.isArray(overlay.effects)) err(errors, `${path}.effects: must be an array`);
    else overlay.effects.forEach((eff, ei) => {
      if (typeof eff !== "string" || !ALLOWED_EFFECTS_V2.has(eff)) err(errors, `${path}.effects[${ei}]: unknown effect`);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensures a parsed object meets base requirements, forgiving minor LLM mistakes
 * without violating strict schema validation.
 */
function normalizeSpec(spec) {
  // Graceful fallback for version
  if (!spec.schemaVersion) spec.schemaVersion = "motion-v2";
  
  if (spec.schemaVersion === "motion-v3") {
    if (!spec.project) spec.project = {};
    if (spec.clips && Array.isArray(spec.clips)) {
      spec.clips.forEach(clip => {
        // Fallbacks for LLM generating v2 shapes in v3 schema
        if (clip.keyframes && !clip.camera) {
          clip.camera = { keyframes: clip.keyframes };
          delete clip.keyframes;
        }
        if (clip.easing && clip.camera) {
          if (!clip.camera.easing) clip.camera.easing = clip.easing;
          delete clip.easing;
        }
      });
    }
  }
  return spec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function validateAndMapMotionJSON(jsonString, slots) {
  let spec;
  try {
    spec = JSON.parse(jsonString);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON syntax: ${e.message}`],
      matched: 0, unknown: [], config: null, overlays: [],
      version: "unknown", project: null
    };
  }

  const errors = [];

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return {
      valid: false,
      errors: ["Root value must be a JSON object"],
      matched: 0, unknown: [], config: null, overlays: [],
      version: "unknown", project: null
    };
  }

  spec = normalizeSpec(spec);

  if (!ALLOWED_SCHEMA_VERSIONS.has(spec.schemaVersion)) {
    err(errors, `schemaVersion must be one of: ${[...ALLOWED_SCHEMA_VERSIONS].join(", ")}`);
  }

  if (spec.schemaVersion === "motion-v3") {
    validateProject(spec.project, errors);
  }

  if (!Array.isArray(spec.clips)) {
    err(errors, `"clips" must be an array`);
    return { valid: false, errors, matched: 0, unknown: [], config: null, overlays: [], version: spec.schemaVersion, project: null };
  }

  if (spec.overlays !== undefined && !Array.isArray(spec.overlays)) {
    err(errors, `"overlays" must be an array if provided`);
  }

  const validIds = new Set(slots.filter(s => !s.empty).map(s => s.id));
  const configMap = {};
  const unknownClips = [];
  let matchedCount = 0;

  spec.clips.forEach((clip, i) => {
    const result = validateClip(clip, i, validIds, spec.schemaVersion, errors);
    if (result) {
      matchedCount++;
      configMap[clip.clipId] = clip;
    }
  });

  spec.clips.forEach(clip => {
    if (clip.clipId && !validIds.has(clip.clipId)) {
      unknownClips.push(clip.clipId);
    }
  });

  const validOverlays = [];
  if (Array.isArray(spec.overlays)) {
    spec.overlays.forEach((overlay, i) => {
      validateOverlay(overlay, i, errors);
      if (errors.length === 0) validOverlays.push(overlay);
    });
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    errors,
    matched: matchedCount,
    unknown: unknownClips,
    config:   isValid ? configMap   : null,
    overlays: isValid ? validOverlays : [],
    version:  spec.schemaVersion,
    project:  isValid && spec.schemaVersion === "motion-v3" ? spec.project : null
  };
}
