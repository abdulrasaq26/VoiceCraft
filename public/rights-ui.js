// Rights & Editorial Review — the visible half of the rights layer.
//
// Everything here renders decisions made elsewhere. It never decides whether
// footage may be published: the classifier says what a licence permits, the
// policy says what this project accepts, and a person approves anything that
// is not cleared. This file's job is to make all of that legible before the
// video is exported rather than after someone complains.
//
// The wording is deliberate. "Cleared" means the licence permits it.
// "Editorial candidate" means nobody has decided yet. Nothing is ever labelled
// safe, permitted or fair use, because software cannot know that.
(() => {
  'use strict';

  const POLICY_KEY = 'blvck:rights_policy';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentPolicy() {
    return localStorage.getItem(POLICY_KEY)
      || (window.ArchiveLicense && window.ArchiveLicense.DEFAULT_POLICY)
      || 'cleared_plus_by';
  }

  function setPolicy(name) {
    localStorage.setItem(POLICY_KEY, name);
    window.dispatchEvent(new CustomEvent('blvck:rights-policy-changed', { detail: { policy: name } }));
  }

  // ── Scene card: the SOURCE block (spec section 12) ─────────────────────────

  const STATUS_CLASS = {
    cleared: 'rights-ok',
    attribution_required: 'rights-warn',
    editorial_candidate: 'rights-warn',
    editorial_approved: 'rights-warn',
    not_cleared: 'rights-bad',
    no_asset: 'rights-none'
  };

  /**
   * The rights panel for one storyboard scene.
   *
   * Returns '' when there is nothing to say — a scene rendered as a chart owes
   * no provenance, and an empty panel would just be furniture.
   */
  function sceneRightsHtml(scene) {
    if (!scene) return '';
    const asset = scene.stockAsset;
    const candidates = scene.editorialCandidates || [];

    if (!asset && !candidates.length) return '';

    // Nothing per-item to resolve for the modern libraries: their whole
    // catalogue is licensed for commercial use.
    if (asset && asset.provider !== 'archive_org') {
      return `<div class="scene-rights rights-ok">
        <div class="rights-head">SOURCE</div>
        <div class="rights-row"><span>Provider</span><b>${esc(asset.provider)}</b></div>
        <div class="rights-status">✓ Cleared — provider licence covers commercial use</div>
      </div>`;
    }

    const parts = [];

    if (asset) {
      const a = asset.archive || {};
      const verdict = window.ArchiveLicense.evaluate(asset.license, currentPolicy());
      const approved = !!(scene.rightsApproval && scene.rightsApproval.approved);
      const status = approved && verdict.status === 'editorial_candidate'
        ? 'editorial_approved' : verdict.status;

      const rows = [
        ['Provider', 'Internet Archive'],
        ['Title', a.title],
        ['Creator', a.creator],
        ['Date', a.date],
        ['Licence', (asset.license && asset.license.label) || '']
      ].filter(([, v]) => v);

      let html = `<div class="scene-rights ${STATUS_CLASS[status] || ''}">
        <div class="rights-head">SOURCE</div>
        ${rows.map(([k, v]) => `<div class="rights-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}`;

      if (asset.sourceUrl) {
        html += `<div class="rights-row"><span>Source</span>
          <a href="${esc(asset.sourceUrl)}" target="_blank" rel="noopener noreferrer">archive.org ↗</a></div>`;
      }

      // The excerpt window, with the caveat attached. A timecode range looks
      // authoritative, and this one was estimated.
      if (asset.excerpt && asset.excerpt.applied) {
        const SM = window.StockMedia;
        const from = SM ? SM.formatTimecode(asset.excerpt.start) : asset.excerpt.start;
        const to = SM ? SM.formatTimecode(asset.excerpt.end) : asset.excerpt.end;
        html += `<div class="rights-row"><span>Excerpt</span><b>${esc(from)} → ${esc(to)}</b></div>`;
        if (asset.excerpt.reviewSuggested) {
          html += `<div class="rights-note">${esc(asset.excerpt.note)}</div>`;
        }
      }

      if (asset.treatment && asset.treatment.note) {
        html += `<div class="rights-note">${esc(asset.treatment.note)}</div>`;
      }

      html += `<div class="rights-status">${esc(verdict.headline)}</div>`;
      if (approved) {
        html += `<div class="rights-note">You approved this clip for editorial use on `
              + `${esc(new Date(scene.rightsApproval.at || Date.now()).toLocaleString())}.</div>`;
      }

      const credit = window.AttributionManager && window.AttributionManager.forAsset(asset);
      if (credit) {
        html += `<div class="rights-note">Credit required — AETHER adds it to the export automatically.</div>`;
      }
      html += '</div>';
      parts.push(html);
    }

    // Clips the search found but the policy refused. Offered for review, never
    // placed automatically.
    for (const c of candidates) {
      parts.push(`<div class="scene-rights rights-bad">
        <div class="rights-head">⚠ EDITORIAL CANDIDATE — NOT USED</div>
        <div class="rights-row"><span>Title</span><b>${esc(c.title)}</b></div>
        <div class="rights-row"><span>Licence</span><b>${esc((c.license && c.license.label) || 'unknown')}</b></div>
        <div class="rights-note">Not cleared under this project's rights policy. AETHER
        does not determine fair use — reviewing this is your decision, and a legal
        one if you are unsure.</div>
        <div class="rights-actions">
          <button class="btn ghost small" data-rights-review="${esc(c.id)}" data-scene="${esc(scene.index)}">Review</button>
          <button class="btn ghost small" data-rights-reject="${esc(c.id)}" data-scene="${esc(scene.index)}">Reject</button>
        </div>
      </div>`);
    }

    return parts.join('');
  }

  // ── Policy selector (spec section 14) ─────────────────────────────────────

  function policySelectorHtml() {
    const L = window.ArchiveLicense;
    if (!L) return '';
    const current = currentPolicy();
    const options = Object.entries(L.POLICIES).map(([key, p]) => `
      <label class="rights-policy-option">
        <input type="radio" name="rights-policy" value="${esc(key)}" ${key === current ? 'checked' : ''} />
        <span><b>${esc(p.label)}</b><br><span class="field-note">${esc(p.note)}</span></span>
      </label>`).join('');

    return `<div class="rights-policy">
      <div class="rights-head">RIGHTS POLICY</div>
      ${options}
      <div class="rights-note" id="rights-policy-warning" ${current === 'editorial_review' ? '' : 'hidden'}>
        ⚠ Editorial candidates may require independent legal review.
        AETHER does not determine fair use.
      </div>
    </div>`;
  }

  function bindPolicySelector(root) {
    (root || document).querySelectorAll('input[name="rights-policy"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        setPolicy(input.value);
        const warn = document.getElementById('rights-policy-warning');
        if (warn) warn.hidden = input.value !== 'editorial_review';
      });
    });
  }

  // ── Review dialog (spec section 17) ───────────────────────────────────────

  /**
   * Ask the user about an uncleared clip.
   *
   * Approval is recorded against the scene with what was shown at the time, so
   * the decision is auditable later. There is no "use anyway" that skips this.
   */
  function reviewCandidate(scene, candidateId) {
    const candidate = (scene.editorialCandidates || []).find((c) => c.id === candidateId);
    if (!candidate) return false;

    const record = window.AttributionManager.editorialUseRecord(candidate, scene);
    const lines = [
      'EDITORIAL CANDIDATE — REVIEW REQUIRED',
      '',
      `Title:   ${candidate.title}`,
      `Licence: ${(candidate.license && candidate.license.label) || 'unknown'}`,
      `Source:  ${candidate.sourceUrl}`,
      ''
    ];
    if (record.purpose) lines.push(`Stated editorial purpose: ${record.purpose}`);
    if (record.selectionReason) lines.push(`Why this footage: ${record.selectionReason}`);
    lines.push(
      '',
      'This clip is NOT cleared under your project\'s rights policy.',
      '',
      'AETHER does not and cannot determine fair use. Fair use depends on the',
      'purpose of your use, the nature of the work, how much you take and the',
      'effect on the market for the original — and shortening a clip or crediting',
      'its creator does not make a use fair.',
      '',
      'Approving this places it in your timeline on your own judgement.',
      'If you are unsure, get legal advice instead of approving.',
      '',
      'Approve this clip for editorial use?'
    );

    // eslint-disable-next-line no-alert
    const approved = window.confirm(lines.join('\n'));
    if (!approved) return false;

    scene.rightsApproval = {
      approved: true,
      at: Date.now(),
      candidateId,
      editorialUse: record,
      // What the user was actually shown, kept so the decision can be audited.
      acknowledged: 'AETHER does not determine fair use; approved on the user\'s own judgement.'
    };
    window.dispatchEvent(new CustomEvent('blvck:rights-approved', { detail: { scene, candidateId } }));
    return true;
  }

  function rejectCandidate(scene, candidateId) {
    scene.editorialCandidates = (scene.editorialCandidates || []).filter((c) => c.id !== candidateId);
    window.dispatchEvent(new CustomEvent('blvck:rights-rejected', { detail: { scene, candidateId } }));
  }

  // ── Source audit before export (spec section 18) ──────────────────────────

  function auditHtml(scenes) {
    const AM = window.AttributionManager;
    if (!AM) return '';
    const report = AM.audit(scenes, currentPolicy());

    const rows = report.rows.map((r) => `
      <tr class="${STATUS_CLASS[r.status] || ''}">
        <td>${esc(String(r.index).padStart(2, '0'))}</td>
        <td>${esc(r.provider === 'archive_org' ? 'Internet Archive' : (r.provider || '—'))}</td>
        <td>${esc(r.title || '')}</td>
        <td>${esc(r.headline)}</td>
      </tr>`).join('');

    const credits = AM.youtubeDescription(scenes);

    return `<div class="rights-audit">
      <div class="rights-head">VIDEO SOURCE AUDIT</div>
      <div style="overflow-x:auto;">
        <table class="rights-audit-table">
          <thead><tr><th>Scene</th><th>Source</th><th>Item</th><th>Rights status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No footage acquired yet.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="rights-status ${report.canExport ? 'rights-ok' : 'rights-bad'}">
        ${report.canExport
          ? '✓ Every scene resolved under the current policy'
          : `✕ ${report.blockers.length} scene(s) unresolved — export blocked until each is cleared, replaced or approved`}
      </div>
      ${credits ? `<div class="rights-head" style="margin-top:12px;">CREDITS FOR YOUR DESCRIPTION</div>
        <textarea class="rights-credits" rows="10" readonly>${esc(credits)}</textarea>
        <button class="btn ghost small" id="rights-copy-credits" type="button">Copy</button>` : ''}
      <div class="rights-note">${esc(report.disclaimer)}</div>
    </div>`;
  }

  /** Whether an export may proceed. The caller must respect a false. */
  function canExport(scenes) {
    if (!window.AttributionManager) return true;
    return window.AttributionManager.audit(scenes, currentPolicy()).canExport;
  }

  function downloadManifest(scenes) {
    const manifest = window.AttributionManager.exportManifest(scenes, currentPolicy());
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'project-attributions.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Delegated so it works on cards rendered after load.
  document.addEventListener('click', (e) => {
    const review = e.target.closest && e.target.closest('[data-rights-review]');
    const reject = e.target.closest && e.target.closest('[data-rights-reject]');
    const copy = e.target.closest && e.target.closest('#rights-copy-credits');

    if (copy) {
      const box = document.querySelector('.rights-credits');
      if (box) { box.select(); navigator.clipboard?.writeText(box.value).catch(() => {}); }
      return;
    }
    if (!review && !reject) return;

    const btn = review || reject;
    const sceneIndex = Number(btn.getAttribute('data-scene'));
    const scenes = (window.BlvckStoryboard && window.BlvckStoryboard.scenes
      && window.BlvckStoryboard.scenes()) || [];
    const scene = scenes.find((s) => s && s.index === sceneIndex);
    if (!scene) return;

    if (review) reviewCandidate(scene, btn.getAttribute('data-rights-review'));
    else rejectCandidate(scene, btn.getAttribute('data-rights-reject'));
  });

  window.RightsUI = {
    currentPolicy,
    setPolicy,
    sceneRightsHtml,
    policySelectorHtml,
    bindPolicySelector,
    reviewCandidate,
    rejectCandidate,
    auditHtml,
    canExport,
    downloadManifest
  };
})();
