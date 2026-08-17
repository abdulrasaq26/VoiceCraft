// Credits, and the rights audit that decides whether a project may be exported.
//
// Attribution is derived from the asset record every time it is asked for, and
// never typed into a description by hand. A clip that gets trimmed, moved,
// swapped or reused changes the credits with it — a hand-written credit block
// silently goes stale the first time someone replaces a shot, and the mistake
// is invisible until someone complains.
//
// What this file will not do: decide fair use. It reports what a licence says
// and what is still unresolved. Whether an uncleared clip may be published is
// a legal judgement about purpose, the nature of the work, how much is taken
// and the effect on the market for the original — fact-specific, and not
// something metadata can settle. Crediting a work does not make its use fair,
// and neither does shortening it or talking over it.
(() => {
  'use strict';

  const LICENSE_NAMES = [
    [/publicdomain\/zero/i,        'CC0 1.0 (Public Domain Dedication)'],
    [/publicdomain\/mark/i,        'Public Domain Mark 1.0'],
    [/\/licenses\/publicdomain/i,  'Public Domain'],
    [/\/licenses\/by\/4/i,         'CC BY 4.0'],
    [/\/licenses\/by\/3/i,         'CC BY 3.0'],
    [/\/licenses\/by\/2/i,         'CC BY 2.0'],
    [/\/licenses\/by\//i,          'CC BY']
  ];

  function licenseName(url) {
    const hit = LICENSE_NAMES.find(([re]) => re.test(String(url || '')));
    return hit ? hit[1] : '';
  }

  /**
   * The attribution record for one acquired asset.
   *
   * Returns null when nothing is owed — public-domain material needs no
   * credit, and inventing one would imply an obligation that does not exist.
   */
  function forAsset(stockAsset) {
    if (!stockAsset) return null;
    const license = stockAsset.license || null;
    if (!license || !license.requiresAttribution) return null;

    const a = stockAsset.archive || {};
    return {
      required: true,
      provider: stockAsset.provider,
      identifier: a.identifier || stockAsset.id || '',
      // Only what the item actually stated. An absent creator stays absent
      // rather than becoming "Unknown", which would read as a real name.
      title: a.title || '',
      creator: a.creator || '',
      date: a.date || '',
      sourceUrl: stockAsset.sourceUrl || '',
      license: licenseName(license.licenseUrl) || license.label || '',
      licenseUrl: license.licenseUrl || '',
      changes: describeChanges(stockAsset)
    };
  }

  // CC-BY asks that modifications be indicated. Excerpting and reframing are
  // modifications, so say so rather than leaving it implied.
  function describeChanges(stockAsset) {
    const changes = [];
    if (stockAsset.excerpt && stockAsset.excerpt.applied) changes.push('excerpted');
    if (stockAsset.treatment && stockAsset.treatment.reframed) changes.push('reframed');
    if (stockAsset.treatment && stockAsset.treatment.upscaled) changes.push('scaled for presentation');
    if (!changes.length) changes.push('incorporated into this video');
    return changes.join(', ');
  }

  function scenesWithAssets(scenes) {
    return (scenes || []).filter((s) => s && s.stockAsset);
  }

  /**
   * Every credit owed across a project, one entry per distinct source item.
   *
   * Deduplicated by identifier: reusing the same newsreel in four scenes owes
   * one credit, not four.
   */
  function forProject(scenes) {
    const byKey = new Map();
    for (const scene of scenesWithAssets(scenes)) {
      const record = forAsset(scene.stockAsset);
      if (!record) continue;
      const key = `${record.provider}:${record.identifier}`;
      if (!byKey.has(key)) byKey.set(key, Object.assign({ scenes: [] }, record));
      byKey.get(key).scenes.push(scene.index);
    }
    return [...byKey.values()];
  }

  /**
   * A paste-ready credits block for a YouTube description.
   *
   * Empty string when nothing is owed — an empty "FOOTAGE CREDITS" heading
   * implies obligations the project does not have.
   */
  function youtubeDescription(scenes) {
    const credits = forProject(scenes);
    if (!credits.length) return '';

    const lines = ['FOOTAGE CREDITS', ''];
    for (const c of credits) {
      const headline = [c.title, c.creator].filter(Boolean).join(' — ');
      lines.push(headline || c.identifier);
      if (c.provider === 'archive_org') lines.push('Source: Internet Archive');
      if (c.sourceUrl) lines.push(c.sourceUrl);
      if (c.license) lines.push(`License: ${c.license}`);
      if (c.licenseUrl) lines.push(c.licenseUrl);
      lines.push(`Changes: ${c.changes}.`);
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  }

  /** A compact single-line credit, for burning on screen over the clip. */
  function onScreenLine(stockAsset) {
    const r = forAsset(stockAsset);
    if (!r) return '';
    return [r.title, r.creator, r.license].filter(Boolean).join(' · ');
  }

  // ── Export gate ───────────────────────────────────────────────────────────

  /**
   * Per-scene rights audit, and whether the project may be exported.
   *
   * `blocked` is the answer that matters: an unresolved scene stops a cleared
   * export rather than producing a video whose rights nobody checked.
   */
  function audit(scenes, policyName) {
    const rows = [];
    for (const scene of (scenes || [])) {
      if (!scene) continue;
      const asset = scene.stockAsset;
      if (!asset) {
        rows.push({ index: scene.index, provider: null, status: 'no_asset',
                    headline: 'No footage — rendered as a graphic', blocking: false });
        continue;
      }

      // Non-archive libraries licence their whole catalogue for commercial
      // use, so there is nothing per-item to resolve.
      if (asset.provider !== 'archive_org') {
        rows.push({ index: scene.index, provider: asset.provider, status: 'cleared',
                    headline: '✓ Cleared (provider licence)', blocking: false });
        continue;
      }

      const verdict = window.ArchiveLicense.evaluate(asset.license, policyName);
      const approved = !!(scene.rightsApproval && scene.rightsApproval.approved);
      const blocking = verdict.status === 'not_cleared'
        || (verdict.humanReviewRequired && !approved);

      rows.push({
        index: scene.index,
        provider: asset.provider,
        status: approved && verdict.status === 'editorial_candidate'
          ? 'editorial_approved' : verdict.status,
        headline: approved && verdict.status === 'editorial_candidate'
          ? '⚠ Editorial candidate — reviewed and approved by you'
          : verdict.headline,
        title: (asset.archive && asset.archive.title) || '',
        sourceUrl: asset.sourceUrl || '',
        excerpt: asset.excerpt || null,
        requiresAttribution: verdict.requiresAttribution,
        blocking
      });
    }

    const blockers = rows.filter((r) => r.blocking);
    return {
      rows,
      blockers,
      canExport: blockers.length === 0,
      attributions: forProject(scenes),
      // Stated plainly so it cannot be read as legal clearance.
      disclaimer: 'This audit reports what each item\'s metadata says about its '
        + 'licence. It is not legal advice, and it does not determine fair use.'
    };
  }

  /** The machine-readable record that ships beside an export. */
  function exportManifest(scenes, policyName) {
    const a = audit(scenes, policyName);
    return {
      generatedAt: new Date().toISOString(),
      policy: policyName || window.ArchiveLicense.DEFAULT_POLICY,
      canExport: a.canExport,
      scenes: a.rows,
      attributions: a.attributions,
      youtubeDescription: youtubeDescription(scenes),
      disclaimer: a.disclaimer
    };
  }

  window.AttributionManager = {
    forAsset,
    forProject,
    youtubeDescription,
    onScreenLine,
    audit,
    exportManifest,
    licenseName
  };
})();
