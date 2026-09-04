/**
 * AutoEditor Motion Schema v2 — Strict Validator
 *
 * This is a CONTRACT ENFORCER, not a forgiving parser.
 * If the AI output is invalid, it MUST be corrected before rendering.
 * We never silently patch, guess, or normalize AI output.
 *
 * Schema authority: AutoEditor_Motion_Schema_v2.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// Allowed value sets (source-verified against running engine files)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS = new Set([
  "cut", "fade", "crossfade",
  "slide-left", "slide-right", "slide-up", "slide-down",
  "wipe-left", "wipe-right",
  "push-left", "push-right",
  "blur-in", "zoom-through", "zoom",
]);

const ALLOWED_EFFECTS = new Set([
  "vignette", "glow", "shadow", "blur",
  "brightness", "contrast", "saturation", "grain", "hue-rotate",
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
]);

const ALLOWED_SIZES = new Set(["sm", "md", "lg", "xl", "2xl"]);

const ALLOWED_POSITIONS = new Set(["top", "center", "bottom", "lower-third"]);

const ALLOWED_BACKGROUNDS = new Set(["none", "pill", "bar", "gradient"]);

const ALLOWED_KEYFRAME_PROPS = new Set([
  "time", "scale", "x", "y", "opacity", "rotation",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function err(errors, msg) {
  errors.push(msg);
}

function validateEasing(value, path, errors) {
  if (value !== undefined && !ALLOWED_EASINGS.has(value)) {
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

  // time is required and must be a non-negative number
  if (kf.time === undefined) {
    err(errors, `${path}: missing required field "time" (absolute seconds from clip start)`);
  } else if (typeof kf.time !== "number" || kf.time < 0) {
    err(errors, `${path}.time: must be a non-negative number (got ${JSON.stringify(kf.time)}). Use absolute seconds, NOT normalized 0-1.`);
  }

  // Check for unknown properties
  for (const key of Object.keys(kf)) {
    if (!ALLOWED_KEYFRAME_PROPS.has(key)) {
      err(errors, `${path}: unknown keyframe property "${key}". Allowed: ${[...ALLOWED_KEYFRAME_PROPS].join(", ")}`);
    }
  }

  // Validate numeric properties
  for (const prop of ["scale", "x", "y", "opacity", "rotation"]) {
    if (kf[prop] !== undefined && typeof kf[prop] !== "number") {
      err(errors, `${path}.${prop}: must be a number (got ${JSON.stringify(kf[prop])})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clip validator
// ─────────────────────────────────────────────────────────────────────────────

function validateClip(clip, index, validIds, errors) {
  const path = `clips[${index}]`;

  if (typeof clip !== "object" || clip === null) {
    err(errors, `${path}: must be an object`);
    return null;
  }

  // clipId is required
  if (!clip.clipId || typeof clip.clipId !== "string") {
    err(errors, `${path}: missing required field "clipId" (string)`);
    return null;
  }

  // clipId must exist in the timeline
  if (!validIds.has(clip.clipId)) {
    err(errors, `${path}: clipId "${clip.clipId}" not found in timeline. Valid IDs: ${[...validIds].join(", ")}`);
    return null;
  }

  // keyframes — optional but must be an array
  if (clip.keyframes !== undefined) {
    if (!Array.isArray(clip.keyframes)) {
      err(errors, `${path}.keyframes: must be an array`);
    } else {
      clip.keyframes.forEach((kf, ki) => {
        validateKeyframe(kf, `${path}.keyframes[${ki}]`, errors);
      });
    }
  }

  // easing — optional string
  if (clip.easing !== undefined) {
    validateEasing(clip.easing, `${path}.easing`, errors);
  }

  // transition — must be a string, not an object
  if (clip.transition !== undefined) {
    if (typeof clip.transition !== "string") {
      err(errors, `${path}.transition: must be a string (got ${typeof clip.transition}). Example: "crossfade". Do NOT use an object.`);
    } else if (!ALLOWED_TRANSITIONS.has(clip.transition)) {
      err(errors, `${path}.transition: unknown value "${clip.transition}". Allowed: ${[...ALLOWED_TRANSITIONS].join(", ")}`);
    }
  }

  // effects — must be an array of strings
  if (clip.effects !== undefined) {
    if (!Array.isArray(clip.effects)) {
      err(errors, `${path}.effects: must be an array of strings`);
    } else {
      clip.effects.forEach((eff, ei) => {
        if (typeof eff !== "string") {
          err(errors, `${path}.effects[${ei}]: must be a string`);
        } else if (!ALLOWED_EFFECTS.has(eff)) {
          err(errors, `${path}.effects[${ei}]: unknown effect "${eff}". Allowed: ${[...ALLOWED_EFFECTS].join(", ")}`);
        }
      });
    }
  }

  // Check for unknown top-level clip fields
  const ALLOWED_CLIP_FIELDS = new Set(["clipId", "keyframes", "easing", "transition", "effects"]);
  for (const key of Object.keys(clip)) {
    if (!ALLOWED_CLIP_FIELDS.has(key)) {
      err(errors, `${path}: unknown field "${key}". Allowed clip fields: ${[...ALLOWED_CLIP_FIELDS].join(", ")}`);
    }
  }

  return clip;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay validator
// ─────────────────────────────────────────────────────────────────────────────

function validateOverlay(overlay, index, errors) {
  const path = `overlays[${index}]`;

  if (typeof overlay !== "object" || overlay === null) {
    err(errors, `${path}: must be an object`);
    return;
  }

  // type — required, only "text" supported currently
  if (!overlay.type) {
    err(errors, `${path}: missing required field "type". Currently only "text" is supported.`);
  } else if (overlay.type !== "text") {
    err(errors, `${path}.type: unsupported value "${overlay.type}". Currently only "text" is supported.`);
  }

  // start — required, absolute seconds
  if (overlay.start === undefined) {
    err(errors, `${path}: missing required field "start" (absolute video seconds)`);
  } else if (typeof overlay.start !== "number" || overlay.start < 0) {
    err(errors, `${path}.start: must be a non-negative number (absolute video seconds)`);
  }

  // duration — required
  if (overlay.duration === undefined) {
    err(errors, `${path}: missing required field "duration" (seconds)`);
  } else if (typeof overlay.duration !== "number" || overlay.duration <= 0) {
    err(errors, `${path}.duration: must be a positive number`);
  }

  // text — required
  if (!overlay.text || typeof overlay.text !== "string") {
    err(errors, `${path}: missing required field "text" (string)`);
  }

  // size — optional enum
  if (overlay.size !== undefined && !ALLOWED_SIZES.has(overlay.size)) {
    err(errors, `${path}.size: unknown value "${overlay.size}". Allowed: ${[...ALLOWED_SIZES].join(", ")}`);
  }

  // position — optional enum
  if (overlay.position !== undefined && !ALLOWED_POSITIONS.has(overlay.position)) {
    err(errors, `${path}.position: unknown value "${overlay.position}". Allowed: ${[...ALLOWED_POSITIONS].join(", ")}`);
  }

  // background — optional enum
  if (overlay.background !== undefined && !ALLOWED_BACKGROUNDS.has(overlay.background)) {
    err(errors, `${path}.background: unknown value "${overlay.background}". Allowed: ${[...ALLOWED_BACKGROUNDS].join(", ")}`);
  }

  // typography — optional enum
  if (overlay.typography !== undefined && !ALLOWED_TYPOGRAPHY.has(overlay.typography)) {
    err(errors, `${path}.typography: unknown preset "${overlay.typography}". Allowed: ${[...ALLOWED_TYPOGRAPHY].join(", ")}`);
  }

  // easing — optional
  if (overlay.easing !== undefined) {
    validateEasing(overlay.easing, `${path}.easing`, errors);
  }

  // effects — optional array of strings
  if (overlay.effects !== undefined) {
    if (!Array.isArray(overlay.effects)) {
      err(errors, `${path}.effects: must be an array of strings`);
    } else {
      overlay.effects.forEach((eff, ei) => {
        if (typeof eff !== "string" || !ALLOWED_EFFECTS.has(eff)) {
          err(errors, `${path}.effects[${ei}]: unknown effect "${eff}". Allowed: ${[...ALLOWED_EFFECTS].join(", ")}`);
        }
      });
    }
  }

  // zIndex — optional number
  if (overlay.zIndex !== undefined && typeof overlay.zIndex !== "number") {
    err(errors, `${path}.zIndex: must be a number`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate and map an AI-generated Motion Schema v2 JSON string.
 *
 * @param {string} jsonString  - Raw JSON from the AI
 * @param {Array}  slots       - Timeline slots from the editor doc
 * @returns {{
 *   valid:    boolean,
 *   errors:   string[],
 *   matched:  number,
 *   unknown:  string[],
 *   config:   Object | null,   // clipId → clip config map (only if valid)
 *   overlays: Array            // overlay array (only if valid)
 * }}
 */
export function validateAndMapMotionJSON(jsonString, slots) {
  // ── Step 1: Parse JSON ──────────────────────────────────────────────────────
  let spec;
  try {
    spec = JSON.parse(jsonString);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON syntax: ${e.message}`],
      matched: 0, unknown: [], config: null, overlays: [],
    };
  }

  const errors = [];

  // ── Step 2: Top-level structure ─────────────────────────────────────────────
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return {
      valid: false,
      errors: ["Root value must be a JSON object"],
      matched: 0, unknown: [], config: null, overlays: [],
    };
  }

  // schemaVersion must be exactly "motion-v2"
  if (spec.schemaVersion !== "motion-v2") {
    err(errors, `schemaVersion must be exactly "motion-v2" (got ${JSON.stringify(spec.schemaVersion)})`);
  }

  // clips must be an array
  if (!Array.isArray(spec.clips)) {
    err(errors, `"clips" must be an array (got ${typeof spec.clips})`);
    return { valid: false, errors, matched: 0, unknown: [], config: null, overlays: [] };
  }

  // overlays must be an array if present
  if (spec.overlays !== undefined && !Array.isArray(spec.overlays)) {
    err(errors, `"overlays" must be an array if provided (got ${typeof spec.overlays})`);
  }

  // ── Step 3: Build valid ID set ──────────────────────────────────────────────
  const validIds = new Set(slots.filter(s => !s.empty).map(s => s.id));

  // ── Step 4: Validate each clip ──────────────────────────────────────────────
  const configMap = {};
  const unknownClips = [];
  let matchedCount = 0;

  spec.clips.forEach((clip, i) => {
    const result = validateClip(clip, i, validIds, errors);
    if (result) {
      matchedCount++;
      configMap[clip.clipId] = clip;
    }
  });

  // Track unknown clipIds separately (not in timeline)
  spec.clips.forEach(clip => {
    if (clip.clipId && !validIds.has(clip.clipId)) {
      unknownClips.push(clip.clipId);
    }
  });

  // ── Step 5: Validate overlays ───────────────────────────────────────────────
  const validOverlays = [];
  if (Array.isArray(spec.overlays)) {
    spec.overlays.forEach((overlay, i) => {
      validateOverlay(overlay, i, errors);
      if (errors.length === 0) validOverlays.push(overlay);
    });
  }

  // ── Step 6: Return result ───────────────────────────────────────────────────
  const isValid = errors.length === 0;

  return {
    valid: isValid,
    errors,
    matched: matchedCount,
    unknown: unknownClips,
    config:   isValid ? configMap   : null,
    overlays: isValid ? (Array.isArray(spec.overlays) ? spec.overlays : []) : [],
  };
}
