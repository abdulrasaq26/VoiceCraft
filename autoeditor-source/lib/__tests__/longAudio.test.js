import { describe, it, expect } from "vitest";
import { planWindows, windowRms, segmentsToWords, isNoiseText, SAMPLE_RATE } from "../captions/long-audio.js";

// Speech-like noise with a silent gap every `every` seconds.
function speechWithPauses(totalSec, every = 7, gapSec = 0.4) {
  const a = new Float32Array(Math.round(totalSec * SAMPLE_RATE));
  let seed = 1;
  for (let i = 0; i < a.length; i++) {
    const t = i / SAMPLE_RATE;
    const inGap = t % every > every - gapSec;
    seed = (seed * 16807) % 2147483647;
    a[i] = inGap ? 0 : (seed / 2147483647 - 0.5) * 0.8;
  }
  return a;
}

describe("planWindows", () => {
  it("returns one window for short audio", () => {
    const a = new Float32Array(10 * SAMPLE_RATE);
    expect(planWindows(a)).toEqual([{ start: 0, end: a.length }]);
  });

  it("covers long audio contiguously with windows under the limit", () => {
    const a = speechWithPauses(7 * 60);
    const w = planWindows(a, { maxSec: 28 });
    expect(w[0].start).toBe(0);
    expect(w[w.length - 1].end).toBe(a.length);
    for (let i = 0; i < w.length; i++) {
      expect(w[i].end - w[i].start).toBeLessThanOrEqual(28 * SAMPLE_RATE);
      expect(w[i].end).toBeGreaterThan(w[i].start);
      if (i > 0) expect(w[i].start).toBe(w[i - 1].end);
    }
    expect(w.length).toBeGreaterThanOrEqual(15);
  });

  it("cuts inside a pause rather than through speech", () => {
    // A pause every 4.3s guarantees one lies fully inside each 6s search range.
    const a = speechWithPauses(120, 4.3, 0.5);
    for (const { end } of planWindows(a).slice(0, -1)) {
      expect(Math.abs(a[end])).toBe(0);
    }
  });
});

describe("windowRms", () => {
  it("is zero for silence and positive for signal", () => {
    expect(windowRms(new Float32Array(1600), 0, 1600)).toBe(0);
    expect(windowRms(speechWithPauses(2), 0, SAMPLE_RATE)).toBeGreaterThan(0.1);
  });
});

describe("segmentsToWords", () => {
  it("offsets words onto the global timeline and spreads them across the segment", () => {
    const words = segmentsToWords([{ text: " Hello there world", timestamp: [1, 4] }], 60, 28);
    expect(words.map((w) => w.text)).toEqual(["Hello", "there", "world"]);
    expect(words[0].start).toBe(61);
    expect(words[2].end).toBeCloseTo(64, 3);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeCloseTo(words[i - 1].end, 3);
  });

  it("fills a missing end timestamp from the next segment or window end", () => {
    const words = segmentsToWords([
      { text: "one", timestamp: [0, null] },
      { text: "two", timestamp: [5, null] },
    ], 0, 20);
    expect(words[0].end).toBe(5);
    expect(words[1].end).toBe(20);
  });

  it("clamps runaway timestamps to the window", () => {
    const words = segmentsToWords([{ text: "late", timestamp: [25, 90] }], 100, 28);
    expect(words[0].end).toBe(128);
  });

  it("drops Whisper's non-speech placeholders", () => {
    expect(isNoiseText("[BLANK_AUDIO]")).toBe(true);
    expect(isNoiseText(" (music) ")).toBe(true);
    expect(isNoiseText("Real words.")).toBe(false);
    expect(segmentsToWords([{ text: "[BLANK_AUDIO]", timestamp: [0, 3] }], 0, 28)).toEqual([]);
  });
});
