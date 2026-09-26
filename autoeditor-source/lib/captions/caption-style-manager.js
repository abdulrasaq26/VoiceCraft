/**
 * Phase 8 — Caption Style Library
 * Defines the data-driven visual style presets.
 */

export const CAPTION_STYLES = {
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    typography: { fontFamily: 'Inter', fontSize: 48, fontWeight: 500, letterSpacing: 0, lineHeight: 1.1 },
    appearance: { textColor: '#ffffff', backgroundColor: 'transparent', outlineWidth: 0, shadow: true },
    layout: { alignment: 'center', position: 'bottom-center', maxWidth: 0.85 },
    animation: { entrance: 'fade', active: 'none', exit: 'fade' }
  },
  documentary: {
    id: 'documentary',
    name: 'Documentary',
    typography: { fontFamily: 'Inter', fontSize: 64, fontWeight: 700, letterSpacing: 0, lineHeight: 1.1 },
    appearance: { textColor: '#ffffff', backgroundColor: 'transparent', outlineWidth: 0, shadow: true },
    layout: { alignment: 'center', position: 'bottom-center', maxWidth: 0.85 },
    animation: { entrance: 'fade', active: 'none', exit: 'fade' }
  },
  boldsocial: {
    id: 'boldsocial',
    name: 'Bold Social',
    typography: { fontFamily: 'Oswald, Impact, sans-serif', fontSize: 82, fontWeight: 900, letterSpacing: 1, lineHeight: 1.0 },
    appearance: { textColor: '#ffffff', backgroundColor: 'transparent', outlineWidth: 3, shadow: true },
    layout: { alignment: 'center', position: 'center', maxWidth: 0.90 },
    animation: { entrance: 'pop', active: 'none', exit: 'none' }
  },
  boxed: {
    id: 'boxed',
    name: 'Boxed',
    typography: { fontFamily: 'Inter', fontSize: 54, fontWeight: 600, letterSpacing: 0, lineHeight: 1.2 },
    appearance: { textColor: '#ffffff', backgroundColor: 'rgba(0,0,0,0.8)', outlineWidth: 0, shadow: false },
    layout: { alignment: 'center', position: 'bottom-center', maxWidth: 0.80 },
    animation: { entrance: 'slide-up', active: 'none', exit: 'slide-down' }
  },
  cinematic: {
    id: 'cinematic',
    name: 'Cinematic',
    typography: { fontFamily: 'Times New Roman, serif', fontSize: 50, fontWeight: 400, letterSpacing: 2, lineHeight: 1.2 },
    appearance: { textColor: '#ffeedd', backgroundColor: 'transparent', outlineWidth: 0, shadow: true },
    layout: { alignment: 'center', position: 'bottom-center', maxWidth: 0.75 },
    animation: { entrance: 'fade', active: 'none', exit: 'fade' }
  }
};

export function getCaptionStyle(styleId) {
  return CAPTION_STYLES[styleId] || CAPTION_STYLES.documentary;
}
