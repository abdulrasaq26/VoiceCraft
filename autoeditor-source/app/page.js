"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./studio-tokens.css";
import "./globals.css";
import { parseTimestampName } from "../lib/timestamp";
import { buildTimeline, trimClips, LEAD_IN } from "../lib/timeline";
import { resolveDimensions, capTo720 } from "../lib/dimensions";
import { getAudioDuration } from "../lib/audio";
import { getWaveformPeaks } from "../lib/waveform";
import { renderVideo, cancelRender, getActiveRender, reconnectRender, probeBackend } from "../lib/serverRender";
import { renderWebCodecs, webCodecsCanRender, pickRenderProfile, startKeepAwake } from "../lib/webcodecsRender";
import { DEFAULT_TRANSITION_DURATION, mixTransitions } from "../lib/transitions";
import { parseSRT } from "../lib/captions/srt-parser.js";
import { generateCaptionsFlow } from "../lib/captions/caption-generator.js";
import { normalizeStyleId } from "../lib/captions/caption-style-manager.js";
import { normalizeAnimationId } from "../lib/captions/caption-animation-engine.js";
import { ensureCaptionFont } from "../lib/captions/caption-renderer.js";
import { downloadCaptions } from "../lib/captions/caption-exporter.js";
import Dropzone from "../components/Dropzone";
import Editor from "../components/Editor";
import ProjectsHome from "../components/ProjectsHome";
import StorageRing from "../components/StorageRing";
import ProjectAssets from "../components/ProjectAssets";
import RendersPanel from "../components/RendersPanel";
import { DialogHost, showAlert, showConfirm, showPrompt } from "../components/Dialog";
import {
  requestPersist, storageEstimate, listProjects, getProject, saveProject,
  renameProject, deleteProject, getMedia, syncMedia, newId,
  saveResumeState,
} from "../lib/projectStore";

function loadImageEl(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { img.url = url; img.fileName = file.name; resolve(img); };
    img.src = url;
  });
}

// Load a video clip as a still-poster Image (so the timeline/canvas draw it just
// like a photo) while carrying the video's URL + duration for the trim scrubber
// and export. img.url = poster (drawable), img.videoUrl = the actual video.
function loadVideoEl(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const finish = (posterSrc, w, h, dur) => {
      const img = new Image();
      img.onload = () => {
        img.url = posterSrc; img.fileName = file.name;
        img.isVideo = true; img.videoUrl = url; img.videoDuration = dur || 0;
        resolve(img);
      };
      img.onerror = () => { // poster failed — resolve a bare marker so it still imports
        img.url = null; img.fileName = file.name; img.isVideo = true;
        img.videoUrl = url; img.videoDuration = dur || 0; resolve(img);
      };
      img.src = posterSrc || url;
    };
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.playsInline = true; v.src = url;
    v.onloadeddata = () => {
      const grab = () => {
        try {
          const c = document.createElement("canvas");
          c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          finish(c.toDataURL("image/jpeg", 0.82), c.width, c.height, v.duration);
        } catch { finish(null, v.videoWidth, v.videoHeight, v.duration); }
      };
      v.onseeked = grab;
      try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { grab(); }
    };
    v.onerror = () => finish(null, 0, 0, 0);
  });
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Run an async fn over items with a concurrency limit. Loading 250 large images
// (or opening 250 IndexedDB reads) all at once spikes memory/CPU and freezes the
// tab; a small limit keeps it fast without the freeze.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// Undo/redo over one composition snapshot. Object URLs are intentionally never
// revoked, so an undone snapshot still points at a live image.
function useHistory(initial) {
  const [hist, setHist] = useState({ past: [], present: initial, future: [] });
  const commit = useCallback((updater) => {
    setHist((h) => {
      const next = typeof updater === "function" ? updater(h.present) : updater;
      if (next === h.present) return h;
      return { past: [...h.past, h.present], present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => setHist((h) => {
    if (!h.past.length) return h;
    const prev = h.past[h.past.length - 1];
    return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
  }), []);
  const redo = useCallback(() => setHist((h) => {
    if (!h.future.length) return h;
    const nxt = h.future[0];
    return { past: [...h.past, h.present], present: nxt, future: h.future.slice(1) };
  }), []);
  const reset = useCallback((present) => setHist({ past: [], present, future: [] }), []);
  return [
    hist.present, commit,
    { undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, reset },
  ];
}

// A slot is one point on the timeline: { id, seconds, file, img, empty }.
// Empty slots are placeholders (a removed image or the lead-in you filled out).
export default function Home() {
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [peaks, setPeaks] = useState([]);
  const [aspect, setAspect] = useState("16:9");
  const [fps, setFps] = useState(30);
  const [renderQuality, setRenderQuality] = useState("full"); // "full" | "720p"
  const [transitionDuration, setTransitionDuration] = useState(DEFAULT_TRANSITION_DURATION);
  const [fadeIn, setFadeIn] = useState(0.5);          // opening fade seconds (0 = off)
  const [fadeOut, setFadeOut] = useState(0.6);        // ending fade seconds (0 = off)
  const [motionByName, setMotionByName] = useState({}); // clip name -> zoomin | zoomout
  const [motionAmount, setMotionAmount] = useState(0.08); // Ken Burns zoom depth (0–0.2)
  const [trimByName, setTrimByName] = useState({});   // video clip name -> in-point seconds
  const [volumeByName, setVolumeByName] = useState({}); // video clip name -> 0..1 (default 0.5)
  const [fitByName, setFitByName] = useState({});     // video clip name -> "fit" (fast-fwd, default) | "trim" (1x)
  const [trimEnd, setTrimEnd] = useState(0); // export end point (0 = untrimmed / full audio)
  const [captionsTrack, setCaptionsTrack] = useState([]); // Unified caption data model
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [genCapStatus, setGenCapStatus] = useState("");
  const [captionName, setCaptionName] = useState(null);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionStyle, setCaptionStyle] = useState("clean");
  const [captionAnimation, setCaptionAnimation] = useState("word-highlight");
  const [captionOverrides, setCaptionOverrides] = useState({}); // per-property Customize edits
  const [captionSize, setCaptionSize] = useState("md");
  const [captionLineHeight, setCaptionLineHeight] = useState(null); // null = per-style default
  const [captionFontScale, setCaptionFontScale] = useState(null);   // null = use the size preset
  const [importing, setImporting] = useState(null);   // { done, total } while decoding imports
  const [built, setBuilt] = useState(false);          // committed images to the timeline?
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outUrl, setOutUrl] = useState(null);
  const [error, setError] = useState(null);
  // A render that was already running when this tab loaded (e.g. reopened after
  // closing the browser mid-render). Shown as a banner and reconnected to.
  const [resume, setResume] = useState(null); // { busy, progress, url, error }
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

  // Projects: everything is stored client-side in IndexedDB (see lib/projectStore).
  const [view, setView] = useState("list");            // "list" (projects grid) | "editor"
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null); // { id, name, createdAt }
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [loadingProject, setLoadingProject] = useState(false);
  // (kept in a ref for the resume-state writer, defined further down)
  const saveRef = useRef(null);
  const idRef = useRef(0);
  const playheadRef = useRef(0);
  const [initialPlayhead, setInitialPlayhead] = useState(0);

  // ---- Resume state: where the user left off in each project ---------------
  // { playheadTime, lastViewedAt, lastEditedAt, activeTrack, selectedClipId,
  //   selectedCaptionId, zoomLevel, scrollLeft } — part of the project record
  // (data.resume). Written on its own at most every 1.5s while it changes,
  // and right away when the project closes or the app goes to the background.
  const resumeRef = useRef({ pid: null, state: {} });
  const resumeTimerRef = useRef(null);
  const [resumeView, setResumeView] = useState(null); // { token, ...state } handed to the Editor
  const flushResume = useCallback(async () => {
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = null;
    const { pid, state, dirty } = resumeRef.current;
    if (!pid || !dirty) return;
    resumeRef.current.dirty = false;
    try { await saveResumeState(pid, { ...state, lastViewedAt: Date.now() }); } catch (_) { /* storage unavailable */ }
  }, []);
  const loadingRef = useRef(false); // no position reports while a project loads
  const noteResume = useCallback((patch) => {
    const r = resumeRef.current;
    if (!r.pid || loadingRef.current) return;
    let changed = false;
    for (const k of Object.keys(patch)) if (r.state[k] !== patch[k]) { r.state[k] = patch[k]; changed = true; }
    if (!changed) return;
    r.dirty = true;
    if (!resumeTimerRef.current) resumeTimerRef.current = setTimeout(flushResume, 1500);
  }, [flushResume]);
  const startResume = useCallback((pid, saved) => {
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = null;
    resumeRef.current = { pid, state: { ...(saved || {}) }, dirty: false };
    setResumeView({ token: Date.now() + Math.random(), ...(saved || {}) });
  }, []);
  useEffect(() => {
    const away = () => { if (document.visibilityState === "hidden") flushResume(); };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", flushResume);
    return () => { document.removeEventListener("visibilitychange", away); window.removeEventListener("pagehide", flushResume); };
  }, [flushResume]);
  const nextId = () => `s${idRef.current++}`;

  // Composition (undoable): slots + per-clip transition choices, snapshotted together.
  const [doc, commitDoc, { undo, redo, canUndo, canRedo, reset: resetDoc }] =
    useHistory({ slots: [], transitionsByName: {} });
  const { slots, transitionsByName } = doc;

  const onAudio = useCallback(async (files, precalcDur = null) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    try {
      const d = precalcDur !== null ? precalcDur : await getAudioDuration(file);
      setAudioFile(file);
      setAudioUrl(URL.createObjectURL(file));
      setAudioDuration(d);
      getWaveformPeaks(file).then(setPeaks);
    } catch (e) { setError(e.message); }
  }, []);

  // Import images, merged by timestamp: a file whose timestamp matches an
  // existing slot fills/replaces it; otherwise it becomes a new slot.
  const addImages = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!files.length) return;
    // Decoding many files (esp. video posters) takes a few seconds with no UI —
    // show live "loaded X of N" progress, ticking up as each file finishes.
    setImporting({ done: 0, total: files.length });
    try {
      const loaded = await Promise.all(
        files.map(async (f) => {
          const img = f.type.startsWith("video/") ? await loadVideoEl(f) : await loadImageEl(f);
          setImporting((p) => (p ? { ...p, done: p.done + 1 } : p));
          return { file: f, seconds: parseTimestampName(f.name), img };
        })
      );
      commitDoc((d) => {
      const next = d.slots.map((s) => ({ ...s }));
      for (const { file, seconds, img } of loaded) {
        const slot = seconds != null ? next.find((s) => s.seconds === seconds) : null;
        if (slot) {
          slot.mediaId = nextId();
          slot.file = file; slot.img = img; slot.empty = false;
        } else {
          const id = nextId();
          next.push({ id, mediaId: id, seconds, file, img, empty: false });
        }
      }
      return { ...d, slots: next };
      });
    } finally {
      setImporting(null);
    }
  }, [commitDoc]);

  // Swap the image/video in one slot, keeping its timestamp.
  const replaceImage = useCallback(async (id, file) => {
    if (!file) return;
    const isVid = file.type.startsWith("video/");
    if (!isVid && !file.type.startsWith("image/")) return;
    const img = isVid ? await loadVideoEl(file) : await loadImageEl(file);
    const newMediaId = nextId();
    commitDoc((d) => ({
      ...d,
      slots: d.slots.map((s) => (s.id === id ? { ...s, mediaId: newMediaId, file, img, empty: false } : s)),
    }));
  }, [commitDoc]);

  // Discard a staged image entirely (used in the pre-build import tray).
  const discardImage = useCallback((id) => {
    commitDoc((d) => ({ ...d, slots: d.slots.filter((s) => s.id !== id) }));
  }, [commitDoc]);

  // Removing an image turns its slot into a placeholder — neighbours don't move.
  const removeImage = useCallback((id) => {
    commitDoc((d) => ({
      ...d,
      slots: d.slots.map((s) => (s.id === id ? { ...s, file: null, img: null, empty: true } : s)),
    }));
  }, [commitDoc]);

  // Completely delete a gap slot, allowing the previous clip to stretch.
  const deleteGap = useCallback((id) => {
    commitDoc((d) => ({
      ...d,
      slots: d.slots.filter((s) => s.id !== id),
    }));
  }, [commitDoc]);

  // Fill a gap. LEAD_IN adds a new slot at 0; otherwise fill the empty slot.
  const fillGap = useCallback(async (name, file) => {
    if (!file) return;
    const isVid = file.type.startsWith("video/");
    if (!isVid && !file.type.startsWith("image/")) return;
    const img = isVid ? await loadVideoEl(file) : await loadImageEl(file);
    commitDoc((d) => {
      if (name === LEAD_IN) {
        return { ...d, slots: [...d.slots, { id: nextId(), seconds: 0, file, img, empty: false }] };
      }
      return { ...d, slots: d.slots.map((s) => (s.id === name ? { ...s, file, img, empty: false } : s)) };
    });
  }, [commitDoc]);

  // Roll edit: move the boundary between an image and the next clip by setting
  // the next clip's slot start. buildTimeline re-derives both durations; total
  // length and every other slot are untouched. One commit = one undo step.
  const resizeBoundary = useCallback((id, seconds) => {
    commitDoc((d) => ({
      ...d,
      slots: d.slots.map((s) => (s.id === id ? { ...s, seconds: +seconds.toFixed(3) } : s)),
    }));
  }, [commitDoc]);

  // Read an uploaded transcript; parsing happens in a memo below so it re-syncs
  // if the audio length changes.
  const onCaptionFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
        const res = parseSRT(text);
        if (res.error) throw new Error(res.error);
        setCaptionsTrack(res.captions);
      setCaptionName(file.name);
      setCaptionsOn(true);
    } catch (e) { setError(e.message || String(e)); }
  }, []);

  // ---- Audio/SRT Load Hook (from VoiceCraft DB) ----
  // Runs on load, and again whenever the studio says VoiceCraft just sent
  // something (the AutoEditor stays open in the studio, so it won't reload).
  const checkTransferRef = useRef(null);
  useEffect(() => {
    async function checkTransfer() {
      if (typeof window === "undefined" || !window.indexedDB) return;
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("blvck-tts", 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("audio")) req.result.createObjectStore("audio");
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        const getFromDb = (key) => new Promise((resolve, reject) => {
          const tx = db.transaction("audio", "readonly");
          const rq = tx.objectStore("audio").get(key);
          rq.onsuccess = () => resolve(rq.result || null);
          rq.onerror = () => reject(rq.error);
        });

        const delFromDb = (key) => new Promise((resolve, reject) => {
          const tx = db.transaction("audio", "readwrite");
          const rq = tx.objectStore("audio").delete(key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });

        const audioBlob = await getFromDb("transfer_audio");
        const audioDur = await getFromDb("transfer_audio_duration");
        const srtText = await getFromDb("transfer_srt");
        const projectName = await getFromDb("transfer_project") || "voicecraft";
        const projectId = await getFromDb("transfer_projectId");
        
        db.close();

        let loadedAudio = false;

        if (audioBlob || srtText || projectName !== "voicecraft") {
          setView("editor");
        }

        if (projectName !== "voicecraft") {
          const allProjs = await listProjects();
          let match = null;
          if (projectId) match = allProjs.find(p => p.id === projectId);
          if (!match) match = allProjs.find(p => p.name === projectName);
          
          await studioRef.current.ensureProject((match && match.id) || projectId || Date.now().toString(), projectName);
          await delFromDb("transfer_project");
          await delFromDb("transfer_projectId");
        }

        if (audioBlob) {
          const file = new File([audioBlob], `${projectName}.wav`, { type: "audio/wav" });
          await onAudio([file], audioDur);
          loadedAudio = true;
          await delFromDb("transfer_audio");
          await delFromDb("transfer_audio_duration");
        }

        if (srtText) {
          if (loadedAudio) await new Promise(r => setTimeout(r, 100)); // wait for audio state
          const file = new File([srtText], `${projectName}.srt`, { type: "text/plain" });
          await onCaptionFile(file);
          await delFromDb("transfer_srt");
        }
      } catch (err) {
        console.error("Failed to check transfer DB:", err);
      }
    }
    checkTransferRef.current = checkTransfer;
    checkTransfer();
  }, [onAudio, onCaptionFile, setView]);
  const captionCues = captionsTrack;
  // Everything the caption renderer needs. The preview and the export both
  // get this same object, so what's on screen is what's rendered.
  const captionOpts = useMemo(() => ({
    styleId: captionStyle, animationId: captionAnimation, size: captionSize,
    fontScale: captionFontScale, lineHeight: captionLineHeight, overrides: captionOverrides,
  }), [captionStyle, captionAnimation, captionSize, captionFontScale, captionLineHeight, captionOverrides]);
    const captionError = null;

  // On load, reconnect to a render that's still running on the server.
  useEffect(() => {
    let alive = true;
    (async () => {
      const active = await getActiveRender();
      if (!alive || !active) return;
      setResume({ busy: true, progress: (active.percent || 0) / 100, url: null, error: null });
      try {
        const blob = await reconnectRender(active.jobId, (p) => {
          if (alive) setResume((r) => (r ? { ...r, progress: p } : r));
        });
        if (alive) {
          const safeUrl = (blob && (blob instanceof Blob || blob instanceof File)) ? URL.createObjectURL(blob) : null;
          setResume({ busy: false, progress: 1, url: safeUrl, error: null });
        }
      } catch (e) {
        if (alive) setResume({ busy: false, progress: 0, url: null, error: e.message || String(e) });
      }
    })();
    return () => { alive = false; };
  }, []);

  const setTransition = useCallback((name, type) => {
    commitDoc((d) => ({ ...d, transitionsByName: { ...d.transitionsByName, [name]: type } }));
  }, [commitDoc]);
  const applyTransitionAll = useCallback((type, clipNames) => {
    commitDoc((d) => {
      const next = {};
      // Skip the first clip — it has no incoming cut.
      for (let i = 1; i < clipNames.length; i++) next[clipNames[i]] = type;
      return { ...d, transitionsByName: next };
    });
  }, [commitDoc]);

  const setMotion = useCallback((name, type) => {
    setMotionByName((prev) => ({ ...prev, [name]: type }));
  }, []);
  const setTrim = useCallback((name, seconds) => {
    setTrimByName((prev) => ({ ...prev, [name]: Math.max(0, +seconds || 0) }));
  }, []);
  const setVolume = useCallback((name, vol) => {
    setVolumeByName((prev) => ({ ...prev, [name]: Math.min(1, Math.max(0, +vol || 0)) }));
  }, []);
  const setFit = useCallback((name, mode) => {
    setFitByName((prev) => ({ ...prev, [name]: mode }));
  }, []);
  const applyMotionAll = useCallback((type, names) => {
    setMotionByName(() => { const next = {}; for (const n of names) next[n] = type; return next; });
  }, []);
  const applyMotionAlternate = useCallback((names) => {
    setMotionByName(() => {
      const next = {};
      names.forEach((n, i) => { next[n] = i % 2 === 0 ? "zoomin" : "zoomout"; });
      return next;
    });
  }, []);
  // Random mix: assign each cut a transition drawn randomly from `picks`
  // (no back-to-back repeats). One commit = one undo step.
  const applyTransitionMix = useCallback((picks, clipNames) => {
    const cutNames = clipNames.slice(1); // first image has no incoming transition
    const assigned = mixTransitions(picks, cutNames.length);
    commitDoc((d) => {
      const next = {};
      cutNames.forEach((name, i) => { next[name] = assigned[i]; });
      return { ...d, transitionsByName: next };
    });
  }, [commitDoc]);

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const items = useMemo(
    () => slots.map((s) => ({
      name: s.id, seconds: s.seconds, empty: s.empty,
      label: (s.img && s.img.fileName) || (s.file && s.file.name) || s.id,
    })),
    [slots]
  );
  // Images and videos are uploaded on separate maps (the backend tells them apart
  // by extension anyway, but this keeps the client render spec explicit).
  const imagesByName = useMemo(() => {
    const m = {};
    for (const s of slots) if (!s.empty && s.file && !(s.img && s.img.isVideo)) m[s.id] = s.file;
    return m;
  }, [slots]);
  const videosByName = useMemo(() => {
    const m = {};
    for (const s of slots) if (!s.empty && s.file && s.img && s.img.isVideo) m[s.id] = s.file;
    return m;
  }, [slots]);
  // Video URL + duration per clip, for the trim scrubber in the inspector.
  const videoInfoByName = useMemo(() => {
    const m = {};
    for (const s of slots) if (!s.empty && s.img && s.img.isVideo) {
      m[s.id] = { url: s.img.videoUrl, duration: s.img.videoDuration || 0 };
    }
    return m;
  }, [slots]);
  const imageEls = useMemo(() => {
    const m = {};
    for (const s of slots) if (!s.empty && s.img) m[s.id] = s.img;
    return m;
  }, [slots]);
  const imageCount = useMemo(() => slots.filter((s) => !s.empty && s.img).length, [slots]);

  // Staged thumbnails for the pre-build import tray, ordered by timestamp
  // (files with no parseable timestamp sort last and are flagged).
  const tray = useMemo(
    () => slots
      .filter((s) => !s.empty && s.img)
      .map((s) => ({ id: s.id, url: s.img.url, name: s.img.fileName || (s.file && s.file.name) || "", seconds: s.seconds }))
      .sort((a, b) => (a.seconds == null ? Infinity : a.seconds) - (b.seconds == null ? Infinity : b.seconds)),
    [slots]
  );

  const sample = useMemo(() => {
    const imaged = slots
      .filter((s) => !s.empty && s.img && s.seconds != null)
      .sort((a, b) => a.seconds - b.seconds);
    const el = imaged[0] && imaged[0].img;
    return el ? { width: el.naturalWidth, height: el.naturalHeight } : null;
  }, [slots]);

  const dims = useMemo(() => resolveDimensions(aspect, sample), [aspect, sample]);
  // The resolution actually exported: capped to 720p when the faster option is on.
  const renderDims = useMemo(
    () => (renderQuality === "720p" ? capTo720(dims) : dims),
    [renderQuality, dims]
  );

  // On mobile (touch), default to the lighter settings — ~2x faster, far less
  // CPU/RAM load (which also helps avoid Termux connection drops). Runs once.
  useEffect(() => {
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
        setRenderQuality("720p");
        setFps(24);
      }
    } catch { /* ignore */ }
  }, []);
  const { clips, warnings } = useMemo(
    () => buildTimeline(items, audioDuration),
    [items, audioDuration]
  );

  // A new voiceover resets any prior trim to the full length.
  useEffect(() => { setTrimEnd(audioDuration); }, [audioDuration]);

  const exportDuration = trimEnd > 0 ? Math.min(trimEnd, audioDuration) : audioDuration;

  const ready = audioFile && clips.length > 0;
  const showEditor = built && ready;

  // --- Projects: client-side persistence (IndexedDB) ------------------------
  // On launch, ask for durable storage and load the saved projects list.
  useEffect(() => {
    (async () => {
      try {
        await requestPersist();
        setProjects(await listProjects());
        setStorage(await storageEstimate());
      } catch (_) {}
    })();
  }, []);

  const resetAllState = useCallback(() => {
    // Touch devices default to lighter 720p / 24fps (less CPU/RAM) for new projects.
    let coarse = false;
    try { coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (_) {}
    setAudioFile(null); setAudioUrl(null); setAudioDuration(0); setPeaks([]);
    setAspect("16:9"); setFps(coarse ? 24 : 30); setRenderQuality(coarse ? "720p" : "full");
    setTransitionDuration(DEFAULT_TRANSITION_DURATION); setFadeIn(0.5); setFadeOut(0.6);
    setMotionByName({}); setMotionAmount(0.08); setTrimByName({}); setVolumeByName({}); setFitByName({});
    setTrimEnd(0);
    setCaptionsTrack([]); setCaptionName(null); setCaptionsOn(false); setCaptionStyle("clean");
    setCaptionAnimation("word-highlight"); setCaptionOverrides({});
    setCaptionSize("md"); setCaptionLineHeight(null); setCaptionFontScale(null);
    setError(null); setOutUrl(null); setProgress(0);
    idRef.current = 0;
    resetDoc({ slots: [], transitionsByName: {} });
    setBuilt(false);
  }, [resetDoc]);

  const newProject = useCallback(() => {
    flushResume();
    resetAllState();
    const id = newId();
    startResume(id, null);
    setCurrentProject({ id, name: "Untitled project", createdAt: Date.now() });
    setView("editor");
  }, [resetAllState, flushResume, startResume]);

  // A small JPEG thumbnail from the first image, stored with the project.
  const makeThumb = useCallback(() => {
    const s = slots.find((x) => !x.empty && x.img);
    const img = s && s.img;
    if (!img) return null;
    try {
      const iw = img.naturalWidth || img.videoWidth || 320;
      const ih = img.naturalHeight || img.videoHeight || 180;
      const W = 320, H = Math.max(1, Math.round((W * ih) / iw));
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      c.getContext("2d").drawImage(img, 0, 0, W, H);
      return c.toDataURL("image/jpeg", 0.7);
    } catch (_) { return (img.url && String(img.url).startsWith("data:")) ? img.url : null; }
  }, [slots]);

  // Serialize the edit state (no media bytes) for the projects store.
  const buildProjectData = useCallback(() => ({
    v: 1,
    settings: { aspect, fps, renderQuality, transitionDuration, fadeIn, fadeOut, motionAmount, trimEnd },
    maps: { motionByName, trimByName, volumeByName, fitByName },
    captions: { captionsTrack, captionName, captionsOn, captionStyle, captionAnimation, captionOverrides, captionSize, captionLineHeight, captionFontScale },
    transitionsByName,
    slots: slots.map((s) => ({
      id: s.id, mediaId: s.mediaId || s.id, seconds: s.seconds, empty: !!s.empty,
      fileName: s.file ? s.file.name : (s.img && s.img.fileName) || null,
      isVideo: !!(s.img && s.img.isVideo),
    })),
    audioName: audioFile ? audioFile.name : null,
    idCounter: idRef.current,
    built,
    playhead: playheadRef.current,
    resume: { ...resumeRef.current.state, playheadTime: playheadRef.current, lastEditedAt: Date.now() },
  }), [aspect, fps, renderQuality, transitionDuration, fadeIn, fadeOut, motionAmount, trimEnd,
      motionByName, trimByName, volumeByName, fitByName,
      captionsTrack, captionName, captionsOn, captionStyle, captionAnimation, captionOverrides, captionSize, captionLineHeight, captionFontScale,
      transitionsByName, slots, audioFile, built]);

  const saveCurrent = useCallback(async () => {
    const proj = currentProject;
    if (!proj || loadingProject) return; // never save a half-loaded project
    try {
      const rec = {
        id: proj.id, name: proj.name, createdAt: proj.createdAt || Date.now(),
        thumb: makeThumb(), durationSec: exportDuration, clipCount: clips.length,
        data: buildProjectData(),
      };
      await saveProject(rec);
      const wanted = new Map();
      if (audioFile) wanted.set("audio", audioFile);
      for (const s of slots) if (!s.empty && s.file) wanted.set(s.mediaId || s.id, s.file);
      await syncMedia(proj.id, wanted);
      try { setStorage(await storageEstimate()); } catch (_) {}
    } catch (_) { /* storage full or unavailable — keep editing */ }
  }, [currentProject, loadingProject, makeThumb, exportDuration, clips.length, buildProjectData, audioFile, slots]);
  saveRef.current = saveCurrent;

  // Debounced autosave whenever the composition changes.
  useEffect(() => {
    if (view !== "editor" || !currentProject || loadingProject) return;
    const t = setTimeout(() => { if (saveRef.current) saveRef.current(); }, 1200);
    return () => clearTimeout(t);
  }, [view, currentProject, loadingProject, slots, transitionsByName, aspect, fps, renderQuality, transitionDuration,
      fadeIn, fadeOut, motionByName, motionAmount, trimByName, volumeByName, fitByName, trimEnd,
      captionsTrack, captionName, captionsOn, captionStyle, captionAnimation, captionOverrides, captionSize, captionLineHeight, captionFontScale,
      audioFile, built]);

  const removeCaptions = useCallback(async () => {
    const ok = await showConfirm("Remove all captions from this project? This can't be undone.", { title: "Remove captions", okText: "Remove", danger: true });
    if (!ok) return;
    setCaptionsTrack([]); setCaptionName(null); setCaptionsOn(false);
  }, []);

  const exportCaptions = useCallback((format) => {
    const base = (currentProject && currentProject.name) || "captions";
    downloadCaptions(captionsTrack, format, base);
  }, [captionsTrack, currentProject]);

    const handleGenerateCaptions = async () => {
    if (!audioFile) {
      setError("Please add an audio track first.");
      return;
    }
    setGeneratingCaptions(true);
    setGenCapStatus("Starting...");
    try {
      const state = { audioFile };
      const options = { mode: "main", segmentation: { maxChars: 42 } };
      
      const newCaptions = await generateCaptionsFlow(state, options, (progress) => {
        setGenCapStatus(progress.status);
      });
      
      const failed = newCaptions.failedSections || [];
      setCaptionsTrack([...newCaptions]);
      setCaptionName("Generated from Audio");
      setCaptionsOn(true);
      if (failed.length) {
        setError(`Captions generated, but ${failed.length} section${failed.length === 1 ? "" : "s"} couldn't be transcribed and ${failed.length === 1 ? "has" : "have"} no captions: ${failed.join(", ")}.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingCaptions(false);
      setGenCapStatus("");
    }
  };

  const openProject = useCallback(async (id) => {
    await flushResume(); // the project being left keeps its place
    const rec = await getProject(id);
    if (!rec) return;
    const d = rec.data || {};
    // Open the editor shell right away with a loader; media loads in the background.
    // (loadingProject guards autosave so this cleared state is never saved back.)
    resetAllState();
    setCurrentProject({ id: rec.id, name: rec.name, createdAt: rec.createdAt });
    setLoadingProject(true);
    setView("editor");
    try {
      // Decode the audio and ALL slot media in parallel — 100+ images loading
      // one-by-one is what made opening slow.
      const audioP = (async () => {
        if (!d.audioName) return null;
        const blob = await getMedia(id, "audio");
        if (!blob) return null;
        const file = new File([blob], d.audioName, { type: blob.type || "audio/mpeg" });
        let dur = 0; try { dur = await getAudioDuration(file); } catch (_) {}
        return { file, dur };
      })();
      const slotsP = mapLimit(d.slots || [], 12, async (sm) => {
        if (sm.empty) return { id: sm.id, mediaId: sm.mediaId || sm.id, seconds: sm.seconds, file: null, img: null, empty: true };
        const mediaId = sm.mediaId || sm.id;
        const blob = await getMedia(id, mediaId);
        if (!blob) return { id: sm.id, mediaId, seconds: sm.seconds, file: null, img: null, empty: true };
        const file = new File([blob], sm.fileName || sm.id, { type: blob.type || (sm.isVideo ? "video/mp4" : "image/png") });
        const img = sm.isVideo ? await loadVideoEl(file) : await loadImageEl(file);
        return { id: sm.id, mediaId, seconds: sm.seconds, file, img, empty: false };
      });
      const [audio, newSlots] = await Promise.all([audioP, slotsP]);
      // Commit the loaded project.
      if (audio) {
        setAudioFile(audio.file); setAudioUrl(URL.createObjectURL(audio.file));
        setAudioDuration(audio.dur);
        getWaveformPeaks(audio.file).then(setPeaks).catch(() => {});
      }
      resetDoc({ slots: newSlots, transitionsByName: d.transitionsByName || {} });
      const st = d.settings || {};
      setAspect(st.aspect ?? "16:9"); setFps(st.fps ?? 30); setRenderQuality(st.renderQuality ?? "full");
      setTransitionDuration(st.transitionDuration ?? DEFAULT_TRANSITION_DURATION);
      setFadeIn(st.fadeIn ?? 0.5); setFadeOut(st.fadeOut ?? 0.6);
      setMotionAmount(st.motionAmount ?? 0.08); setTrimEnd(st.trimEnd ?? 0);
      const mp = d.maps || {};
      setMotionByName(mp.motionByName || {}); setTrimByName(mp.trimByName || {});
      setVolumeByName(mp.volumeByName || {}); setFitByName(mp.fitByName || {});
      const cp = d.captions || {};
        if (cp.captionRaw && (!cp.captionsTrack || !cp.captionsTrack.length)) {
           const res = parseSRT(cp.captionRaw);
           setCaptionsTrack(res.error ? [] : res.captions);
        } else {
           setCaptionsTrack(cp.captionsTrack || []);
        }
        setCaptionName(cp.captionName ?? null);
      setCaptionsOn(!!cp.captionsOn); setCaptionStyle(normalizeStyleId(cp.captionStyle ?? "clean"));
      // Projects from before the animation picker stored it on each caption.
      setCaptionAnimation(normalizeAnimationId(cp.captionAnimation
        ?? ((cp.captionsTrack && cp.captionsTrack[0] && cp.captionsTrack[0].animationId) || "none")));
      setCaptionOverrides(cp.captionOverrides && typeof cp.captionOverrides === "object" ? cp.captionOverrides : {});
      setCaptionSize(cp.captionSize ?? "md"); setCaptionLineHeight(cp.captionLineHeight ?? null);
      setCaptionFontScale(cp.captionFontScale ?? null);
      idRef.current = d.idCounter || newSlots.length;
      setBuilt(!!d.built);
      const saved = d.resume && typeof d.resume === "object" ? d.resume : { playheadTime: d.playhead || 0 };
      if (saved.playheadTime == null) saved.playheadTime = d.playhead || 0;
      setInitialPlayhead(saved.playheadTime);
      playheadRef.current = saved.playheadTime;
      startResume(id, saved);
    } finally { setLoadingProject(false); }
  }, [resetDoc, resetAllState, flushResume, startResume]);

  // navigator.storage.estimate() lags behind an IndexedDB delete/write, so re-poll
  // a few times to catch the freed/added space without needing a manual refresh.
  const refreshStorage = useCallback(() => {
    const tick = async () => { try { setStorage(await storageEstimate()); } catch (_) {} };
    tick();
    setTimeout(tick, 500);
    setTimeout(tick, 1500);
    setTimeout(tick, 3000);
  }, []);

  const [savingBack, setSavingBack] = useState(false);
  const backToProjects = useCallback(async () => {
    setSavingBack(true);
    try { if (saveRef.current) await saveRef.current(); } catch (_) {}
    setSavingBack(false);
    setProjects(await listProjects());
    refreshStorage();
    setView("list");
  }, [refreshStorage]);

  const onRenameProject = useCallback(async (id, name) => {
    await renameProject(id, name);
    setCurrentProject((p) => (p && p.id === id ? { ...p, name } : p));
    setProjects(await listProjects());
  }, []);
  const onDeleteProject = useCallback(async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) await deleteProject(id);
    if (window.studio) await window.studio.deleteProjectAssets(list);
    setProjects(await listProjects());
    refreshStorage();
  }, [refreshStorage]);
  const renameCurrent = useCallback(async () => {
    if (!currentProject) return;
    const name = await showPrompt("Rename project", {
      title: "Rename project", defaultValue: currentProject.name || "Untitled project", okText: "Rename",
    });
    if (name && name.trim()) onRenameProject(currentProject.id, name.trim());
  }, [currentProject, onRenameProject]);

  // ---- VoiceCraft Studio: shared project + asset library ----
  // The studio (electron/studio.js) holds the current project for every module
  // and the project's assets (narration, Flow results, captions). The
  // AutoEditor follows the studio's project, tells it which one is open, and
  // imports assets on request.
  const [studioOn, setStudioOn] = useState(false);
  const slotsRef = useRef([]); // the latest timeline, for import de-duplication
  const [projectAssets, setProjectAssets] = useState([]);
  const studioRef = useRef({});
  const ensureRef = useRef(null);
  useEffect(() => { setStudioOn(!!(typeof window !== "undefined" && window.studio)); }, []);

  // Open project `id` (or start it, if it only exists in the studio so far).
  // Concurrent calls for the same project share one open.
  const ensureProject = useCallback(async (id, name) => {
    const st = studioRef.current;
    if (st.currentProject && st.currentProject.id === id && !st.loadingProject) { setView("editor"); return; }
    if (ensureRef.current && ensureRef.current.id === id) return ensureRef.current.promise;
    const promise = (async () => {
      try { if (saveRef.current) await saveRef.current(); } catch (_) {}
      const rec = await getProject(id);
      if (rec) await openProject(id);
      else {
        await flushResume();
        resetAllState();
        startResume(id, null);
        setCurrentProject({ id, name: name || "Untitled project", createdAt: Date.now() });
        setView("editor");
      }
    })();
    ensureRef.current = { id, promise };
    try { await promise; } finally { if (ensureRef.current && ensureRef.current.id === id) ensureRef.current = null; }
  }, [openProject, resetAllState, flushResume, startResume]);

  const assetUrl = useCallback((a) => (window.studio ? window.studio.assetUrl(a.projectId, a.id) : ""), []);

  // A finished render goes into the project's renders folder (streamed in
  // chunks — videos can be large) and shows up in the Renders panel.
  const saveRenderToProject = useCallback(async (blob, meta) => {
    const S = window.studio;
    const proj = studioRef.current.currentProject;
    if (!S || !proj || !blob) return null;
    const job = await S.renderBegin({ projectId: proj.id, projectName: proj.name || "Untitled project" });
    try {
      const CHUNK = 16 * 1024 * 1024;
      for (let at = 0; at < blob.size; at += CHUNK) {
        await S.renderChunk(job.id, await blob.slice(at, at + CHUNK).arrayBuffer());
      }
      return await S.renderFinish(job.id, meta);
    } catch (e) {
      try { await S.renderAbort(job.id); } catch (_) { /* gone */ }
      throw e;
    }
  }, []);

  // Bring project assets into this edit: images/videos by their timestamp
  // names, the newest audio as the voiceover, the newest captions.
  const importAssets = useCallback(async (list) => {
    if (!list || !list.length) return;
    const toFile = async (a) => {
      const blob = await (await fetch(assetUrl(a))).blob();
      const mime = blob.type && blob.type !== "application/octet-stream" ? blob.type
        : a.mime || (a.type === "image" ? "image/png" : a.type === "video" ? "video/mp4" : a.type === "audio" ? "audio/wav" : "text/plain");
      return new File([blob], a.filename, { type: mime });
    };
    const newest = (t) => list.filter((a) => a.type === t).sort((x, y) => y.createdAt - x.createdAt)[0];
    // Timestamp-named media replace the clip at that second; others are added
    // once — sending the same picture again doesn't duplicate it.
    const onTimeline = new Set(slotsRef.current.filter((x) => !x.empty).map((x) => (x.file && x.file.name) || (x.img && x.img.fileName)).filter(Boolean));
    const visuals = list.filter((a) => (a.type === "image" || a.type === "video")
      && (parseTimestampName(a.filename) != null || !onTimeline.has(a.filename)));
    if (visuals.length) await addImages(await Promise.all(visuals.map(toFile)));
    const audio = newest("audio");
    if (audio) await onAudio([await toFile(audio)], audio.duration || null);
    const cap = newest("caption");
    if (cap) await onCaptionFile(await toFile(cap));
    setView("editor");
  }, [assetUrl, addImages, onAudio, onCaptionFile]);

  const removeAsset = useCallback(async (a) => {
    if (!window.studio) return;
    const ok = await showConfirm(`Remove “${a.filename}” from the project? It stays in your edit if it's already there.`, { title: "Remove asset", okText: "Remove", danger: true });
    if (ok) await window.studio.removeAsset(a.projectId, a.id);
  }, []);

  const inTimeline = useCallback((a) => {
    if (a.type === "audio") return !!(audioFile && audioFile.name === a.filename);
    if (a.type === "caption") return !!(captionName && captionName === a.filename);
    return slots.some((s) => !s.empty && ((s.file && s.file.name === a.filename) || (s.img && s.img.fileName === a.filename)));
  }, [audioFile, captionName, slots]);

  loadingRef.current = loadingProject;
  slotsRef.current = slots;
  studioRef.current = { currentProject, loadingProject, ensureProject, importAssets, newProject, backToProjects };

  // Tell the studio which project is open here.
  useEffect(() => {
    if (window.studio && currentProject) window.studio.setProject({ id: currentProject.id, name: currentProject.name || "Untitled project" });
  }, [currentProject && currentProject.id, currentProject && currentProject.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // This project's assets, kept live.
  useEffect(() => {
    let alive = true;
    if (!window.studio || !currentProject) { setProjectAssets([]); return undefined; }
    window.studio.assets(currentProject.id).then((list) => { if (alive) setProjectAssets(list || []); });
    return () => { alive = false; };
  }, [currentProject && currentProject.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A project opened here that has assets but an empty edit starts with them.
  const autoImportedRef = useRef(new Set());
  useEffect(() => {
    if (!currentProject || loadingProject || !projectAssets.length) return;
    if (autoImportedRef.current.has(currentProject.id)) return;
    autoImportedRef.current.add(currentProject.id);
    const emptyEdit = !audioFile && !slots.some((s) => !s.empty);
    if (emptyEdit) importAssets(projectAssets.filter((a) => a.type !== "other"));
  }, [currentProject, loadingProject, projectAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const S = window.studio;
    if (!S) return undefined;
    const offs = [
      S.onProjectChanged(async (p) => {
        const st = studioRef.current;
        if (!p) {
          // Project closed (or deleted) in the studio: save and go to the list.
          if (st.currentProject) {
            await st.backToProjects();
            setCurrentProject(null);
          }
          return;
        }
        if (st.currentProject && st.currentProject.id === p.id) {
          if (p.name && p.name !== st.currentProject.name) setCurrentProject((c) => (c ? { ...c, name: p.name } : c));
          return;
        }
        await st.ensureProject(p.id, p.name);
      }),
      S.onAssetAdded((a) => {
        const cp = studioRef.current.currentProject;
        if (cp && a.projectId === cp.id) setProjectAssets((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
      }),
      S.onAssetUpdated && S.onAssetUpdated((a) => {
        const cp = studioRef.current.currentProject;
        if (cp && a && a.projectId === cp.id) setProjectAssets((prev) => prev.map((x) => (x.id === a.id ? a : x)));
      }),
      S.onAssetRemoved(({ projectId, assetId }) => {
        const cp = studioRef.current.currentProject;
        if (cp && projectId === cp.id) setProjectAssets((prev) => prev.filter((x) => x.id !== assetId));
      }),
      S.onImportAssets(async ({ projectId, assetIds }) => {
        const st = studioRef.current;
        if (projectId) {
          const cur = (await S.getState()).project;
          await st.ensureProject(projectId, cur && cur.id === projectId ? cur.name : undefined);
        }
        const all = await S.assets(projectId);
        await studioRef.current.importAssets(assetIds ? all.filter((a) => assetIds.includes(a.id)) : all);
      }),
      S.onCheckTransfer(() => { if (checkTransferRef.current) checkTransferRef.current(); }),
      S.onNewProject(() => studioRef.current.newProject()),
      S.onShowProjects(() => studioRef.current.backToProjects()),
      S.onProjectsDeleted(async () => setProjects(await listProjects())),
    ];
    // Start on the studio's project (it may have been picked before this
    // module was opened), then take any queued hand-offs.
    S.getState().then(async (st) => {
      if (st.project && !studioRef.current.currentProject) await studioRef.current.ensureProject(st.project.id, st.project.name);
    }).finally(() => S.editorReady && S.editorReady());
    return () => offs.forEach((off) => off && off());
  }, []);

  const cancelRef = useRef(false);
  const onCancel = useCallback(() => {
    cancelRef.current = true;
    cancelRender();
    setBusy(false);
    setProgress(0);
  }, []);
  const wcCancelRef = useRef(false);
  const onWebCodecsCancel = useCallback(() => { wcCancelRef.current = true; }, []);

  const [doneMsg, setDoneMsg] = useState(null);       // transient "render complete" toast
  const doneTimerRef = useRef(0);
  const flashDone = useCallback((msg) => {
    setDoneMsg(msg);
    clearTimeout(doneTimerRef.current);
    doneTimerRef.current = setTimeout(() => setDoneMsg(null), 6000);
  }, []);

  const onRender = useCallback(async () => {
    cancelRef.current = false;
    setBusy(true); setError(null); setOutUrl(null); setProgress(0);
    try {
      const exportClips = trimClips(clips, exportDuration);
      const transitions = exportClips.map((c) => transitionsByName[c.name] || "cut");
      const motions = exportClips.map((c) => motionByName[c.name] || "none");
      // Per-clip video params (parallel to exportClips). Images get 0/1/none.
      // Default depends on length: a clip LONGER than its slot trims (1x + in-point,
      // extra cut off); a clip SHORTER slows to fill the slot ("fit"). An explicit
      // fitByName choice overrides the default.
      const modeOf = (c) => {
        const info = videoInfoByName[c.name];
        if (!info) return "fit";
        return fitByName[c.name] || ((info.duration || 0) > (c.duration || 0) ? "trim" : "fit");
      };
      const trims = exportClips.map((c) =>
        (videoInfoByName[c.name] && modeOf(c) === "trim") ? (trimByName[c.name] || 0) : 0);
      const speeds = exportClips.map((c) => {
        const info = videoInfoByName[c.name];
        if (!info) return 1;
        const dur = info.duration || 0, slot = c.duration || 0;
        return (modeOf(c) === "fit" && slot > 0 && dur > 0 && Math.abs(dur - slot) > 0.05) ? +(dur / slot).toFixed(4) : 1;
      });
      const volumes = exportClips.map((c) =>
        Object.prototype.hasOwnProperty.call(videosByName, c.name)
          ? (volumeByName[c.name] == null ? 0.5 : volumeByName[c.name]) : 0);
      const captions = captionsOn && captionCues.length ? captionCues : null;
      const blob = await renderVideo({
        clips: exportClips, imagesByName, videosByName, audioFile,
        width: renderDims.width, height: renderDims.height, fps,
        transitions, transitionDuration, motions, motionAmount, trims, volumes, speeds, fadeIn, fadeOut,
        // The ffmpeg backend (only used where the browser can't encode video)
        // burns static drawtext captions: map to its nearest look.
        captions,
        captionStyle: ["boxed", "typewriter", "modern", "lowerthird"].includes(captionStyle) ? "boxed"
          : captionStyle === "yellow" ? "yellow" : "classic",
        captionSize, captionLineHeight, captionFontScale,
        onProgress: setProgress,
      });
      const safeUrl = (blob && (blob instanceof Blob || blob instanceof File)) ? URL.createObjectURL(blob) : null;
      setOutUrl(safeUrl);
      if (safeUrl && window.studio && studioRef.current.currentProject) {
        try {
          const saved = await saveRenderToProject(blob, { duration: exportDuration, width: renderDims.width, height: renderDims.height, fps, engine: "ffmpeg" });
          if (saved) flashDone(`Saved “${saved.filename}” to the project`);
        } catch (e) { setError("Rendered, but couldn't save it to the project: " + (e.message || e)); }
      }
    } catch (e) {
      if (!cancelRef.current) setError(e.message || String(e));
    } finally {
      if (!cancelRef.current) setBusy(false);
    }
  }, [clips, exportDuration, imagesByName, videosByName, audioFile, renderDims, fps, transitionsByName, transitionDuration,
      motionByName, motionAmount, trimByName, volumeByName, fitByName, videoInfoByName, fadeIn, fadeOut,
      captionsOn, captionCues, captionStyle, captionSize, captionLineHeight, captionFontScale, saveRenderToProject, flashDone]);

  // --- SPIKE: WebCodecs GPU render (video-only, no audio). Proves the pipeline. ---
  const [wcBusy, setWcBusy] = useState(false);
  const [wcProgress, setWcProgress] = useState(0);
  const [wcPhase, setWcPhase] = useState("Rendering");
  const [wcOk, setWcOk] = useState(false);
  const [serverAvailable, setServerAvailable] = useState(false); // ffmpeg backend reachable?
  const [wcEnabled, setWcEnabled] = useState(true); // WebCodecs on by default (desktop)
  const [wcProfile, setWcProfile] = useState(null); // resolved render profile (mp4)
  const [renderChecked, setRenderChecked] = useState(false); // capability probes done
  useEffect(() => {
    let alive = true;
    (async () => {
      const [wc, srv] = await Promise.all([
        webCodecsCanRender().catch(() => false),
        probeBackend().catch(() => false),
      ]);
      if (!alive) return;
      setWcOk(wc); setServerAvailable(srv); setRenderChecked(true);
    })();
    return () => { alive = false; };
  }, []);
  // No way to export in this browser: no H.264 WebCodecs and no render backend.
  const cantRender = renderChecked && !wcOk && !serverAvailable;
  // Resolve the output profile up front (recomputed when size/fps change) so the
  // Save dialog and filename use the right extension without an await after click.
  useEffect(() => {
    let alive = true;
    if (!wcOk) { setWcProfile(null); return; }
    pickRenderProfile(renderDims.width, renderDims.height, fps, 8_000_000)
      .then((p) => { if (alive) setWcProfile(p); }).catch(() => { if (alive) setWcProfile(null); });
    return () => { alive = false; };
  }, [wcOk, renderDims.width, renderDims.height, fps]);
  const onWebCodecsTest = useCallback(async () => {
    wcCancelRef.current = false;
    const logs = []; // diagnostics — shown in the failure dialog
    const profile = wcProfile;
    if (!profile) {
      showAlert("This browser can't encode video. Use Chrome, Edge, or Safari 16.4+.", { title: "Fast render unavailable" });
      return;
    }
    const fileName = `${((currentProject && currentProject.name) || "autoeditor").replace(/[^\w.-]+/g, "_") || "autoeditor"}.mp4`;
    // The renderer muxes into a chunked buffer (no single-ArrayBuffer size limit),
    // so large videos download normally — no save dialog / File System API needed.
    const writable = null;
    setWcBusy(true); setWcProgress(0); setWcPhase("Rendering");
    // Play inaudible audio for the duration so a backgrounded tab keeps rendering
    // at full speed (started here, inside the click gesture, so it's allowed).
    const stopKeepAwake = startKeepAwake();
    try {
      const exportClips = trimClips(clips, exportDuration);
      const transitions = exportClips.map((c) => transitionsByName[c.name] || "cut");
      const motions = exportClips.map((c) => motionByName[c.name] || "none");
      // Per-clip video params (parallel to exportClips), same rule as the ffmpeg
      // path: long clip → trim (1x + in-point), short clip → fit (slow to fill).
      const modeOf = (c) => {
        const info = videoInfoByName[c.name];
        if (!info) return "fit";
        return fitByName[c.name] || ((info.duration || 0) > (c.duration || 0) ? "trim" : "fit");
      };
      const trims = exportClips.map((c) =>
        (videoInfoByName[c.name] && modeOf(c) === "trim") ? (trimByName[c.name] || 0) : 0);
      const speeds = exportClips.map((c) => {
        const info = videoInfoByName[c.name];
        if (!info) return 1;
        const dur = info.duration || 0, slot = c.duration || 0;
        return (modeOf(c) === "fit" && slot > 0 && dur > 0 && Math.abs(dur - slot) > 0.05) ? +(dur / slot).toFixed(4) : 1;
      });
      const volumes = exportClips.map((c) =>
        Object.prototype.hasOwnProperty.call(videosByName, c.name)
          ? (volumeByName[c.name] == null ? 0.5 : volumeByName[c.name]) : 0);
      // Request the full 8 Mbps. The renderer decides the effective rate: a streamed
      // (to-disk) output keeps it, while an in-memory output is capped to a memory-safe
      // rate for long videos — it makes that call because only it knows whether streaming
      // actually engaged (see renderWebCodecs).
      const bitrate = 8_000_000;
      const blob = await renderWebCodecs(
        {
          clips: exportClips, width: renderDims.width, height: renderDims.height, fps, bitrate, profile,
          transitions, transitionDuration, motions, motionAmount, audioFile,
          videosByName, trims, speeds, volumes,
          cues: captionsOn && captionCues.length ? captionCues : null,
          captionOpts, fadeIn, fadeOut,
        },
        imagesByName,
        (frac, phase) => { setWcProgress(frac); if (phase) setWcPhase(phase); },
        () => wcCancelRef.current,
        logs,
        writable,
      );
      // Audio can be dropped without failing the whole render (e.g. an unsupported
      // codec/rate) — the video still saves. Surface that clearly so a silent, soundless
      // file isn't a surprise.
      const audioIssue = logs.find((l) => /audio failed|produced no audio/i.test(l));
      if (blob && window.studio && studioRef.current.currentProject) {
        // In the studio: keep it with the project (Renders panel).
        setWcPhase("Saving");
        const saved = await saveRenderToProject(blob, {
          duration: exportDuration, width: renderDims.width, height: renderDims.height, fps, engine: "webcodecs",
          audioIssue: audioIssue ? "no-audio" : null,
        });
        flashDone(audioIssue ? `Saved “${saved.filename}” — no audio` : `Saved “${saved.filename}” to the project`);
      } else if (blob) { // in-memory result → download; a streamed render is already on disk
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        flashDone(audioIssue ? `Downloaded “${fileName}” — no audio` : `Downloaded “${fileName}”`);
      } else { // streamed straight to the file the user chose — no browser download
        flashDone(audioIssue ? `Saved “${fileName}” — no audio` : `Saved to “${fileName}”`);
      }
      if (audioIssue) {
        showAlert("Your video was created, but the audio couldn’t be added, so the file has no sound.",
          { title: "Video saved without audio", details: `${audioIssue}\n\nThis usually means an unusual audio format. Try re-exporting the voiceover as a standard 48 kHz WAV or MP3 and render again.` });
      }
    } catch (e) {
      if (writable) { try { await writable.abort(); } catch (_) {} } // discard partial file
      if (!(e && e.cancelled)) {
        const details = [
          `Error: ${e && e.message ? e.message : String(e)}`,
          "",
          "— render log —",
          ...logs,
          "",
          "— environment —",
          `resolution: ${renderDims.width}x${renderDims.height} @ ${fps}fps`,
          `userAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
          e && e.stack ? `\nstack:\n${e.stack}` : "",
        ].join("\n");
        // WebKit's (Safari / any iOS browser) video encoder gives up on long encodes
        // with "Encoding task did not complete" (then "not configured"). It's a browser
        // limit — Chromium handles it — so point the user there instead of a generic error.
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isMacSafari = /Macintosh/.test(ua) && / Version\/.*Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);
        const msg = (e && e.message ? e.message : "").toLowerCase();
        const encoderGaveUp = msg.includes("not configured") || msg.includes("did not complete") || logs.some((l) => /did not complete/i.test(l));
        if (isIOS && encoderGaveUp) {
          // Every browser on iPhone/iPad is WebKit, so "use Chrome on iPhone" wouldn't help.
          showAlert("This video is too long for an iPhone or iPad to finish encoding — every browser on iOS shares the same limit. Please render on a computer (Chrome or Edge) or an Android phone, or export a shorter / lower-resolution video.",
            { title: "Render long videos on a computer", details });
        } else if (isMacSafari && encoderGaveUp) {
          showAlert("Safari couldn’t finish this render — its video encoder gives up on long videos. Please render in Google Chrome or Microsoft Edge on this Mac (or export a shorter / lower-resolution video).",
            { title: "Use Chrome or Edge for long renders", details });
        } else {
          showAlert("The Fast render failed. Copy the details below if you want to report it.",
            { title: "Fast render failed", details });
        }
      }
    } finally {
      stopKeepAwake();
      setWcBusy(false);
      setWcProgress(0);
      setWcPhase("Rendering");
    }
  }, [clips, exportDuration, transitionsByName, motionByName, imagesByName, renderDims, fps, transitionDuration, motionAmount, audioFile,
      videosByName, videoInfoByName, fitByName, trimByName, volumeByName, currentProject, flashDone, wcProfile, saveRenderToProject,
      captionsOn, captionCues, captionOpts, fadeIn, fadeOut]);

  // Browser can't export video (no H.264 WebCodecs, no render backend) — block the
  // whole app; there's no point letting them create projects they can't render.
  if (cantRender) {
    return (
      <main className="unsupported">
        <div className="unsupported__card">
          <img className="unsupported__logo" src="/logo.svg" width="52" height="52" alt="" />
          <h1 className="unsupported__h">Open in Chrome, Edge, or Safari</h1>
          <p className="unsupported__p">
            <span className="unsupported__brand">Frameloom AutoEditor</span> exports video using your
            browser’s built-in video encoder — which this browser doesn’t have.
          </p>
          <p className="unsupported__p">
            Please open this site in <b>Google Chrome</b>, <b>Microsoft Edge</b>, or <b>Safari 16.4+</b>
            {" "}to create and export your videos. (Firefox isn’t supported.)
          </p>
        </div>
      </main>
    );
  }

  if (view === "list") {
    return (
      <>
        <DialogHost />
        <ProjectsHome
          projects={projects}
          onNew={newProject}
          onOpen={openProject}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
          storage={storage}
        />
      </>
    );
  }

  return (
    <>
    <DialogHost />
    <main className="app">
      {doneMsg && (
        <div className="donetoast" role="status" aria-live="polite" onClick={() => setDoneMsg(null)}>
          <span className="donetoast__ok" aria-hidden="true">✓</span>
          <span>Render complete — {doneMsg}</span>
        </div>
      )}
      {savingBack && (
        <div className="importing" role="status" aria-live="polite">
          <span className="importing__spin" aria-hidden="true" />
          Saving project…
        </div>
      )}
      <header className="nav">
        <div className="nav__brand">
          <img className="brand__logo" src="/brand/frameloom-mark.svg" alt="" width="28" height="28" />
          <span className="brand__name"><span className="brand__pre">Frameloom</span> AutoEditor</span>
          <span className="brand__tag">image + video · voiceover sync</span>
        </div>
        {/* Inside VoiceCraft Studio the studio bar switches modules. */}
        {!studioOn && (
          <nav className="ws" aria-label="Workspaces">
            <a href="/index.html" className="ws__tab">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
              VoiceCraft
            </a>
            <a href="/auto-editor/index.html" className="ws__tab is-on" aria-current="page">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5v4M16 5v4"/></svg>
              AutoEditor
            </a>
            <a href="/browser.html" className="ws__tab">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
              Browser
            </a>
          </nav>
        )}
        <div className="nav__links">
          <button
            type="button"
            className="tbtn tbtn--primary"
            disabled={saveState === "saving"}
            onClick={async () => {
              setSaveState("saving");
              try { await saveCurrent(); setSaveState("saved"); }
              catch { setSaveState("error"); }
              setTimeout(() => setSaveState("idle"), 2000);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Save"}
          </button>
          <StorageRing storage={storage} />
        </div>
      </header>

      <div className={`projbar${showEditor ? "" : " projbar--onboard"}`}>
        <div className="projbar__id">
          <button className="brand__back" onClick={backToProjects} title="Back to your projects">←</button>
          <button className="brand__proj" onClick={renameCurrent} title="Rename project">
            {currentProject ? (currentProject.name || "Untitled project") : "AutoEditor"}
          </button>
        </div>
        <div className="bar__io">
          <Dropzone
            compact accept="audio/*" onFiles={onAudio} icon="♪"
            title="Import voiceover" filled={!!audioFile}
            filledLabel={audioFile ? audioFile.name : ""}
          />
          <Dropzone
            compact multiple accept="image/*,video/*" onFiles={addImages} icon="▦"
            title="Add media" filled={imageCount > 0}
            filledLabel={imageCount ? `${imageCount} clips` : ""}
          />
        </div>
      </div>

      {resume && (
        <div className={`resume${resume.url ? " resume--done" : resume.error ? " resume--bad" : ""}`}>
          {resume.busy && (
            <span className="resume__msg">
              <span className="resume__spin" aria-hidden="true" />
              A render is still running… {Math.round(resume.progress * 100)}%
            </span>
          )}
          {resume.url && (
            <span className="resume__msg">
              Your video finished rendering.
              <a className="resume__dl" href={resume.url} download="autoeditor.mp4">Download</a>
            </span>
          )}
          {resume.error && <span className="resume__msg">Last render failed: {resume.error}</span>}
          {!resume.busy && (
            <button className="resume__x" onClick={() => setResume(null)} aria-label="Dismiss">✕</button>
          )}
        </div>
      )}


      {currentProject && loadingProject && (
        <div className="importing" role="status" aria-live="polite">
          <span className="importing__spin" aria-hidden="true" />
          Loading project…
        </div>
      )}

      {importing && (
        <div className="importing" role="status" aria-live="polite">
          <span className="importing__spin" aria-hidden="true" />
          Loading media… {importing.done} / {importing.total}
        </div>
      )}

      <div className="content">
      {loadingProject ? (
        <div className="projload">
          <span className="projload__spin" aria-hidden="true" />
          <span className="projload__txt">Loading project…</span>
        </div>
      ) : !showEditor ? (
        <section className="onboard">
          <h1 className="onboard__h">Sync your images to a voiceover, automatically.</h1>
          <p className="onboard__p">
            Name each image or video clip with the second it appears — <code>0-03.png</code> or
            <code>0-03.mp4</code> cuts in at 0:03 — then import them with your voiceover. Video clips
            can be trimmed, zoomed, and their sound mixed under the narration. Review everything below,
            then build the timeline. Everything runs on your device. Nothing is uploaded.
          </p>

          <div style={{ marginBottom: 32, display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Project Name</label>
            <input 
              type="text" 
              placeholder="Untitled Project" 
              value={currentProject?.name || ""}
              onChange={(e) => setCurrentProject(p => p ? { ...p, name: e.target.value } : { id: Date.now().toString(), name: e.target.value, createdAt: Date.now() })}
              style={{ background: "#222", border: "1px solid #444", borderRadius: 8, padding: "10px 16px", color: "#fff", fontSize: 16, width: "100%", maxWidth: 350, textAlign: "center" }}
            />
          </div>

          <div className="onboard__zones">
            <Dropzone
              accept="audio/*" onFiles={onAudio} icon="♪"
              title="Voiceover audio"
              hint="One MP3 or WAV — sets the total length"
              filled={!!audioFile}
              filledLabel={audioFile ? audioFile.name : ""}
            />
            <Dropzone
              multiple accept="image/*,video/*" onFiles={addImages} icon="▦"
              title={tray.length ? "Add more media" : "Storyboard images & video"}
              hint="Images or video clips, named by timestamp (0-00, 0-06…). Drop files or whole folders — even several at once."
              filled={false}
            />
          </div>

          {tray.length > 0 && (
            <div className="tray">
              <div className="tray__head">
                <span className="tray__count">{tray.length} image{tray.length > 1 ? "s" : ""} imported</span>
                <span className="tray__sub">ordered by timestamp — hover to remove</span>
              </div>
              <div className="tray__grid">
                {tray.map((t) => (
                  <div key={t.id} className={`thumb${t.seconds == null ? " thumb--notime" : ""}`} title={t.name}>
                    <img src={t.url} alt="" />
                    <span className="thumb__time">{t.seconds != null ? fmtTime(t.seconds) : "no time"}</span>
                    <button className="thumb__x" title="Remove this image" onClick={() => discardImage(t.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {imageCount > 0 && warnings.length > 0 && (
            <div className="notes">{warnings.map((w, i) => <div className="note" key={i}>{w}</div>)}</div>
          )}
          {error && <div className="note note--bad">{error}</div>}

          <div className="build-row">
            <button
              className="render build"
              disabled={!audioFile || tray.length === 0 || clips.length === 0}
              onClick={() => setBuilt(true)}
            >
              Build timeline →
            </button>
            <span className="build-hint">
              {tray.length === 0
                ? "Import your storyboard images to begin."
                : !audioFile
                  ? "Add a voiceover to build the timeline."
                  : `${tray.length} image${tray.length > 1 ? "s" : ""} · ready to build`}
            </span>
          </div>
          {studioOn && currentProject ? (
            <ProjectAssets
              assets={projectAssets} inTimeline={inTimeline} assetUrl={assetUrl}
              onAdd={importAssets} onRemove={removeAsset} projectName={currentProject.name}
            />
          ) : null}
        </section>
      ) : (
        <Editor
          assetsPanel={studioOn && currentProject ? (
            <ProjectAssets
              assets={projectAssets} inTimeline={inTimeline} assetUrl={assetUrl}
              onAdd={importAssets} onRemove={removeAsset} projectName={currentProject.name}
            />
          ) : null}
          rendersPanel={studioOn && currentProject ? (
            <RendersPanel
              renders={projectAssets.filter((a) => a.source === "render")}
              onRenderNew={wcOk ? onWebCodecsTest : onRender}
              renderBusy={busy || wcBusy}
              canRender={clips.length > 0 && (wcOk || serverAvailable)}
            />
          ) : null}
          initialTime={initialPlayhead}
          onTimeChange={(t) => { playheadRef.current = t; noteResume({ playheadTime: Math.round(t * 1000) / 1000 }); }}
          resume={resumeView} onResumeChange={noteResume}
          clips={clips} imageEls={imageEls} audioUrl={audioUrl}
          duration={audioDuration} peaks={peaks} dims={dims}
          aspect={aspect} setAspect={setAspect} fps={fps} setFps={setFps}
          renderQuality={renderQuality} setRenderQuality={setRenderQuality} renderDims={renderDims}
          onWebCodecsTest={onWebCodecsTest} onWebCodecsCancel={onWebCodecsCancel}
          wcBusy={wcBusy} wcProgress={wcProgress} wcPhase={wcPhase} wcAvailable={wcOk} serverAvailable={serverAvailable}
          wcEnabled={wcEnabled} setWcEnabled={setWcEnabled}
          onRender={onRender} onCancel={onCancel} busy={busy} progress={progress}
          outUrl={outUrl} error={error} warnings={warnings}
          replaceImage={replaceImage} removeImage={removeImage} fillGap={fillGap} deleteGap={deleteGap}
          resizeBoundary={resizeBoundary}
          transitionsByName={transitionsByName} transitionDuration={transitionDuration}
          setTransition={setTransition} applyTransitionAll={applyTransitionAll}
          applyTransitionMix={applyTransitionMix}
          setTransitionDuration={setTransitionDuration}
          fadeIn={fadeIn} setFadeIn={setFadeIn}
          fadeOut={fadeOut} setFadeOut={setFadeOut}
          motionByName={motionByName} setMotion={setMotion}
          applyMotionAll={applyMotionAll} applyMotionAlternate={applyMotionAlternate}
          motionAmount={motionAmount} setMotionAmount={setMotionAmount}
          videoInfoByName={videoInfoByName}
          trimByName={trimByName} setTrim={setTrim}
          volumeByName={volumeByName} setVolume={setVolume}
          fitByName={fitByName} setFit={setFit}
          trimEnd={exportDuration} setTrimEnd={setTrimEnd} exportDuration={exportDuration}
          undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
          captionCues={captionCues} captionsOn={captionsOn} setCaptionsOn={setCaptionsOn}
          captionStyle={captionStyle} setCaptionStyle={setCaptionStyle}
          captionSize={captionSize} setCaptionSize={setCaptionSize}
          captionLineHeight={captionLineHeight} setCaptionLineHeight={setCaptionLineHeight}
          captionFontScale={captionFontScale} setCaptionFontScale={setCaptionFontScale}
          captionAnimation={captionAnimation} setCaptionAnimation={setCaptionAnimation}
          captionOverrides={captionOverrides} setCaptionOverrides={setCaptionOverrides}
          captionOpts={captionOpts} setCaptionsTrack={setCaptionsTrack}
          removeCaptions={removeCaptions} onExportCaptions={exportCaptions}
          captionName={captionName} captionError={captionError} onCaptionFile={onCaptionFile}
          generatingCaptions={generatingCaptions} genCapStatus={genCapStatus} onGenerateCaptions={handleGenerateCaptions}
        />
      )}
      </div>

    </main>
    </>
  );
}
