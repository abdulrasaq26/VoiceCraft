"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { transitionOf } from "../lib/transitions";

// Horizontal zoom: 1 = the whole timeline fits the visible width. `null`
// means "auto" — the legacy per-clip minimum width, until the user zooms.
const ZOOM_KEY = "autoeditor.tlzoom.v1";
const ZOOM_STEP = 1.35;
const ZOOM_MAX_FLOOR = 8;

function label(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Filename without its extension, for the clip caption.
function stem(name) {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function Waveform({ peaks }) {
  if (!peaks || !peaks.length) return <div className="wave wave--empty" />;
  const n = peaks.length;
  return (
    <svg className="wave" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((p, i) => {
        const h = Math.max(1.5, p * 92);
        return <rect key={i} x={i + 0.12} y={(100 - h) / 2} width={0.76} height={h} rx={0.3} />;
      })}
    </svg>
  );
}

// The signature element: a scrubbable track with a fixed label gutter. Clips,
// waveform, playhead and click-to-seek all share the track's coordinate space.
export default function Timeline({
  clips, imageEls, duration, time, peaks, activeName, badClips,
  transitionsByName, motionByName, selectedName, onSelect,
  onSeek, onScrubStart, onScrubEnd, onOpen, onAdd, onDeleteGap, onResizeBoundary,
  trimEnd, onTrimChange, height, playing,
}) {
  const trackRef = useRef(null);
  const scrollRef = useRef(null);
  const downRef = useRef(null); // pointer-down position, to tell a clip tap from a drag

  // ---- Zoom ------------------------------------------------------------
  const [viewW, setViewW] = useState(0); // visible content width of the scroller
  const [zoom, setZoomState] = useState(null);
  useEffect(() => {
    try {
      const z = parseFloat(localStorage.getItem(ZOOM_KEY));
      if (isFinite(z) && z >= 1) setZoomState(z);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Legacy auto width: a readable minimum per clip, so dense timelines scroll
  // instead of crushing clips into slivers.
  const autoW = clips.length ? 30 + clips.length * 72 : 0;
  const autoZoom = viewW ? Math.max(1, autoW / viewW) : 1;
  const zoomEff = zoom == null ? autoZoom : zoom;
  const zoomMax = Math.max(ZOOM_MAX_FLOOR, autoZoom * 4);
  const rowW = viewW ? Math.round(viewW * zoomEff) : autoW;

  // Keep the point under `anchorX` (client px) fixed while zooming.
  const anchorRef = useRef(null);
  const setZoom = useCallback((next, anchorX) => {
    const el = scrollRef.current;
    const z = Math.min(Math.max(next, 1), zoomMax);
    if (el) {
      const r = el.getBoundingClientRect();
      const ax = anchorX == null ? r.width / 2 : anchorX - r.left;
      anchorRef.current = { ratio: (el.scrollLeft + ax) / Math.max(1, el.scrollWidth), ax };
    }
    setZoomState(z);
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* ignore */ }
  }, [zoomMax]);
  useLayoutEffect(() => {
    const a = anchorRef.current, el = scrollRef.current;
    if (!a || !el) return;
    anchorRef.current = null;
    el.scrollLeft = a.ratio * el.scrollWidth - a.ax;
  }, [rowW]);

  // Zoom buttons anchor on the playhead when it's on screen, else the centre.
  const playheadClientX = useCallback(() => {
    const el = scrollRef.current, tr = trackRef.current;
    if (!el || !tr || !duration) return null;
    const tb = tr.getBoundingClientRect(), vb = el.getBoundingClientRect();
    const x = tb.left + (time / duration) * tb.width;
    return x >= vb.left && x <= vb.right ? x : null;
  }, [time, duration]);
  const zoomIn = () => setZoom(zoomEff * ZOOM_STEP, playheadClientX());
  const zoomOut = () => setZoom(zoomEff / ZOOM_STEP, playheadClientX());
  const zoomFit = () => setZoom(1, null);

  // Ctrl/⌘ + wheel zooms at the cursor; plain wheel scrolls horizontally.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(zoomEff * Math.exp(-e.deltaY * 0.0022), e.clientX);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom, zoomEff]);

  // During playback, page the view forward when the playhead runs off the
  // right edge — only while playing, so it never fights manual scrolling.
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current, tr = trackRef.current;
    if (!el || !tr || !duration) return;
    const x = tr.offsetLeft + (time / duration) * tr.offsetWidth;
    if (x > el.scrollLeft + el.clientWidth - 24 || x < el.scrollLeft) {
      el.scrollLeft = Math.max(0, x - 40);
    }
  }, [time, playing, duration]);

  // Scrub the playhead. Reference the track's box for x/width; the ruler and
  // audio lane are horizontally aligned with it, so this works for all three.
  const seekAt = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el || !duration) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    onSeek((x / r.width) * duration);
  }, [duration, onSeek]);

  const onScrubDown = useCallback((e) => {
    if (onScrubStart) onScrubStart();
    seekAt(e.clientX);
    const move = (ev) => seekAt(ev.clientX);
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      seekAt(ev.clientX); // make sure the final release position is applied
      if (onScrubEnd) onScrubEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [seekAt, onScrubStart, onScrubEnd]);

  const MIN_TRIM = 1;      // never allow a zero-length export
  const SNAP_PX = 8;       // snap to a clip boundary within this many pixels

  const trimAt = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el || !duration || !onTrimChange) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    let secs = (x / r.width) * duration;

    // Snap to the nearest clip start/end boundary when the pointer is close.
    const snapSecs = (SNAP_PX / r.width) * duration;
    let best = null, bestD = snapSecs;
    for (const c of clips) {
      for (const edge of [c.start, c.start + c.duration]) {
        const d = Math.abs(edge - secs);
        if (d <= bestD) { bestD = d; best = edge; }
      }
    }
    if (best != null) secs = best;

    secs = Math.min(Math.max(secs, MIN_TRIM), duration);
    onTrimChange(+secs.toFixed(3));
  }, [duration, clips, onTrimChange]);

  const onTrimDown = useCallback((e) => {
    e.stopPropagation();
    trimAt(e.clientX);
    const move = (ev) => trimAt(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [trimAt]);

  const MIN_CLIP = 0.3; // never let a clip collapse below this many seconds
  const [drag, setDrag] = useState(null); // { index, sec } during a right-edge resize

  // Map a pointer x to the clamped boundary between clip i and clip i+1.
  const boundaryAt = useCallback((clientX, i) => {
    const el = trackRef.current;
    if (!el || !duration) return null;
    const a = clips[i], b = clips[i + 1];
    if (!a || !b) return null;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    const secs = (x / r.width) * duration;
    const lo = a.start + MIN_CLIP;
    const hi = (b.start + b.duration) - MIN_CLIP;
    return Math.min(Math.max(secs, lo), Math.max(lo, hi));
  }, [duration, clips]);

  const onResizeDown = useCallback((e, i) => {
    e.stopPropagation();
    setDrag({ index: i, sec: clips[i + 1].start });
    const move = (ev) => {
      const s = boundaryAt(ev.clientX, i);
      if (s != null) setDrag({ index: i, sec: s });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const s = boundaryAt(ev.clientX, i);
      setDrag(null);
      // Only commit a real change, so a plain click on the grip adds no history.
      if (s != null && onResizeBoundary && Math.abs(s - clips[i + 1].start) > 0.001) {
        onResizeBoundary(clips[i + 1].name, s);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [boundaryAt, clips, onResizeBoundary]);

  // A clip opens the inspector only on a clean tap, not a drag/scroll.
  const onClipClick = useCallback((name, e) => {
    const d = downRef.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && onOpen) onOpen(name);
  }, [onOpen]);

  const pct = (v) => `${Math.min(100, (v / duration) * 100)}%`;
  const stop = (e) => e.stopPropagation();

  const trimPos = trimEnd > 0 && trimEnd < duration ? trimEnd : duration;
  const trimmed = trimPos < duration;

  // Ruler density follows the zoom: aim for a label roughly every 90px.
  const pxPerSec = duration ? (rowW - 30) / duration : 0;
  const niceSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = pxPerSec
    ? niceSteps.find((s) => s * pxPerSec >= 90) || 600
    : duration > 180 ? 30 : duration > 90 ? 15 : duration > 30 ? 10 : 5;
  const ticks = [];
  for (let t = 0; t <= duration + 0.001; t += step) ticks.push(Math.round(t));

  const zoomSlider = Math.round((Math.log(zoomEff) / Math.log(zoomMax)) * 1000);
  const imageCount = clips.filter((c) => !c.gap).length;

  return (
    <div className="tlwrap" style={height ? { height } : undefined}>
      <div className="tlbar">
        <span className="tlbar__title">Timeline</span>
        <span className="tlbar__meta">
          {imageCount} clip{imageCount === 1 ? "" : "s"} · {label(duration)}
        </span>
        <span className="tlbar__spacer" />
        <div className="tlzoom" role="group" aria-label="Timeline zoom">
          <button type="button" className="tlzoom__btn" onClick={zoomOut} disabled={zoomEff <= 1.001} title="Zoom out (Ctrl + scroll)" aria-label="Zoom out">−</button>
          <input
            type="range" className="tlzoom__range" min={0} max={1000} value={zoomSlider}
            onChange={(e) => setZoom(Math.exp((+e.target.value / 1000) * Math.log(zoomMax)), playheadClientX())}
            aria-label="Timeline zoom level"
          />
          <button type="button" className="tlzoom__btn" onClick={zoomIn} disabled={zoomEff >= zoomMax - 0.001} title="Zoom in (Ctrl + scroll)" aria-label="Zoom in">+</button>
          <button type="button" className="tlzoom__fit" onClick={zoomFit} title="Fit the whole timeline in view">Fit</button>
        </div>
      </div>
    <div className="tl" ref={scrollRef} style={{ "--tl-min": `${rowW}px` }}>
      <div className="tl__row tl__row--ruler">
        <div className="tl__gutter" aria-hidden="true" />
        <div className="tl__ruler tl__scrub" onPointerDown={onScrubDown} title="Drag to move the playhead">
          {ticks.map((t) => (
            <span className="tl__tick" key={t} style={{ left: pct(t) }}>
              <i className="tl__tickline" />
              {label(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="tl__row tl__row--cuts">
        <div className="tl__gutter" aria-hidden="true" />
        <div className="tl__cuts">
          {clips.map((c, i) => {
            if (i === 0) return null;
            const tr = transitionOf(transitionsByName && transitionsByName[c.name]);
            const cls = ["cut"];
            if (selectedName === c.name) cls.push("is-sel");
            if (tr.xfade) cls.push("is-on");
            return (
              <button
                key={c.name}
                type="button"
                className={cls.join(" ")}
                style={{ left: pct(c.start) }}
                title={`Transition: ${tr.label} — click to change`}
                onPointerDown={stop}
                onClick={() => onSelect && onSelect(c.name)}
              >
                {tr.icon}
              </button>
            );
          })}
        </div>
      </div>

      <div className="tl__row tl__row--lanes">
        <div className="tl__gutter">
          <span className="tl__tag">V</span>
          <span className="tl__tag tl__tag--audio">A</span>
        </div>

        <div className="tl__track" ref={trackRef}>
          <div className="tl__lane tl__lane--video">
            {clips.map((c, i) => {
              let cStart = c.start, cDur = c.duration;
              if (drag) {
                if (i === drag.index) cDur = drag.sec - c.start;
                else if (i === drag.index + 1) { cStart = drag.sec; cDur = (c.start + c.duration) - drag.sec; }
              }
              const style = { left: pct(cStart), width: pct(cDur) };

              if (c.gap) {
                return (
                  <div
                    key={c.name}
                    className="clip clip--gap"
                    style={style}
                    title={`Empty · ${label(cStart)} · ${cDur.toFixed(1)}s`}
                  >
                    <button
                      type="button" className="clip__add" title="Add an image here"
                      onPointerDown={stop} onClick={() => onAdd && onAdd(c.name)}
                    >
                      <span className="clip__plus">+</span>
                      <span className="clip__meta clip__meta--gap">{cDur.toFixed(1)}s</span>
                    </button>
                    {onDeleteGap && (
                      <button
                        type="button" title="Delete gap (stretch previous clip)"
                        onPointerDown={stop} onClick={() => onDeleteGap(c.name)}
                        style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(224, 108, 108, 0.9)', border: 'none', borderRadius: '50%', width: '20px', height: '20px', color: '#fff', cursor: 'pointer', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', lineHeight: 1 }}
                      >✕</button>
                    )}
                  </div>
                );
              }

              const el = imageEls[c.name];
              const cls = ["clip"];
              if (c.name === activeName) cls.push("is-active");
              if (c.name === selectedName) cls.push("is-selected");
              if (badClips && badClips.has(c.name)) cls.push("is-bad");
              const fname = el && el.fileName ? stem(el.fileName) : "";
              return (
                <div
                  key={c.name}
                  className={cls.join(" ")}
                  style={{ ...style, backgroundImage: el && el.url ? `url(${el.url})` : undefined }}
                  title={`${el && el.fileName ? el.fileName + " · " : ""}${label(cStart)} · ${cDur.toFixed(1)}s — click to preview / replace`}
                  onPointerDown={(e) => { downRef.current = { x: e.clientX, y: e.clientY }; }}
                  onClick={(e) => onClipClick(c.name, e)}
                >
                  <span className="clip__meta">{cDur.toFixed(1)}s</span>
                  {el && el.isVideo && (
                    <span className="clip__video" title="Video clip">▶</span>
                  )}
                  {motionByName && motionByName[c.name] && motionByName[c.name] !== "none" && (
                    <span className="clip__motion" title={motionByName[c.name] === "zoomout" ? "Zoom out" : "Zoom in"}>
                      {motionByName[c.name] === "zoomout" ? "⤡" : "⤢"}
                    </span>
                  )}
                  {fname && <span className="clip__name">{fname}</span>}
                  {i < clips.length - 1 && (
                    <span
                      className="clip__resize"
                      title="Drag to change how long this image holds"
                      onPointerDown={(e) => onResizeDown(e, i)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="tl__lane tl__lane--audio tl__scrub" onPointerDown={onScrubDown}>
            <Waveform peaks={peaks} />
          </div>

          <div className="tl__playhead" style={{ left: pct(time) }}>
            <span className="tl__playhead-grip" />
          </div>

          {trimmed && (
            <div
              className="tl__trim-shade"
              style={{ left: pct(trimPos), width: pct(duration - trimPos) }}
              aria-hidden="true"
            />
          )}
          <div
            className="tl__trim"
            style={{ left: pct(trimPos) }}
            onPointerDown={onTrimDown}
            title="Drag to set where the export ends"
            role="slider"
            aria-label="Export end"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(trimPos)}
          >
            <span className="tl__trim-grip" />
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
