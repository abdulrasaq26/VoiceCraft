// Rights gate for Internet Archive material.
//
// Internet Archive is a library, not a stock agency. Being hosted there says
// nothing about whether you may put an item in a monetised video — the archive
// holds public-domain government film alongside material uploaded under
// restrictive terms and material with no stated licence at all. Pixabay and
// Pexels can be trusted wholesale; this cannot.
//
// So every archive asset passes through here, and the default answer is no.
// An item is usable only when its own metadata says so.
//
// The three ways a licence blocks a monetised YouTube video:
//   NC (non-commercial)  — monetisation is commercial use
//   ND (no derivatives)  — cutting it into a video is a derivative
//   SA (share-alike)     — the finished video inherits the copyleft
//
// CC-BY permits both money and editing, but requires visible credit, so it is
// off by default and opt-in — a requirement is still a restriction.
(() => {
  'use strict';

  // Checked in order. The first match wins, so BLOCKED must be tested before
  // ATTRIBUTION: "licenses/by-nc/4.0" contains "licenses/by".
  const BLOCKED = [
    /by-nc/i,          // non-commercial: cannot monetise
    /by-nd/i,          // no derivatives: cannot cut or overlay
    /by-sa/i,          // share-alike: would place terms on the whole video
    /nc-nd/i, /nc-sa/i,
    /noncommercial/i,
    /\/licenses\/sampling/i   // sampling licences: commercial use restricted
  ];

  const PUBLIC_DOMAIN = [
    /publicdomain\/mark/i,       // https://creativecommons.org/publicdomain/mark/1.0/
    /publicdomain\/zero/i,       // CC0
    /\/licenses\/publicdomain/i, // legacy form still on older items
    /^cc0/i,
    /creativecommons\.org\/publicdomain\/?$/i
  ];

  const ATTRIBUTION = [
    /\/licenses\/by\/\d/i,       // CC-BY 2.0/3.0/4.0 — note the version digit
    /\/licenses\/by$/i
  ];

  // Collections whose own published terms put every item in the public domain.
  // This is a deliberately short list: each entry is an assertion about the
  // law, so it earns its place only when the collection says so plainly and
  // the material is US federal work or an explicit PD dedication.
  const TRUSTED_PD_COLLECTIONS = {
    prelinger:      'Prelinger Archives — collection is dedicated to the public domain',
    nasa:           'NASA — work of the US federal government',
    nasaimages:     'NASA — work of the US federal government',
    usgovfilms:     'US government film — federal work, no copyright',
    fedflix:        'FedFlix — US government film released to the public domain',
    'fedflix-2':    'FedFlix — US government film released to the public domain',
    nationalarchives: 'US National Archives — federal records',
    'us-national-archives': 'US National Archives — federal records'
  };

  function normaliseCollections(collection) {
    if (!collection) return [];
    const list = Array.isArray(collection) ? collection : [collection];
    return list.map((c) => String(c || '').toLowerCase().trim()).filter(Boolean);
  }

  function matches(url, patterns) {
    return patterns.some((re) => re.test(url));
  }

  /**
   * Decide what may be done with an item.
   *
   * Returns a verdict rather than a boolean, because the storyboard has to
   * show the user WHY a clip is or is not usable, and an attribution-required
   * clip needs its credit carried through to export.
   */
  function classify(meta = {}) {
    const url = String(meta.licenseurl || '').trim();
    const collections = normaliseCollections(meta.collection);
    const rightsText = String(meta.rights || meta['possible-copyright-status'] || '').trim();

    if (url && matches(url, BLOCKED)) {
      return verdict('restricted', url, rightsText, {
        label: 'Restricted licence',
        detail: reasonForBlock(url),
        monetisationSafe: false
      });
    }

    if (url && matches(url, PUBLIC_DOMAIN)) {
      return verdict('public_domain', url, rightsText, {
        label: 'Public domain',
        detail: 'No rights reserved. Free to use commercially, including monetised video.',
        monetisationSafe: true
      });
    }

    if (url && matches(url, ATTRIBUTION)) {
      return verdict('attribution', url, rightsText, {
        label: 'CC-BY — credit required',
        detail: 'Commercial use and editing permitted, but the creator must be credited on screen or in the description.',
        monetisationSafe: true,
        requiresAttribution: true
      });
    }

    // No licence URL we recognise. A trusted collection can still vouch for
    // it, but nothing else can.
    const trusted = collections.find((c) => TRUSTED_PD_COLLECTIONS[c]);
    if (trusted) {
      return verdict('public_domain', url, rightsText, {
        label: 'Public domain',
        detail: TRUSTED_PD_COLLECTIONS[trusted],
        basis: `collection:${trusted}`,
        monetisationSafe: true
      });
    }

    if (url) {
      return verdict('unknown', url, rightsText, {
        label: 'Unrecognised licence',
        detail: `AETHER does not recognise ${url}. Check the item on archive.org before publishing.`,
        monetisationSafe: false
      });
    }

    return verdict('unknown', '', rightsText, {
      label: 'Rights information unavailable',
      detail: 'This item states no licence. Hosting on archive.org is not permission — do not publish it without checking the source.',
      monetisationSafe: false
    });
  }

  function reasonForBlock(url) {
    if (/by-nc|noncommercial|nc-nd|nc-sa/i.test(url)) {
      return 'Non-commercial licence — a monetised video is commercial use.';
    }
    if (/by-nd|nc-nd/i.test(url)) {
      return 'No-derivatives licence — cutting this into a video is a derivative work.';
    }
    if (/by-sa|nc-sa/i.test(url)) {
      return 'Share-alike licence — using it would place the same terms on your finished video.';
    }
    return 'Licence restricts commercial reuse.';
  }

  function verdict(tier, licenseUrl, rightsText, extra) {
    return Object.assign({
      tier,                       // public_domain | attribution | restricted | unknown
      licenseUrl,
      rights: rightsText,
      basis: licenseUrl ? 'licenseurl' : 'none',
      requiresAttribution: false,
      monetisationSafe: false
    }, extra);
  }

  // ── Project rights policy ─────────────────────────────────────────────────
  //
  // Three settings, and the third is not "turn the safety off". It surfaces
  // material that is NOT cleared so a human can decide about it — the clip
  // still cannot reach an export without someone approving it by hand.
  const POLICIES = {
    cleared_only: {
      label: 'Cleared media only',
      note: 'Public domain and CC0. Nothing that carries an obligation.',
      allowAttribution: false,
      allowEditorialCandidates: false
    },
    cleared_plus_by: {
      label: 'Cleared media + CC-BY',
      note: 'Adds CC-BY, which permits commercial use provided the creator is credited. AETHER writes the credit for you.',
      allowAttribution: true,
      allowEditorialCandidates: false
    },
    editorial_review: {
      label: 'Allow editorial candidates (review required)',
      note: 'Also surfaces uncleared material for possible editorial use. AETHER does not determine fair use — every such clip needs your own review, and legal advice if you are unsure.',
      allowAttribution: true,
      allowEditorialCandidates: true
    }
  };

  const DEFAULT_POLICY = 'cleared_plus_by';

  function policy(name) {
    return POLICIES[name] || POLICIES[DEFAULT_POLICY];
  }

  /**
   * What may be done with this item under this project's policy.
   *
   * Deliberately not a boolean. "No" and "not without a human looking at it"
   * are different answers, and collapsing them is how uncleared footage ends
   * up in a published video.
   *
   * Nothing here decides fair use. Fair use is a fact-specific legal judgement
   * about purpose, the nature of the work, how much is taken and what it does
   * to the market for the original — it is not a property of metadata, and no
   * amount of trimming, crediting or narrating converts a restricted clip into
   * a cleared one. All this can say is "not cleared; a person must decide".
   */
  function evaluate(verdictObj, policyName) {
    const p = policy(policyName);
    const v = verdictObj || classify({});

    if (v.tier === 'public_domain') {
      return {
        status: 'cleared',
        usable: true,
        humanReviewRequired: false,
        requiresAttribution: false,
        headline: '✓ Cleared',
        detail: v.detail
      };
    }

    if (v.tier === 'attribution') {
      if (!p.allowAttribution) {
        return {
          status: 'not_cleared',
          usable: false,
          humanReviewRequired: false,
          requiresAttribution: true,
          headline: '✕ Not cleared under this policy',
          detail: 'CC-BY permits commercial use but requires a credit. Switch the project policy to "Cleared media + CC-BY" to use it.'
        };
      }
      return {
        status: 'attribution_required',
        usable: true,
        humanReviewRequired: false,
        requiresAttribution: true,
        headline: '✓ Commercial use permitted · ⚠ Attribution required',
        detail: v.detail
      };
    }

    // Restricted and unknown are the same answer to the production pipeline:
    // not cleared. They differ only in what a reviewer would be looking at.
    if (p.allowEditorialCandidates) {
      return {
        status: 'editorial_candidate',
        usable: false,               // never auto-placed, whatever the policy
        humanReviewRequired: true,   // set here, in code, never by the model
        requiresAttribution: true,
        headline: '⚠ Editorial candidate — human review required',
        detail: v.detail + ' AETHER does not determine fair use; this clip cannot be exported until you approve it.'
      };
    }

    return {
      status: 'not_cleared',
      usable: false,
      humanReviewRequired: false,
      requiresAttribution: false,
      headline: '✕ Not cleared',
      detail: v.detail
    };
  }

  /**
   * Is this item allowed under the current policy?
   *
   * `allowAttribution` opens CC-BY. Nothing opens restricted or unknown —
   * those are not a matter of preference.
   */
  function isUsable(verdictObj, { allowAttribution = false } = {}) {
    if (!verdictObj) return false;
    if (verdictObj.tier === 'public_domain') return true;
    if (verdictObj.tier === 'attribution') return !!allowAttribution;
    return false;
  }

  /**
   * The archive.org search filter for the current policy.
   *
   * Filtering server-side matters for more than tidiness: without it the great
   * majority of results are unusable, and the ranker would spend its budget
   * fetching metadata for items that can never be used.
   */
  function searchFilter({ allowAttribution = false, allowTrustedCollections = true } = {}) {
    const clauses = [
      'licenseurl:(*publicdomain*)',
      'licenseurl:(*publicdomain\\/mark*)',
      'licenseurl:(*publicdomain\\/zero*)'
    ];
    if (allowAttribution) {
      // Deliberately narrow: "licenses/by/" and not "by-nc" or "by-sa".
      clauses.push('licenseurl:(*licenses\\/by\\/*)');
    }
    if (allowTrustedCollections) {
      const cols = Object.keys(TRUSTED_PD_COLLECTIONS).join(' OR ');
      clauses.push(`collection:(${cols})`);
    }
    return `(${clauses.join(' OR ')})`;
  }

  window.ArchiveLicense = {
    classify,
    evaluate,
    isUsable,
    searchFilter,
    policy,
    POLICIES,
    DEFAULT_POLICY,
    TRUSTED_PD_COLLECTIONS,
    // exported for tests
    _patterns: { BLOCKED, PUBLIC_DOMAIN, ATTRIBUTION }
  };
})();
