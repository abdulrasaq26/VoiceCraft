"use client";
import { useState } from "react";
import { showAlert, showConfirm, showPrompt } from "./Dialog";

function clock(sec) {
  if (!sec || !isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function size(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
function when(ts) {
  const d = new Date(ts), now = new Date();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? `Today, ${t}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${t}`;
}

// The project's finished videos (renders folder): newest first, with what
// you need to find, check and upload them.
export default function RendersPanel({ renders, onRenderNew, renderBusy, canRender }) {
  const [busyId, setBusyId] = useState(null);
  const S = typeof window !== "undefined" ? window.studio : null;
  if (!S) return null;
  const list = [...renders].sort((a, b) => b.createdAt - a.createdAt);

  const act = async (r, action) => {
    setBusyId(r.id);
    try {
      if (action === "rename") {
        const base = r.filename.replace(/\.[^.]+$/, "");
        const name = await showPrompt("New name", { title: "Rename video", defaultValue: base, okText: "Rename" });
        if (!name || !name.trim() || name.trim() === base) return;
        const res = await S.assetAction(r.projectId, r.id, "rename", name.trim());
        if (!res.ok) await showAlert(res.error || "Couldn’t rename it.", { title: "Rename failed" });
      } else if (action === "delete") {
        const ok = await showConfirm(`Delete “${r.filename}” from your computer? This can't be undone.`, { title: "Delete video", okText: "Delete", danger: true });
        if (ok) await S.assetAction(r.projectId, r.id, "delete");
      } else if (action === "upload") {
        await S.useForUpload(r.projectId, r.id);
      } else {
        await S.assetAction(r.projectId, r.id, action);
      }
    } finally { setBusyId(null); }
  };

  return (
    <div className="panel renders">
      <div className="renders__head">
        <h2 className="panel__h" style={{ margin: 0 }}>Renders <span className="passets__n">{list.length}</span></h2>
        <button type="button" className="cap-act" onClick={onRenderNew} disabled={renderBusy || !canRender}
          title="Render the current edit as a new version">
          {renderBusy ? "Rendering…" : list.length ? "Render new version" : "Render"}
        </button>
      </div>
      {!list.length ? (
        <div className="passets__empty">Finished videos are saved with the project and listed here, ready to open or upload.</div>
      ) : (
        <div className="renders__list">
          {list.map((r) => {
            const m = r.metadata || {};
            return (
              <div key={r.id} className="rver" title={r.absPath || r.filename}>
                <div className="rver__top">
                  <span className="rver__v">v{m.version || "?"}</span>
                  <span className="rver__name">{r.filename}</span>
                  <span className={`rver__st${m.audioIssue ? " is-warn" : ""}`}>{m.audioIssue ? "No audio" : (m.status === "complete" || !m.status ? "Ready" : m.status)}</span>
                </div>
                <div className="rver__meta">
                  <span>{when(r.createdAt)}</span>
                  <span>{clock(r.duration)}</span>
                  {m.width && <span>{m.width}×{m.height}</span>}
                  <span>{size(r.size)}</span>
                </div>
                <div className="rver__acts">
                  <button type="button" className="cap-act" disabled={busyId === r.id} onClick={() => act(r, "open")}>Open</button>
                  <button type="button" className="cap-act" disabled={busyId === r.id} onClick={() => act(r, "reveal")}>Show in folder</button>
                  <button type="button" className="cap-act cap-act--pri" disabled={busyId === r.id} onClick={() => act(r, "upload")} title="Open the browser; this video is offered first in any website's file picker">Upload…</button>
                  <button type="button" className="cap-act" disabled={busyId === r.id} onClick={() => act(r, "rename")}>Rename</button>
                  <button type="button" className="cap-act rver__del" disabled={busyId === r.id} onClick={() => act(r, "delete")} aria-label={`Delete ${r.filename}`}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
