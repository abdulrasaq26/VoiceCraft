// Puter connection banner. The #1 reason "nothing AI works" on a deployed app
// is that the Puter session isn't established — the user isn't signed in, the
// auth popup was blocked, or the SDK couldn't load. This surfaces that clearly
// and offers a one-click Sign in, instead of every feature failing silently.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const banner = $('ai-status-banner');
  if (!banner || !window.BlvckAI) return;

  const titleEl = $('ai-status-title');
  const detailEl = $('ai-status-detail');
  const signinBtn = $('ai-status-signin');
  const diagBtn = $('ai-status-diag');
  const dismissBtn = $('ai-status-dismiss');
  const badge = $('ai-settings-open');

  let dismissed = false;
  let connected = false;
  let checking = false;

  function show(title, detail) {
    titleEl.textContent = title;
    detailEl.textContent = detail;
    banner.hidden = false;
  }
  function hide() { banner.hidden = true; }
  function setBadge(ok) {
    if (!badge) return;
    badge.textContent = ok ? '⚡ Puter AI ✓' : '⚡ Puter AI ⚙';
    badge.classList.toggle('connected', ok);
  }

  // Inspect the Puter connection and reflect it in the banner + badge.
  // fromUser=true forces the banner even if previously dismissed.
  async function check({ fromUser = false } = {}) {
    if (checking) return;
    checking = true;
    try {
      const st = await window.BlvckAI.status();
      // signedIn === null means the SDK is too old to report it — treat as OK
      // (calls will still work / prompt as needed), same as the diagnostics.
      if (st.sdk && st.signedIn !== false) {
        connected = true;
        setBadge(true);
        hide();
        return st;
      }
      connected = false;
      setBadge(false);
      if (dismissed && !fromUser) return st;
      if (!st.sdk) {
        signinBtn.textContent = 'Retry connection';
        show('AI can’t reach Puter',
          (st.error || 'The Puter SDK could not load.') + ' Check your connection or network policy, then retry.');
      } else {
        signinBtn.textContent = 'Sign in to Puter';
        show('Sign in to Puter to enable AI',
          'Scripts, voice, images, video and the agent all run through your Puter account. Sign in once to connect.');
      }
      return st;
    } finally {
      checking = false;
    }
  }

  signinBtn.addEventListener('click', async () => {
    signinBtn.disabled = true;
    const restore = signinBtn.textContent;
    signinBtn.textContent = 'Connecting…';
    try {
      await window.BlvckAI.signIn({ attempt_temp_user_creation: true });
      dismissed = false;
      await check({ fromUser: true });
      if (connected) {
        // Warm the model list and let dependent UIs refresh under the new session.
        try { await window.BlvckAI.listModels(true); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('blvck:puter-ready'));
        window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
      }
    } catch (e) {
      show('Sign-in didn’t complete',
        (e && e.message) || 'Could not sign in to Puter. If a popup was blocked, allow popups for this site and try again.');
    } finally {
      signinBtn.disabled = false;
      if (signinBtn.textContent === 'Connecting…') signinBtn.textContent = restore;
    }
  });

  // Open the diagnostics modal (its trigger lives inside AI settings, but the
  // button itself works even while hidden).
  diagBtn.addEventListener('click', () => { const d = $('ai-diagnostics-open'); if (d) d.click(); });
  dismissBtn.addEventListener('click', () => { dismissed = true; hide(); });

  // Re-check on the moments that matter: opening AI settings, a live auth
  // failure, or returning to the tab after signing in elsewhere.
  const settingsBtn = $('ai-settings-open');
  if (settingsBtn) settingsBtn.addEventListener('click', () => check());
  window.addEventListener('blvck:ai-auth-error', () => { dismissed = false; check(); });
  window.addEventListener('focus', () => { if (!connected) check(); });

  window.BlvckAIStatus = { check, isConnected: () => connected };

  // Initial check shortly after load — the SDK is loaded lazily, so this both
  // detects the connection and kicks off SDK loading in the background.
  setTimeout(() => check(), 800);
})();
