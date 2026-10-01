"use client";
import { useMemo, useState } from "react";

const SOURCE = {
  voicecraft: "VoiceCraft", "flow-automator": "Flow Automator", "flow-downloader": "Flow Downloader",
  flow: "Flow", import: "Imported", autoeditor: "AutoEditor",
};
const GROUPS = [
  ["audio", "Audio"], ["image", "Images"], ["video", "Videos"], ["caption", "Captions"], ["other", "Other"],
];

// The studio project's media (VoiceCraft narration, Flow results, captions…),
// live: new assets appear as they're produced. "Add" puts one into this edit;
// images and videos named like 2-33 land at 2:33 on the timeline.
export default function ProjectAssets({ assets, inTimeline, onAdd, onRemove, assetUrl, projectName }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(null);
  const groups = useMemo(() => {
    const g = {};
    for (const a of assets) (g[a.type in { audio: 1, image: 1, video: 1, caption: 1 } ? a.type : "other"] ||= []).push(a);
    for (const k of Object.keys(g)) g[k].sort((x, y) => x.filename.localeCompare(y.filename, undefined, { numeric: true }));
    return g;
  }, [assets]);
  const fresh = assets.filter((a) => !inTimeline(a) && a.type !== "other");

  const add = async (list, key) => {
    setBusy(key);
    try { await onAdd(list); } finally { setBusy(null); }
  };

  return (
    <div className="panel passets">
      <div className="passets__head">
        <button type="button" className="passets__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="panel__h" style={{ margin: 0 }}>Project assets</span>
          <span className="passets__n">{assets.length}</span>
        </button>
        {fresh.length > 0 && (
          <button type="button" className="cap-act" disabled={!!busy} onClick={() => add(fresh, "all")}>
            {busy === "all" ? "Adding…" : `Add ${fresh.length} new`}
          </button>
        )}
      </div>
      {open && (
        !assets.length ? (
          <div className="passets__empty">
            Narration sent from VoiceCraft and pictures from the Flow Automator for <b>{projectName || "this project"}</b> appear here automatically.
          </div>
        ) : (
          GROUPS.filter(([k]) => groups[k]).map(([k, label]) => (
            <div key={k} className="passets__grp">
              <div className="mini-h">{label} · {groups[k].length}</div>
              <div className={`passets__list passets__list--${k}`}>
                {groups[k].map((a) => {
                  const used = inTimeline(a);
                  return (
                    <div key={a.id} className={`passet${used ? " is-used" : ""}`} title={[a.filename, a.metadata && a.metadata.prompt].filter(Boolean).join("\n\n")}>
                      {(k === "image") && <img className="passet__thumb" src={assetUrl(a)} alt="" loading="lazy" />}
                      {(k === "video") && <video className="passet__thumb" src={assetUrl(a)} muted preload="metadata" />}
                      {(k === "audio" || k === "caption" || k === "other") && <span className="passet__icon">{k === "audio" ? "♪" : k === "caption" ? "CC" : "•"}</span>}
                      <div className="passet__main">
                        <div className="passet__name">{a.filename}</div>
                        <div className="passet__src">{SOURCE[a.source] || a.source}</div>
                      </div>
                      {used ? (
                        <span className="passet__used">✓ In edit</span>
                      ) : (
                        <button type="button" className="cap-act" disabled={!!busy} onClick={() => add([a], a.id)}>
                          {busy === a.id ? "…" : k === "audio" ? "Use" : "Add"}
                        </button>
                      )}
                      <button type="button" className="passet__x" title="Remove from project" onClick={() => onRemove(a)}>✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )
      )}
    </div>
  );
}
