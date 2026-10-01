// content/ui/vc-theme.js
//
// The studio's design tokens and scrollbar style for the extension's panels
// (Downloader, Automator, Prompt Recovery). They live in shadow roots, which
// page styles can't reach, so each one puts this at the top of its CSS.
// Values match public/studio-tokens.css.
(function () {
  if (window.VC_THEME_CSS) return;
  window.VC_THEME_CSS = `
:host {
  color-scheme: dark;
  --vc-background: #0d0d0f; --vc-surface: #161619; --vc-surface-elevated: #202026; --vc-surface-sunken: #0b0b0d;
  --vc-border: #2c2c33; --vc-border-soft: #232329;
  --vc-primary: #6366f1; --vc-primary-hover: #5558e8; --vc-primary-soft: rgba(99,102,241,.16); --vc-primary-text: #c7c9ff;
  --vc-accent: #e8b64c; --vc-accent-hover: #f2c766;
  --vc-text: #f2f2f4; --vc-text-muted: #9b9ba3; --vc-text-faint: #62626c;
  --vc-success: #6cc98f; --vc-warning: #e8b64c; --vc-danger: #e06c6c; --vc-error: #e06c6c;
  --vc-radius-sm: 7px; --vc-radius: 10px; --vc-radius-lg: 14px;
  --vc-font: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  --vc-mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
  --vc-scroll-thumb: rgba(255,255,255,.13); --vc-scroll-thumb-hover: rgba(255,255,255,.24); --vc-scroll-thumb-active: rgba(99,102,241,.7);
}
::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background-color: var(--vc-scroll-thumb); border-radius: 999px; border: 3px solid transparent; background-clip: padding-box; min-height: 32px; }
::-webkit-scrollbar-thumb:hover { background-color: var(--vc-scroll-thumb-hover); }
::-webkit-scrollbar-thumb:active { background-color: var(--vc-scroll-thumb-active); }
::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
`;
})();
