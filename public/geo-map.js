// Real cartography from real geodata.
//
// The previous "map" beat was a list of place names with pins beside them,
// because inventing a coastline is worse than drawing none — a wrong map is
// confidently wrong on screen and a viewer who knows the region will catch it
// instantly. This draws actual Natural Earth boundaries instead.
//
// Data: Natural Earth 110m admin-0 countries (public domain), coordinates
// rounded to 2dp (~1.1 km) and stripped to the name fields we match on. 175 KB,
// loaded once and cached.
(() => {
  'use strict';

  const DATA_URL = 'data/world-110m.json';
  let worldPromise = null;
  let world = null;

  function load() {
    if (world) return Promise.resolve(world);
    if (!worldPromise) {
      worldPromise = fetch(DATA_URL)
        .then((r) => {
          if (!r.ok) throw new Error(`world data ${r.status}`);
          return r.json();
        })
        .then((j) => {
          world = j;
          return j;
        })
        .catch((e) => {
          worldPromise = null;
          throw e;
        });
    }
    return worldPromise;
  }

  // --- name matching -------------------------------------------------------

  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Common names that do not match Natural Earth's spelling.
  const ALIASES = {
    'usa': 'united states of america',
    'us': 'united states of america',
    'united states': 'united states of america',
    'uk': 'united kingdom',
    'britain': 'united kingdom',
    'great britain': 'united kingdom',
    'england': 'united kingdom',
    'holland': 'netherlands',
    'burma': 'myanmar',
    'ivory coast': "cote d'ivoire",
    'south korea': 'korea',
    'north korea': 'dem rep korea',
    'czech republic': 'czechia',
    'uae': 'united arab emirates',
    'drc': 'dem rep congo',
    'congo kinshasa': 'dem rep congo'
  };

  function candidates(f) {
    const p = f.p || {};
    return [p.n, p.l, p.a].filter(Boolean).map(norm);
  }

  /** Find a country feature by human name. Returns null when unsure. */
  function findCountry(name) {
    if (!world) return null;
    let q = norm(name);
    if (!q) return null;
    q = ALIASES[q] || q;
    let hit = world.features.find((f) => candidates(f).indexOf(q) > -1);
    if (hit) return hit;
    // Fall back to a containment match, but only when it is unambiguous —
    // "Guinea" must not silently select Papua New Guinea.
    const partial = world.features.filter((f) => candidates(f).some((c) => c === q || c.indexOf(q) === 0));
    return partial.length === 1 ? partial[0] : null;
  }

  /** Pull country names out of free text. Longest names first so "South Africa" wins over "Africa". */
  function detectCountries(text) {
    if (!world) return [];
    const hay = ' ' + norm(text) + ' ';
    const found = [];
    const names = [];
    world.features.forEach((f) => {
      candidates(f).forEach((c) => {
        if (c.length >= 4) names.push({ c, f });
      });
    });
    names.sort((a, b) => b.c.length - a.c.length);
    for (const { c, f } of names) {
      if (found.indexOf(f) > -1) continue;
      if (hay.indexOf(' ' + c + ' ') > -1) found.push(f);
    }
    return found;
  }

  // --- geometry ------------------------------------------------------------

  function eachRing(feature, fn) {
    const g = feature.geometry;
    if (!g) return;
    if (g.type === 'Polygon') g.coordinates.forEach(fn);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(fn));
  }

  function bounds(features) {
    let minX = 180;
    let minY = 90;
    let maxX = -180;
    let maxY = -90;
    features.forEach((f) => eachRing(f, (ring) => {
      ring.forEach((pt) => {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      });
    }));
    return { minX, minY, maxX, maxY };
  }

  // Equirectangular, with latitude compressed by cos(mid-latitude) so a country
  // is not visibly stretched. Enough for a documentary locator; not a
  // navigational projection, and deliberately not pretending to be one.
  function projector(view, w, h, pad) {
    const midLat = ((view.minY + view.maxY) / 2) * Math.PI / 180;
    const kx = Math.max(0.15, Math.cos(midLat));
    const spanX = (view.maxX - view.minX) * kx || 1;
    const spanY = (view.maxY - view.minY) || 1;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const cx = (view.minX + view.maxX) / 2;
    const cy = (view.minY + view.maxY) / 2;
    return (lon, lat) => [
      w / 2 + (lon - cx) * kx * scale,
      h / 2 - (lat - cy) * scale
    ];
  }

  /**
   * Pad the view AND match it to the canvas aspect, so the frame is filled.
   *
   * Padding alone is not enough: a tall narrow country like Sri Lanka fits to
   * the canvas height and leaves most of the width as empty ocean, which reads
   * as a mistake rather than a composition. Growing the short axis to the
   * target aspect turns that dead space into geographic context — the
   * neighbours that tell the viewer where they are.
   *
   * A minimum span stops a single small country filling the frame at a zoom
   * where nothing around it is recognisable.
   */
  function padded(b, factor, aspect, minSpanDeg) {
    const MIN = minSpanDeg == null ? 14 : minSpanDeg;
    let minX = b.minX;
    let maxX = b.maxX;
    let minY = b.minY;
    let maxY = b.maxY;

    const dx = (maxX - minX) * factor;
    const dy = (maxY - minY) * factor;
    minX -= dx; maxX += dx; minY -= dy; maxY += dy;

    // Enforce a floor on the smaller dimension so context is always visible.
    const growTo = (lo, hi, want) => {
      const span = hi - lo;
      if (span >= want) return [lo, hi];
      const mid = (lo + hi) / 2;
      return [mid - want / 2, mid + want / 2];
    };
    [minX, maxX] = growTo(minX, maxX, MIN);
    [minY, maxY] = growTo(minY, maxY, MIN * 0.6);

    // Match the canvas aspect. Longitude degrees are narrower away from the
    // equator, so compare in projected units, not raw degrees.
    if (aspect) {
      const midLat = ((minY + maxY) / 2) * Math.PI / 180;
      const kx = Math.max(0.15, Math.cos(midLat));
      const spanX = (maxX - minX) * kx;
      const spanY = maxY - minY;
      if (spanX / spanY < aspect) {
        const want = (spanY * aspect) / kx;
        [minX, maxX] = growTo(minX, maxX, want);
      } else {
        [minY, maxY] = growTo(minY, maxY, spanX / aspect);
      }
    }

    return {
      minX: Math.max(-180, minX),
      maxX: Math.min(180, maxX),
      minY: Math.max(-85, minY),
      maxY: Math.min(85, maxY)
    };
  }

  function drawFeature(ctx, f, project) {
    ctx.beginPath();
    eachRing(f, (ring) => {
      ring.forEach((pt, i) => {
        const [x, y] = project(pt[0], pt[1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    });
  }

  /** Largest-ring centroid — a reasonable label anchor, unlike an average over
   *  every island a country owns. */
  function labelPoint(f) {
    let best = null;
    let bestArea = -1;
    eachRing(f, (ring) => {
      let a = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        a += cross;
        cx += (ring[j][0] + ring[i][0]) * cross;
        cy += (ring[j][1] + ring[i][1]) * cross;
      }
      a *= 0.5;
      if (Math.abs(a) > bestArea && a !== 0) {
        bestArea = Math.abs(a);
        best = [cx / (6 * a), cy / (6 * a)];
      }
    });
    return best;
  }

  window.BlvckGeo = {
    load,
    findCountry,
    detectCountries,
    bounds,
    padded,
    projector,
    drawFeature,
    labelPoint,
    features: () => (world ? world.features : []),
    isLoaded: () => !!world,
    countryCount: () => (world ? world.features.length : 0)
  };
})();
