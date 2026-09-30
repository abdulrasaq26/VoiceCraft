"use client";
import { useCallback, useRef, useState } from "react";

// Draggable divider between two panes. `axis="y"` is a horizontal bar that
// moves up/down; `axis="x"` is a vertical bar that moves left/right. The
// parent owns the size: it gets the size at drag start plus the pointer delta
// (times `sign`), and clamps it itself. Double-click resets.
export default function Splitter({ axis = "y", value, sign = 1, onChange, onReset, label, step = 16 }) {
  const startRef = useRef(null);
  const [active, setActive] = useState(false);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { pos: axis === "y" ? e.clientY : e.clientX, value };
    setActive(true);
    document.body.classList.add(axis === "y" ? "is-resizing-y" : "is-resizing-x");
  }, [axis, value]);

  const onPointerMove = useCallback((e) => {
    const s = startRef.current;
    if (!s) return;
    const pos = axis === "y" ? e.clientY : e.clientX;
    onChange(s.value + sign * (pos - s.pos));
  }, [axis, sign, onChange]);

  const end = useCallback(() => {
    if (!startRef.current) return;
    startRef.current = null;
    setActive(false);
    document.body.classList.remove("is-resizing-y", "is-resizing-x");
  }, []);

  const onKeyDown = useCallback((e) => {
    const back = axis === "y" ? "ArrowUp" : "ArrowLeft";
    const fwd = axis === "y" ? "ArrowDown" : "ArrowRight";
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const d = (e.key === fwd ? 1 : -1) * (e.shiftKey ? step * 4 : step);
    onChange(value + sign * d);
  }, [axis, sign, step, value, onChange]);

  return (
    <div
      className={`split split--${axis}${active ? " is-active" : ""}`}
      role="separator"
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="split__grip" />
    </div>
  );
}
