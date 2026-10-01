import { describe, it, expect } from "vitest";
import {
  CAPTION_STYLE_LIST, resolveCaptionStyle, normalizeStyleId, effectiveStyleValues,
} from "../captions/caption-style-manager.js";
import { CAPTION_ANIMATIONS, computeCaptionFrame, activeWordIndex } from "../captions/caption-animation-engine.js";
import { wordsFor, retext, retime, merge, distributeWords } from "../captions/word-aligner.js";
import { toSRT, toVTT } from "../captions/caption-exporter.js";
import { drawCaption, SAMPLE_CAPTION } from "../captions/caption-renderer.js";

const cap = SAMPLE_CAPTION;

describe("style library", () => {
  it("has the requested presets, each genuinely different", () => {
    const names = CAPTION_STYLE_LIST.map((s) => s.name);
    for (const n of ["Minimal", "Clean", "Documentary", "Cinematic", "Bold", "Social Media", "Highlight",
      "Typewriter", "Modern", "Boxed", "Lower Third", "Large Centered", "Karaoke"]) {
      expect(names).toContain(n);
    }
    // No two presets share font + size + colour + background + position.
    const sig = CAPTION_STYLE_LIST.map((s) => [s.font, s.size, s.color, s.background.mode, s.position, s.align, s.uppercase].join("|"));
    expect(new Set(sig).size).toBe(sig.length);
  });

  it("maps legacy style ids from older projects", () => {
    expect(normalizeStyleId("classic")).toBe("clean");
    expect(normalizeStyleId("boxed")).toBe("boxed");
    expect(normalizeStyleId("yellow")).toBe("yellow");
    expect(normalizeStyleId("nonsense")).toBe("clean");
  });

  it("applies size, line spacing and every customisation override", () => {
    const base = resolveCaptionStyle("clean");
    expect(resolveCaptionStyle("clean", { size: "lg" }).size).toBeGreaterThan(base.size);
    expect(resolveCaptionStyle("clean", { fontScale: 0.08 }).size).toBe(0.08);
    expect(resolveCaptionStyle("clean", { lineHeight: 1.7 }).lineHeight).toBe(1.7);
    const s = resolveCaptionStyle("clean", {
      overrides: {
        font: "georgia", weight: 400, uppercase: true, color: "#ff0000", activeColor: "#00ff00",
        strokeWidth: 0, shadow: false, bgColor: "#123456", bgOpacity: 0.5, position: "top", offset: 0.2,
        align: "left", letterSpacing: 0.1, maxWordsPerLine: 3,
      },
    });
    expect(s).toMatchObject({
      font: "georgia", weight: 400, uppercase: true, color: "#ff0000", activeColor: "#00ff00",
      stroke: null, shadow: null, position: "top", offset: 0.2, align: "left", letterSpacing: 0.1, maxWordsPerLine: 3,
    });
    expect(s.background).toMatchObject({ color: "#123456", opacity: 0.5 });
    expect(resolveCaptionStyle("boxed", { overrides: { bgOpacity: 0 } }).background.mode).toBe("none");
  });

  it("does not mutate the preset when overriding", () => {
    resolveCaptionStyle("boxed", { overrides: { bgColor: "#ff00ff" } });
    expect(resolveCaptionStyle("boxed").background.color).toBe("#000000");
  });

  it("reports effective values for the Customize controls", () => {
    const v = effectiveStyleValues("boxed", {});
    expect(v.bgOpacity).toBeGreaterThan(0);
    expect(effectiveStyleValues("clean", {}).bgOpacity).toBe(0);
  });
});

describe("animation engine", () => {
  const words = wordsFor(cap);

  it("finds the spoken word from word timestamps", () => {
    expect(activeWordIndex(words, -1)).toBe(-1);
    expect(activeWordIndex(words, 0.4)).toBe(1);   // "is"
    expect(activeWordIndex(words, 1.0)).toBe(3);   // "people"
  });

  it("every animation produces a frame at every time", () => {
    for (const a of CAPTION_ANIMATIONS) {
      for (const t of [0, 0.1, 0.7, 1.5, 2.3]) {
        const f = computeCaptionFrame(cap, words, t, a.id);
        expect(f.words).toHaveLength(words.length);
        expect(f.alpha).toBeGreaterThanOrEqual(0);
        expect(f.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("highlights exactly the spoken word", () => {
    const f = computeCaptionFrame(cap, words, 1.0, "word-highlight");
    expect(f.words.map((w) => w.highlight)).toEqual([false, false, false, true, false]);
  });

  it("karaoke fills the spoken word progressively", () => {
    const f = computeCaptionFrame(cap, words, 1.175, "karaoke"); // half-way through "people"
    expect(f.words[2].fill).toBe(1);
    expect(f.words[3].fill).toBeCloseTo(0.5, 1);
    expect(f.words[4].fill).toBe(0);
  });

  it("typewriter reveals words as they are spoken", () => {
    const f = computeCaptionFrame(cap, words, 0.6, "typewriter");
    expect(f.words[0].chars).toBe(Infinity);
    expect(f.words[2].chars).toBeGreaterThan(0);
    expect(f.words[4].chars).toBe(0);
  });

  it("text animations ease in at the start", () => {
    expect(computeCaptionFrame(cap, words, 0, "fade-in").alpha).toBe(0);
    expect(computeCaptionFrame(cap, words, 1, "fade-in").alpha).toBe(1);
    expect(computeCaptionFrame(cap, words, 0.02, "slide-up").dy).toBeGreaterThan(0);
    expect(computeCaptionFrame(cap, words, 0.02, "scale-in").scale).toBeLessThan(1);
    expect(computeCaptionFrame(cap, words, cap.end - 0.001, "fade-out").alpha).toBeLessThan(0.1);
  });
});

describe("word aligner", () => {
  it("estimates timings for captions without words (imported SRT)", () => {
    const w = wordsFor({ start: 2, end: 4, text: "a longer word" });
    expect(w).toHaveLength(3);
    expect(w[0].start).toBe(2);
    expect(w[2].end).toBeCloseTo(4, 3);
    expect(w[1].end - w[1].start).toBeGreaterThan(w[0].end - w[0].start);
  });

  it("keeps real timings when an edit keeps the word count", () => {
    const c = retext(cap, "This is how folks lived");
    expect(c.words[3]).toMatchObject({ text: "folks", start: 0.9, end: 1.45 });
  });

  it("re-spreads timings when the word count changes", () => {
    const c = retext(cap, "Short now");
    expect(c.words).toHaveLength(2);
    expect(c.words[1].end).toBeCloseTo(cap.end, 3);
  });

  it("scales word timings when a caption is retimed", () => {
    const c = retime(cap, 10, 14.8);
    expect(c.start).toBe(10);
    expect(c.words[0].start).toBe(10);
    expect(c.words[4].end).toBeCloseTo(14.2, 2);
  });

  it("merges neighbouring captions", () => {
    const m = merge({ id: "a", start: 0, end: 1, text: "one two" }, { id: "b", start: 1, end: 2, text: "three" });
    expect(m.text).toBe("one two three");
    expect(m.end).toBe(2);
    expect(distributeWords(["x"], 0, 1)[0]).toMatchObject({ start: 0, end: 1 });
  });
});

describe("caption exporter", () => {
  const caps = [{ start: 1.5, end: 3.25, text: "Hello there" }, { start: 3725.1, end: 3726, text: "Later" }];
  it("writes SRT", () => {
    expect(toSRT(caps)).toBe("1\n00:00:01,500 --> 00:00:03,250\nHello there\n\n2\n01:02:05,100 --> 01:02:06,000\nLater\n");
  });
  it("writes VTT", () => {
    expect(toVTT(caps)).toMatch(/^WEBVTT\n\n00:00:01\.500 --> 00:00:03\.250\nHello there\n/);
  });
});

describe("renderer", () => {
  // A recording 2D context: enough of the canvas API for the renderer.
  function mockCtx() {
    const calls = [];
    const ctx = {
      calls, globalAlpha: 1, font: "", letterSpacing: "0px",
      save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, moveTo() {}, arcTo() {},
      closePath() {}, rect() {}, clip() {}, fill() { calls.push(["fill", this.fillStyle]); }, fillRect() { calls.push(["fillRect"]); },
      measureText: (t) => ({ width: t.length * 10 }),
      fillText(t) { calls.push(["fillText", t, this.fillStyle]); },
      strokeText(t) { calls.push(["strokeText", t]); },
    };
    return ctx;
  }

  it("draws every style with every animation without throwing", () => {
    for (const st of CAPTION_STYLE_LIST) {
      for (const a of CAPTION_ANIMATIONS) {
        drawCaption(mockCtx(), cap, 1.0, 1920, 1080, { styleId: st.id, animationId: a.id });
      }
    }
  });

  it("colours the spoken word for active-color, and only that word", () => {
    const ctx = mockCtx();
    drawCaption(ctx, cap, 1.0, 1920, 1080, { styleId: "documentary", animationId: "active-color" });
    const fills = ctx.calls.filter((c) => c[0] === "fillText");
    expect(fills.find((c) => c[1] === "people")[2]).toBe("#ffd36b");
    expect(fills.find((c) => c[1] === "This")[2]).toBe("#f5f1e8");
  });

  it("keeps highlighted words readable on a light pill", () => {
    const ctx = mockCtx();
    drawCaption(ctx, cap, 1.0, 1920, 1080, { styleId: "clean", animationId: "word-highlight" });
    const fills = ctx.calls.filter((c) => c[0] === "fillText");
    expect(fills.find((c) => c[1] === "people")[2]).toBe("#111114"); // dark text on the white pill
    expect(fills.find((c) => c[1] === "lived")[2]).toBe("#ffffff");
  });

  it("uppercases for capital styles and pages word-limited styles", () => {
    const ctx = mockCtx();
    drawCaption(ctx, cap, 1.0, 1920, 1080, { styleId: "social", animationId: "none" });
    const texts = ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
    expect(texts.every((t) => t === t.toUpperCase())).toBe(true);
    expect(texts).toContain("PEOPLE");
  });
});
