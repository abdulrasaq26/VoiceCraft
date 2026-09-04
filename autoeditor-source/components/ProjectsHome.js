"use client";
import { useState } from "react";
import { showConfirm, showPrompt } from "./Dialog";
import StorageRing from "./StorageRing";

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d} day${d > 1 ? "s" : ""} ago`;
  return new Date(ts).toLocaleDateString();
}
function clock(sec) {
  if (!sec || !isFinite(sec)) return "";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
export default function ProjectsHome({ projects, onNew, onOpen, onRename, onDelete, storage }) {
  const [menuId, setMenuId] = useState(null); // project id with its ⋮ menu open

  const doRename = async (p) => {
    setMenuId(null);
    const name = await showPrompt("Rename project", {
      title: "Rename project", defaultValue: p.name || "Untitled project", okText: "Rename",
    });
    if (name && name.trim()) onRename(p.id, name.trim());
  };
  const doDelete = async (p) => {
    setMenuId(null);
    const ok = await showConfirm(
      `Delete "${p.name || "Untitled"}"? This permanently removes the project and its media from this device.`,
      { title: "Delete project", okText: "Delete", danger: true }
    );
    if (ok) onDelete(p.id);
  };

  return (
    <main className="ph" onClick={() => menuId && setMenuId(null)}>
      <header className="ph__topbar">
        <div className="ph__bar">
          <div className="ph__brand" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 26, height: 26, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 'bold', color: '#fff', marginRight: 10 }}>V</div>
            <span className="ph__name">Voice<span style={{ color: '#6366f1' }}>Craft</span> AutoEditor</span>
          </div>
          <div className="ph__actions">
            <StorageRing storage={storage} />
          </div>
        </div>
      </header>

      <div className="ph__body">
        <div className="ph__head">
          <h1 className="ph__title">Your projects</h1>
          <p className="ph__sub">Pick up where you left off — or start a fresh cut.</p>
        </div>

        <div className="ph__grid">
          <button className="ph__new" onClick={onNew}>
            <span className="ph__new-plus">＋</span>
            <span className="ph__new-label">New project</span>
          </button>

          {projects.map((p) => (
            <div key={p.id} className="pcard" onClick={() => onOpen(p.id)}>
              <div className="pcard__thumb">
                {p.thumb ? <img src={p.thumb} alt="" /> : <span className="pcard__noimg">▦</span>}
                {p.durationSec ? <span className="pcard__dur">{clock(p.durationSec)}</span> : null}
              </div>
              <div className="pcard__foot">
                <div className="pcard__meta">
                  <span className="pcard__name" title={p.name}>{p.name || "Untitled"}</span>
                  <span className="pcard__sub">
                    {p.clipCount ? `${p.clipCount} clip${p.clipCount > 1 ? "s" : ""} · ` : ""}{timeAgo(p.updatedAt)}
                  </span>
                </div>
                <div className="pcard__menuwrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="pcard__menu"
                    aria-label="Project options"
                    onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                  >⋮</button>
                  {menuId === p.id && (
                    <div className="pcard__pop">
                      <button onClick={() => doRename(p)}>Rename</button>
                      <button className="pcard__pop-del" onClick={() => doDelete(p)}>Delete</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {projects.length === 0 && (
          <p className="ph__empty">No projects yet — create your first one to get started.</p>
        )}
      </div>
    </main>
  );
}
