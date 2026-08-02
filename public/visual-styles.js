// Visual style strategies — the medium decides how a prompt is written.
//
// Appending "Style: 2D Animation" to a prompt that opens with "wide shot,
// slow push in, natural light, shallow depth of field" does not produce a
// cartoon. It produces a photograph with the words "2D Animation" in it,
// because every other term in the prompt is photographic and they outvote the
// label. That is why choosing an illustrated style kept returning live action.
//
// So a style is not a suffix here. It carries:
//
//   lead      what the image IS, stated first — the strongest position
//   render    the medium's own vocabulary (cel shading, marker lines, impasto)
//   camera    'photo' uses lens language, 'compose' uses framing language,
//             'none' drops camera talk entirely
//   light     how light is described in this medium, if at all
//   negative  what must NOT appear — the half that actually enforces a style
//
// The negatives matter most. A 2D animation prompt has to actively exclude
// photorealism, or the model's prior pulls it straight back to a photograph.
(() => {
  'use strict';

  // Shot names in photographic vs compositional language. An illustrator does
  // not shoot a "close-up"; they draw a "close framing".
  const SHOT_PHOTO = {
    'Extreme Wide': 'extreme wide shot', 'Wide': 'wide shot', 'Medium': 'medium shot',
    'Close Up': 'close-up', 'Extreme Close Up': 'extreme close-up',
    'Over Shoulder': 'over-the-shoulder shot', 'POV': 'point-of-view shot'
  };
  const SHOT_COMPOSE = {
    'Extreme Wide': 'very wide framing, subject small in frame',
    'Wide': 'wide framing, full scene visible',
    'Medium': 'medium framing, subject from the waist up',
    'Close Up': 'close framing on the subject',
    'Extreme Close Up': 'extreme close framing, detail fills the frame',
    'Over Shoulder': 'framed from behind one figure looking at another',
    'POV': 'first-person viewpoint'
  };

  const PHOTO_NEG = 'illustration, drawing, cartoon, anime, painting, render, 3d, cgi, sketch';
  const DRAWN_NEG = 'photograph, photorealistic, photo, dslr, bokeh, depth of field, film grain, ' +
    'lens flare, realistic skin texture, live action, 35mm, cinematic lighting';

  const STYLES = {
    // --- photographic family ------------------------------------------------
    'Photorealistic': {
      lead: 'a photorealistic photograph',
      render: 'true-to-life detail, accurate materials, natural skin texture, sharp focus',
      camera: 'photo', light: 'natural light, physically accurate shadows',
      negative: PHOTO_NEG
    },
    'Realistic': {
      lead: 'a realistic photograph',
      render: '50mm lens, real-world materials, high-detail texture, believable proportions',
      camera: 'photo', light: 'natural available light',
      negative: PHOTO_NEG
    },
    'Cinematic': {
      lead: 'a cinematic film still',
      render: 'anamorphic framing, shallow depth of field, filmic colour grading, motivated lighting',
      camera: 'photo', light: 'dramatic key and rim lighting, deep shadows',
      negative: PHOTO_NEG + ', flat lighting, snapshot'
    },
    'Documentary': {
      lead: 'an observational documentary photograph',
      render: 'candid framing, unposed, authentic environment, 35mm reportage',
      camera: 'photo', light: 'available light, no artificial studio setup',
      negative: PHOTO_NEG + ', staged, posed, studio lighting, over-stylised'
    },
    'Contemporary Lifestyle': {
      lead: 'a contemporary lifestyle photograph',
      render: 'clean modern setting, natural styling, editorial feel',
      camera: 'photo', light: 'soft daylight',
      negative: PHOTO_NEG
    },

    // --- drawn / animated family -------------------------------------------
    '2D Animation': {
      lead: 'a 2D animation frame, hand-drawn cartoon artwork',
      render: 'flat cel shading, bold clean outlines, simplified stylised shapes, ' +
        'limited flat colour palette, illustrated textures, animation model sheet quality',
      camera: 'compose', light: 'flat graphic light, simple block shadows',
      negative: DRAWN_NEG + ', 3d render, volumetric light'
    },
    '3D Animation (Pixar-style)': {
      lead: 'a 3D animated film frame in the style of a modern family animation studio',
      render: 'rounded stylised geometry, soft global illumination, subsurface scattering, ' +
        'appealing character design, polished stylised materials',
      camera: 'compose', light: 'soft bounced studio-quality global illumination',
      negative: 'photograph, live action, 2d, flat, sketch, gritty, photorealistic skin'
    },
    'Anime': {
      lead: 'an anime illustration',
      render: 'cel shaded, crisp line art, large expressive stylised eyes, ' +
        'anime facial proportions, manga-inspired composition, screentone shading',
      camera: 'compose', light: 'graphic cel shadows, bright rim light',
      negative: DRAWN_NEG + ', western cartoon, 3d render'
    },
    'Comic Book': {
      lead: 'a comic book panel',
      render: 'heavy inked outlines, halftone dot shading, saturated primary colours, dynamic action pose',
      camera: 'compose', light: 'hard graphic shadow shapes',
      negative: DRAWN_NEG + ', soft gradients, muted palette'
    },
    'Graphic Novel': {
      lead: 'a graphic novel panel',
      render: 'inked linework, high-contrast blacks, restrained muted palette, dramatic panel composition',
      camera: 'compose', light: 'stark chiaroscuro, deep ink shadows',
      negative: DRAWN_NEG + ', bright cartoon colours, cute'
    },
    'Storybook Illustration': {
      lead: 'a storybook illustration',
      render: 'warm painterly texture, soft edges, gentle stylised characters, picture-book composition',
      camera: 'compose', light: 'warm diffuse glow',
      negative: DRAWN_NEG + ', harsh, gritty, horror'
    },
    "Children's Book": {
      lead: "a children's picture book illustration",
      render: 'simple friendly shapes, bright cheerful palette, thick soft outlines, playful characters',
      camera: 'compose', light: 'even bright light',
      negative: DRAWN_NEG + ', dark, scary, complex detail'
    },
    'Historical Illustration': {
      lead: 'a historical illustration in a period-appropriate technique',
      render: 'engraved linework, aged paper tone, period-accurate clothing and objects, archival plate feel',
      camera: 'compose', light: 'flat illustrative light',
      negative: DRAWN_NEG + ', modern clothing, modern objects, neon colours'
    },
    'Vintage Artwork': {
      lead: 'a vintage printed artwork',
      render: 'mid-century print texture, limited spot-colour palette, visible registration and grain',
      camera: 'compose', light: 'flat print light',
      negative: DRAWN_NEG + ', modern digital gloss, hdr'
    },
    'Oil Painting': {
      lead: 'an oil painting',
      render: 'visible impasto brushwork, canvas texture, rich blended pigment, painterly edges',
      camera: 'compose', light: 'classical directional light',
      negative: DRAWN_NEG + ', vector, flat colour, digital sharpness'
    },
    'Watercolour': {
      lead: 'a watercolour painting',
      render: 'translucent washes, soft bleeding edges, visible paper grain, white paper highlights',
      camera: 'compose', light: 'soft luminous light through washes',
      negative: DRAWN_NEG + ', hard outlines, heavy saturation, vector'
    },
    'Concept Art': {
      lead: 'a production concept art painting',
      render: 'confident painterly brushwork, strong silhouette design, atmospheric depth, design-focused',
      camera: 'compose', light: 'moody atmospheric light',
      negative: 'photograph, snapshot, cluttered composition'
    },

    // --- graphic / explainer family ----------------------------------------
    'Modern Explainer Graphics': {
      lead: 'a modern explainer graphic',
      render: 'clean vector shapes, flat design, generous whitespace, clear visual hierarchy, simple icons',
      camera: 'none', light: 'none',
      negative: DRAWN_NEG + ', clutter, ornate detail, texture'
    },
    'Infographic / Data Visual': {
      lead: 'a clean infographic data visual',
      render: 'flat vector charts and icons, restrained palette, strong hierarchy, generous whitespace',
      camera: 'none', light: 'none',
      negative: DRAWN_NEG + ', decorative clutter, 3d bevels'
    },
    'Motion Graphics': {
      lead: 'a motion graphics frame',
      render: 'bold vector shapes, flat design, modern UI elements, geometric composition, crisp edges',
      camera: 'none', light: 'none',
      negative: DRAWN_NEG + ', texture, painterly, clutter'
    },
    'Whiteboard Explainer': {
      lead: 'a whiteboard explainer drawing on a clean white board',
      render: 'hand-drawn black marker lines, simple diagrams and arrows, sketch style, ' +
        'one or two accent marker colours, plenty of white space',
      camera: 'none', light: 'none',
      negative: DRAWN_NEG + ', colour photography, complex shading, full-colour illustration'
    },
    'Tech / UI Style': {
      lead: 'a clean technology interface visual',
      render: 'crisp UI panels, geometric layout, subtle gradients, modern product design language',
      camera: 'none', light: 'even soft light',
      negative: DRAWN_NEG + ', organic texture, painterly'
    },
    'Low Poly 3D': {
      lead: 'a low poly 3D render',
      render: 'faceted geometry, flat shaded polygons, simple stylised forms, clean solid colours',
      camera: 'compose', light: 'simple directional shading',
      negative: 'photograph, high detail texture, realistic materials, smooth organic surfaces'
    },
    'Isometric': {
      lead: 'an isometric illustration',
      render: 'precise isometric projection, clean vector geometry, consistent 30-degree angles, flat colour',
      camera: 'none', light: 'flat consistent shading',
      negative: DRAWN_NEG + ', perspective distortion, vanishing point'
    },
    'Modern Digital Art': {
      lead: 'a modern digital artwork',
      render: 'polished digital painting, confident shapes, contemporary colour palette',
      camera: 'compose', light: 'stylised graphic light',
      negative: 'photograph, snapshot'
    },

    // --- the new one --------------------------------------------------------
    'Stickman': {
      lead: 'a minimalist stick figure drawing on a plain white background',
      render: 'simple black stick figures with circle heads and straight limb lines, ' +
        'hand-drawn marker linework, minimal props drawn as simple outlines, ' +
        'plenty of empty white space, dot-and-line facial expressions, educational sketch',
      camera: 'none', light: 'none',
      // The whole point is what is absent. Without these the model reliably
      // "improves" a stick figure into a rendered character.
      negative: DRAWN_NEG + ', detailed character, muscles, clothing detail, facial features, ' +
        'shading, gradients, colour background, realistic proportions, 3d, anatomy'
    }
  };

  // Aliases for the spellings the UI and the model actually emit.
  const ALIASES = {
    'watercolor': 'Watercolour',
    '3d animation': '3D Animation (Pixar-style)',
    'pixar': '3D Animation (Pixar-style)',
    'pixar-style': '3D Animation (Pixar-style)',
    'infographic': 'Infographic / Data Visual',
    'data visual': 'Infographic / Data Visual',
    'tech': 'Tech / UI Style',
    'ui': 'Tech / UI Style',
    'stick figure': 'Stickman',
    'stick man': 'Stickman',
    'whiteboard': 'Whiteboard Explainer'
  };

  function find(name) {
    const raw = String(name || '').trim();
    if (!raw || /^auto/i.test(raw)) return null;
    if (STYLES[raw]) return STYLES[raw];
    const low = raw.toLowerCase();
    if (ALIASES[low] && STYLES[ALIASES[low]]) return STYLES[ALIASES[low]];
    const hit = Object.keys(STYLES).find((k) => k.toLowerCase() === low);
    if (hit) return STYLES[hit];
    // Loose contains match, longest name first so "Anime" cannot beat a longer
    // style whose name contains it.
    const loose = Object.keys(STYLES)
      .sort((a, b) => b.length - a.length)
      .find((k) => low.includes(k.toLowerCase()) || k.toLowerCase().includes(low));
    return loose ? STYLES[loose] : null;
  }

  /** Shot phrasing appropriate to the medium. */
  function shotText(shotType, style) {
    const s = find(style);
    const mode = s ? s.camera : 'photo';
    if (mode === 'none') return '';
    const table = mode === 'photo' ? SHOT_PHOTO : SHOT_COMPOSE;
    return table[shotType] || '';
  }

  /** Should camera MOVEMENT language be used at all? Meaningless for a still. */
  function usesCameraMove(style) {
    const s = find(style);
    return !s || s.camera === 'photo';
  }

  /**
   * Build the prompt's opening. The medium is stated FIRST because the earliest
   * terms carry the most weight, which is precisely why a trailing style label
   * was being ignored.
   */
  function lead(style) {
    const s = find(style);
    return s ? s.lead : '';
  }

  function renderLanguage(style) {
    const s = find(style);
    return s ? s.render : '';
  }

  function lightLanguage(style) {
    const s = find(style);
    if (!s || s.light === 'none') return '';
    return s.light;
  }

  /** Style-specific negative prompt — the half that actually enforces a look. */
  function negative(style) {
    const s = find(style);
    return s ? s.negative : '';
  }

  /** Does this style forbid photographic vocabulary anywhere in the prompt? */
  function isDrawn(style) {
    const s = find(style);
    return !!s && s.camera !== 'photo';
  }

  window.BlvckStyles = {
    STYLES,
    names: () => Object.keys(STYLES),
    find,
    lead,
    renderLanguage,
    lightLanguage,
    negative,
    shotText,
    usesCameraMove,
    isDrawn
  };
})();
