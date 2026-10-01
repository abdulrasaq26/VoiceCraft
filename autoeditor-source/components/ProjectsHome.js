"use client";
import { useEffect, useMemo, useState } from "react";
import { showConfirm, showPrompt } from "./Dialog";
import StorageRing from "./StorageRing";

function edited(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${t}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${t}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
function clock(sec) {
  if (!sec || !isFinite(sec)) return "";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
const SORTS = {
  edited: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  name: (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }),
  created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
};

export default function ProjectsHome({ projects, onNew, onOpen, onRename, onDelete, storage }) {
  const [menuId, setMenuId] = useState(null);       // project whose ⋮ menu is open
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("edited");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [counts, setCounts] = useState({});         // studio asset counts per project
  const [currentId, setCurrentId] = useState(null); // the studio's current project

  useEffect(() => {
    const S = typeof window !== "undefined" && window.studio;
    if (!S) return undefined;
    let alive = true;
    S.assetCounts(projects.map((p) => p.id)).then((c) => { if (alive) setCounts(c || {}); });
    S.getState().then((st) => { if (alive) setCurrentId(st.project && st.project.id); });
    const offs = [
      S.onProjectChanged((p) => setCurrentId(p && p.id)),
      S.onAssetAdded((a) => setCounts((c) => {
        const cur = { audio: 0, image: 0, video: 0, caption: 0, other: 0, ...(c[a.projectId] || {}) };
        cur[a.type in cur ? a.type : "other"]++;
        return { ...c, [a.projectId]: cur };
      })),
    ];
    return () => { alive = false; offs.forEach((off) => off && off()); };
  }, [projects]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => !q || (p.name || "untitled").toLowerCase().includes(q)).sort(SORTS[sort]);
  }, [projects, query, sort]);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };

  const doRename = async (p) => {
    setMenuId(null);
    const name = await showPrompt("Rename project", { title: "Rename project", defaultValue: p.name || "Untitled project", okText: "Rename" });
    if (name && name.trim()) onRename(p.id, name.trim());
  };
  const doDelete = async (list) => {
    setMenuId(null);
    if (!list.length) return;
    const names = list.slice(0, 5).map((p) => `“${p.name || "Untitled"}”`).join(", ") + (list.length > 5 ? ` and ${list.length - 5} more` : "");
    const ok = await showConfirm(
      `Delete ${list.length === 1 ? names : `${list.length} projects (${names})`}? This permanently removes ${list.length === 1 ? "the project, its edit and its project assets" : "these projects, their edits and their project assets"} from this device. Files you downloaded elsewhere are not touched.`,
      { title: list.length === 1 ? "Delete project" : `Delete ${list.length} projects`, okText: "Delete", danger: true }
    );
    if (!ok) return;
    await onDelete(list.map((p) => p.id));
    stopSelecting();
  };

  const countLine = (p) => {
    const c = counts[p.id] || {};
    const bits = [];
    if (c.audio) bits.push(<span key="a" title="Audio">🎙 {c.audio}</span>);
    if (c.image) bits.push(<span key="i" title="Images">🖼 {c.image}</span>);
    if (c.video) bits.push(<span key="v" title="Videos">🎬 {c.video}</span>);
    if (c.caption) bits.push(<span key="c" title="Captions">📝 {c.caption}</span>);
    return bits;
  };

  return (
    <main className="ph" onClick={() => menuId && setMenuId(null)}>
      <header className="ph__topbar">
        <div className="ph__bar">
          <div className="ph__brand">
            <img className="ph__logo-v" src="/brand/frameloom-mark.svg" alt="" width="28" height="28" />
            <span className="ph__name">Frame<span className="ph__accent">loom</span> AutoEditor</span>
          </div>
          <div className="ph__actions">
            <StorageRing storage={storage} />
          </div>
        </div>
      </header>

      <div className="ph__body">
        <div className="ph__head">
          <div>
            <h1 className="ph__title">Projects</h1>
            <p className="ph__sub">Each project holds its narration, Flow images and videos, captions and edit.</p>
          </div>
          <div className="ph__tools">
            <input className="ph__search" type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="ph__sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort projects">
              <option value="edited">Last edited</option>
              <option value="name">Name</option>
              <option value="created">Newest</option>
            </select>
            {!selecting ? (
              <button className="ph__btn" onClick={() => setSelecting(true)} disabled={!projects.length}>Select</button>
            ) : (
              <>
                <button className="ph__btn" onClick={() => setSelected(selected.size === shown.length ? new Set() : new Set(shown.map((p) => p.id)))}>
                  {selected.size === shown.length && shown.length ? "Select none" : "Select all"}
                </button>
                <button className="ph__btn ph__btn--danger" disabled={!selected.size} onClick={() => doDelete(projects.filter((p) => selected.has(p.id)))}>
                  Delete selected{selected.size ? ` (${selected.size})` : ""}
                </button>
                <button className="ph__btn" onClick={stopSelecting}>Cancel</button>
              </>
            )}
          </div>
        </div>

        <div className="ph__grid">
          {!selecting && !query && (
            <button className="ph__new" onClick={onNew}>
              <span className="ph__new-plus">＋</span>
              <span className="ph__new-label">New project</span>
            </button>
          )}

          {shown.map((p) => {
            const isSel = selected.has(p.id);
            return (
              <div
                key={p.id}
                className={`pcard${isSel ? " is-sel" : ""}${p.id === currentId ? " is-current" : ""}`}
                onClick={() => (selecting ? toggle(p.id) : onOpen(p.id))}
              >
                <div className="pcard__thumb">
                  {p.thumb ? <img src={p.thumb} alt="" /> : <span className="pcard__noimg">▦</span>}
                  {p.durationSec ? <span className="pcard__dur">{clock(p.durationSec)}</span> : null}
                  {p.id === currentId && <span className="pcard__cur">Current</span>}
                  {selecting && <span className={`pcard__check${isSel ? " on" : ""}`} aria-hidden="true">{isSel ? "✓" : ""}</span>}
                </div>
                <div className="pcard__foot">
                  <div className="pcard__meta">
                    <span className="pcard__name" title={p.name}>{p.name || "Untitled"}</span>
                    <span className="pcard__counts">
                      {countLine(p)}
                      {p.clipCount ? <span title="Clips on the timeline">▦ {p.clipCount}</span> : null}
                    </span>
                    <span className="pcard__sub">Last edited: {edited(p.updatedAt) || "—"}</span>
                  </div>
                  {!selecting && (
                    <div className="pcard__menuwrap" onClick={(e) => e.stopPropagation()}>
                      <button className="pcard__menu" aria-label="Project options" onClick={() => setMenuId(menuId === p.id ? null : p.id)}>⋮</button>
                      {menuId === p.id && (
                        <div className="pcard__pop">
                          <button onClick={() => { setMenuId(null); onOpen(p.id); }}>Open</button>
                          <button onClick={() => doRename(p)}>Rename</button>
                          <button className="pcard__pop-del" onClick={() => doDelete([p])}>Delete</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {projects.length === 0 && <p className="ph__empty">No projects yet — create your first one to get started.</p>}
        {projects.length > 0 && shown.length === 0 && <p className="ph__empty">No projects match “{query}”.</p>}
      </div>
    </main>
  );
}
