"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CaptionPreview from "./CaptionPreview";
import {
  CAPTION_STYLE_LIST, CAPTION_FONTS, effectiveStyleValues, getCaptionStyle,
} from "../lib/captions/caption-style-manager.js";
import { CAPTION_ANIMATIONS } from "../lib/captions/caption-animation-engine.js";
import { retext, retime, merge } from "../lib/captions/word-aligner.js";
import { generateCaptionId } from "../lib/captions/caption-normalizer.js";

function stamp(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

// <input type=color> only takes #rrggbb.
function toHex(c) {
  if (!c) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("");
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("");
  return "#000000";
}

const ANIM_GROUPS = ["Word", "Text", "Static"];

export default function CaptionPanel({
  captionCues, captionsOn, setCaptionsOn,
  captionStyle, setCaptionStyle, captionAnimation, setCaptionAnimation,
  captionSize, setCaptionSize, captionFontScale, setCaptionFontScale,
  captionLineHeight, setCaptionLineHeight, captionOverrides, setCaptionOverrides,
  captionOpts, setCaptionsTrack, removeCaptions, onExportCaptions,
  captionName, captionError, generatingCaptions, genCapStatus, onGenerateCaptions,
  onPickFile, time, onSeek, selectedCaptionId, setSelectedCaptionId,
}) {
  const [hoverStyle, setHoverStyle] = useState(null);
  const listRef = useRef(null);
  const editingRef = useRef(false);
  const eff = useMemo(() => effectiveStyleValues(captionStyle, captionOpts), [captionStyle, captionOpts]);
  const customized = Object.keys(captionOverrides || {}).length > 0 || captionFontScale != null || captionLineHeight != null;

  const setOverride = (patch) => setCaptionOverrides((o) => ({ ...(o || {}), ...patch }));

  const pickStyle = (id) => {
    // A preset is a complete look: drop per-property tweaks so it applies fully.
    setCaptionStyle(id);
    setCaptionOverrides({});
    setCaptionFontScale(null);
    setCaptionLineHeight(null);
  };
  const resetCustom = () => { setCaptionOverrides({}); setCaptionFontScale(null); setCaptionLineHeight(null); };

  // ---- caption line editing ----
  const activeId = useMemo(() => {
    const c = (captionCues || []).find((x) => time >= x.start && time < x.end);
    return c ? c.id : null;
  }, [captionCues, time]);

  // Keep the spoken line in view (not while the user is typing in the list).
  useEffect(() => {
    if (!activeId || editingRef.current || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-cap="${CSS.escape(activeId)}"]`);
    if (el) {
      const box = listRef.current;
      if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = el.offsetTop - box.clientHeight / 3;
      }
    }
  }, [activeId]);

  const update = (id, fn) => setCaptionsTrack((track) => track.map((c) => (c.id === id ? fn(c) : c)));
  const remove = (id) => setCaptionsTrack((track) => track.filter((c) => c.id !== id));
  const mergeNext = (id) => setCaptionsTrack((track) => {
    const i = track.findIndex((c) => c.id === id);
    if (i < 0 || i >= track.length - 1) return track;
    const next = [...track];
    next.splice(i, 2, merge(track[i], track[i + 1]));
    return next;
  });
  const setTimes = (c, start, end) => {
    const track = captionCues;
    const i = track.findIndex((x) => x.id === c.id);
    const lo = i > 0 ? track[i - 1].end : 0;
    const hi = i < track.length - 1 ? track[i + 1].start : Infinity;
    const s = Math.max(lo, Math.min(start, end - 0.1));
    const e = Math.min(hi, Math.max(end, s + 0.1));
    update(c.id, (x) => retime(x, s, e));
  };
  const addAtPlayhead = () => setCaptionsTrack((track) => {
    const t = Math.max(0, time);
    if (track.some((c) => t >= c.start && t < c.end)) return track;
    const after = track.find((c) => c.start > t);
    const end = Math.min(t + 2, after ? after.start : t + 2);
    if (end - t < 0.3) return track;
    const cap = retext({ id: generateCaptionId(), source: "manual", start: +t.toFixed(3), end: +end.toFixed(3), text: "", words: [] }, "New caption");
    const next = [...track, cap].sort((a, b) => a.start - b.start);
    setSelectedCaptionId && setSelectedCaptionId(cap.id);
    return next;
  });

  if (generatingCaptions) {
    return (
      <div className="panel captions">
        <h2 className="panel__h">Captions</h2>
        <div className="cap-empty">
          <p className="cap-gen">Generating captions…</p>
          <p className="cap-hint">{genCapStatus || "Starting…"}</p>
        </div>
      </div>
    );
  }

  if (!(captionCues && captionCues.length)) {
    return (
      <div className="panel captions">
        <h2 className="panel__h">Captions</h2>
        <div className="cap-empty">
          <button type="button" className="cap-upload cap-upload--primary" onClick={onGenerateCaptions}>
            <span className="cap-upload__i">✨</span> Auto-generate from audio
          </button>
          <div className="cap-or">or</div>
          <button type="button" className="cap-upload" onClick={onPickFile}>
            <span className="cap-upload__i">⇧</span> Import SRT / VTT
          </button>
        </div>
        {captionError && <div className="note note--bad">{captionError}</div>}
      </div>
    );
  }

  const animsIn = (g) => CAPTION_ANIMATIONS.filter((a) => a.group === g);
  const sizeFrac = eff.size;

  return (
    <div className="panel captions">
      <h2 className="panel__h">Captions</h2>
      <div className="cap-bar">
        <button
          type="button" className={`cap-switch ${captionsOn ? "is-on" : ""}`}
          onClick={() => setCaptionsOn(!captionsOn)} aria-pressed={captionsOn}
        >
          <span className="cap-switch__box" />
          {captionsOn ? "On" : "Off"}
        </button>
        <span className="cap-meta">
          <span className="cap-meta__name">{captionName || "captions"}</span>
          {captionCues.length} lines
        </span>
      </div>
      <div className="cap-actions">
        <button type="button" className="cap-act" onClick={onGenerateCaptions} title="Transcribe the voiceover again">Regenerate</button>
        <button type="button" className="cap-act" onClick={onPickFile} title="Replace with an SRT/VTT file">Import</button>
        <button type="button" className="cap-act" onClick={() => onExportCaptions("srt")} title="Download as .srt">SRT ↓</button>
        <button type="button" className="cap-act" onClick={() => onExportCaptions("vtt")} title="Download as .vtt">VTT ↓</button>
        <button type="button" className="cap-act cap-act--bad" onClick={removeCaptions} title="Remove all captions">Remove</button>
      </div>

      <div className="cap-body" aria-disabled={!captionsOn}>
        <div className="mini-h">Style</div>
        <div className="capgrid">
          {CAPTION_STYLE_LIST.map((st) => (
            <button
              key={st.id} type="button"
              className={`capcard ${captionStyle === st.id ? "is-on" : ""}`}
              onClick={() => pickStyle(st.id)}
              onMouseEnter={() => setHoverStyle(st.id)} onMouseLeave={() => setHoverStyle(null)}
              title={st.blurb}
            >
              <CaptionPreview
                opts={{ styleId: st.id, animationId: captionAnimation === "none" ? st.animation : captionAnimation }}
                animate={hoverStyle === st.id}
              />
              <span className="capcard__name">{st.name}</span>
            </button>
          ))}
        </div>

        <div className="mini-h" style={{ marginTop: 14 }}>Animation</div>
        {ANIM_GROUPS.map((g) => (
          <div key={g} className="capanim">
            <span className="capanim__g">{g}</span>
            <div className="transitions__chips">
              {animsIn(g).map((a) => (
                <button
                  key={a.id} type="button"
                  className={`trchip ${captionAnimation === a.id ? "is-on" : ""}`}
                  onClick={() => setCaptionAnimation(a.id)}
                >{a.name}</button>
              ))}
            </div>
          </div>
        ))}
        {getCaptionStyle(captionStyle).animation !== captionAnimation && (
          <button type="button" className="cap-replace" onClick={() => setCaptionAnimation(getCaptionStyle(captionStyle).animation)}>
            Use {getCaptionStyle(captionStyle).name}’s suggested animation ({(CAPTION_ANIMATIONS.find((a) => a.id === getCaptionStyle(captionStyle).animation) || {}).name})
          </button>
        )}

        <div className="mini-h" style={{ marginTop: 14 }}>Size</div>
        <div className="seg">
          {[["sm", "Small"], ["md", "Medium"], ["lg", "Large"]].map(([id, lbl]) => (
            <button
              key={id} type="button"
              className={captionFontScale == null && captionSize === id ? "is-on" : ""}
              onClick={() => { setCaptionSize(id); setCaptionFontScale(null); }}
            >{lbl}</button>
          ))}
        </div>
        <label className="trdur">
          <span>Font size</span>
          <input type="range" min={0.025} max={0.12} step={0.001} value={sizeFrac}
            onChange={(e) => setCaptionFontScale(+e.target.value)} />
          <span className="trdur__val">{(sizeFrac * 100).toFixed(1)}%</span>
        </label>

        <details className="capcustom">
          <summary>Customize style{customized ? " · edited" : ""}</summary>
          <div className="capform">
            <label className="capf">
              <span>Font</span>
              <select value={eff.font} onChange={(e) => setOverride({ font: e.target.value })}>
                {CAPTION_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="capf">
              <span>Weight</span>
              <select value={eff.weight} onChange={(e) => setOverride({ weight: +e.target.value })}>
                {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="capf capf--check">
              <input type="checkbox" checked={eff.uppercase} onChange={(e) => setOverride({ uppercase: e.target.checked })} />
              <span>ALL CAPS</span>
            </label>
            <label className="capf capf--check">
              <input type="checkbox" checked={eff.shadow} onChange={(e) => setOverride({ shadow: e.target.checked })} />
              <span>Drop shadow</span>
            </label>
            <label className="capf">
              <span>Text colour</span>
              <input type="color" value={toHex(eff.color)} onChange={(e) => setOverride({ color: e.target.value })} />
            </label>
            <label className="capf">
              <span>Spoken-word colour</span>
              <input type="color" value={toHex(eff.activeColor)} onChange={(e) => setOverride({ activeColor: e.target.value })} />
            </label>
            <label className="capf">
              <span>Outline colour</span>
              <input type="color" value={toHex(eff.strokeColor)} onChange={(e) => setOverride({ strokeColor: e.target.value, strokeWidth: eff.strokeWidth || 0.12 })} />
            </label>
            <label className="capf capf--wide">
              <span>Outline width</span>
              <input type="range" min={0} max={0.3} step={0.01} value={eff.strokeWidth}
                onChange={(e) => setOverride({ strokeWidth: +e.target.value, strokeColor: toHex(eff.strokeColor) })} />
              <em>{eff.strokeWidth > 0 ? eff.strokeWidth.toFixed(2) : "off"}</em>
            </label>
            <label className="capf">
              <span>Background</span>
              <input type="color" value={toHex(eff.bgColor)} onChange={(e) => setOverride({ bgColor: e.target.value, bgOpacity: eff.bgOpacity || 0.6 })} />
            </label>
            <label className="capf capf--wide">
              <span>Background opacity</span>
              <input type="range" min={0} max={1} step={0.05} value={eff.bgOpacity}
                onChange={(e) => setOverride({ bgOpacity: +e.target.value, bgColor: toHex(eff.bgColor) })} />
              <em>{eff.bgOpacity > 0 ? `${Math.round(eff.bgOpacity * 100)}%` : "off"}</em>
            </label>
            <div className="capf capf--wide">
              <span>Position</span>
              <div className="seg">
                {[["top", "Top"], ["center", "Middle"], ["bottom", "Bottom"]].map(([id, l]) => (
                  <button key={id} type="button" className={eff.position === id ? "is-on" : ""} onClick={() => setOverride({ position: id })}>{l}</button>
                ))}
              </div>
            </div>
            <label className="capf capf--wide">
              <span>{eff.position === "center" ? "Vertical shift" : "Distance from edge"}</span>
              <input type="range" min={eff.position === "center" ? -0.3 : 0} max={0.35} step={0.005} value={eff.offset}
                onChange={(e) => setOverride({ offset: +e.target.value })} />
              <em>{Math.round(eff.offset * 100)}%</em>
            </label>
            <div className="capf capf--wide">
              <span>Alignment</span>
              <div className="seg">
                {[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([id, l]) => (
                  <button key={id} type="button" className={eff.align === id ? "is-on" : ""} onClick={() => setOverride({ align: id })}>{l}</button>
                ))}
              </div>
            </div>
            <label className="capf capf--wide">
              <span>Letter spacing</span>
              <input type="range" min={-0.05} max={0.3} step={0.005} value={eff.letterSpacing}
                onChange={(e) => setOverride({ letterSpacing: +e.target.value })} />
              <em>{eff.letterSpacing.toFixed(2)}</em>
            </label>
            <label className="capf capf--wide">
              <span>Line spacing</span>
              <input type="range" min={0.9} max={2.2} step={0.02} value={eff.lineHeight}
                onChange={(e) => setCaptionLineHeight(+e.target.value)} />
              <em>{eff.lineHeight.toFixed(2)}×</em>
            </label>
            <label className="capf capf--wide">
              <span>Max words per line</span>
              <input type="range" min={1} max={14} step={1} value={eff.maxWordsPerLine}
                onChange={(e) => setOverride({ maxWordsPerLine: +e.target.value })} />
              <em>{eff.maxWordsPerLine}</em>
            </label>
            {customized && (
              <button type="button" className="cap-act" onClick={resetCustom}>Reset to {getCaptionStyle(captionStyle).name} preset</button>
            )}
          </div>
        </details>

        <div className="capl__head">
          <span className="mini-h" style={{ margin: 0 }}>Lines</span>
          <button type="button" className="cap-replace" onClick={addAtPlayhead} title="Add a caption at the playhead">+ Add at playhead</button>
        </div>
        <div className="capl" ref={listRef}>
          {captionCues.map((c) => (
            <div
              key={c.id} data-cap={c.id}
              className={`capl__row ${c.id === activeId ? "is-active" : ""} ${c.id === selectedCaptionId ? "is-sel" : ""}`}
            >
              <div className="capl__time">
                <button type="button" className="capl__seek" onClick={() => { onSeek(c.start + 0.001); setSelectedCaptionId && setSelectedCaptionId(c.id); }} title="Jump here">
                  {stamp(c.start)}
                </button>
                <span className="capl__nudge">
                  <button type="button" title="Start 0.1s earlier" onClick={() => setTimes(c, c.start - 0.1, c.end)}>−</button>
                  <button type="button" title="Start 0.1s later" onClick={() => setTimes(c, c.start + 0.1, c.end)}>+</button>
                </span>
                <span className="capl__dash">→ {stamp(c.end)}</span>
                <span className="capl__nudge">
                  <button type="button" title="End 0.1s earlier" onClick={() => setTimes(c, c.start, c.end - 0.1)}>−</button>
                  <button type="button" title="End 0.1s later" onClick={() => setTimes(c, c.start, c.end + 0.1)}>+</button>
                </span>
                <span className="capl__spacer" />
                <button type="button" className="capl__icon" title="Merge with the next line" onClick={() => mergeNext(c.id)}>⤓</button>
                <button type="button" className="capl__icon capl__icon--bad" title="Delete line" onClick={() => remove(c.id)}>✕</button>
              </div>
              <textarea
                className="capl__text" rows={1} defaultValue={c.text} key={c.text}
                onFocus={() => { editingRef.current = true; setSelectedCaptionId && setSelectedCaptionId(c.id); }}
                onBlur={(e) => {
                  editingRef.current = false;
                  const v = e.target.value.replace(/\s+/g, " ").trim();
                  if (!v) remove(c.id);
                  else if (v !== c.text) update(c.id, (x) => retext(x, v));
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
              />
            </div>
          ))}
        </div>
      </div>
      {captionError && <div className="note note--bad">{captionError}</div>}
    </div>
  );
}
