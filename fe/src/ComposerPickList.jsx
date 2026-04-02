import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function useMatchMedia(query) {
  const get = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Prototype: list picker as bottom sheet (narrow viewport) or anchored popover (wide).
 * Rendered via portal above the workout modal.
 */
export function ComposerPickListPortal({
  open,
  title,
  items,
  onPick,
  onClose,
  anchorRef,
}) {
  const sheet = useMatchMedia("(max-width: 640px)");
  const [popoverStyle, setPopoverStyle] = useState({});
  const listRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || sheet) {
      setPopoverStyle({});
      return;
    }
    const el = anchorRef?.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const maxH = Math.min(320, window.innerHeight - r.bottom - gap - 16);
    const w = Math.max(r.width, 220);
    let left = r.left;
    if (left + w > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - w - 12);
    }
    setPopoverStyle({
      position: "fixed",
      top: r.bottom + gap,
      left,
      width: w,
      maxHeight: maxH,
    });
  }, [open, sheet, anchorRef, items]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => listRef.current?.querySelector("button")?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const root = (
    <div className="pickList-root" role="presentation">
      <button
        type="button"
        className="pickList-backdrop"
        aria-label="Close list"
        onClick={onClose}
      />
      <div
        className={`pickList-panel ${sheet ? "pickList-panel--sheet" : "pickList-panel--popover"}`}
        style={sheet ? undefined : popoverStyle}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {sheet ? <div className="pickList-sheetGrip" aria-hidden="true" /> : null}
        <div className="pickList-header">{title}</div>
        <ul ref={listRef} className="pickList-list" role="listbox">
          {items.map((item) => (
            <li key={item} role="none">
              <button
                type="button"
                className="pickList-item"
                role="option"
                onClick={() => {
                  onPick(item);
                  onClose();
                }}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return createPortal(root, document.body);
}
