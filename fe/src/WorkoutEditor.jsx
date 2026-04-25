import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ComposerPickListPortal } from "./ComposerPickList.jsx";
import { PlanTemplateCarousel } from "./PlanTemplateCarousel.jsx";
import { BODY_PART_API_NAME, MUSCLE_GROUPS } from "./workoutData.js";
import {
  appendDraftExerciseToEnd,
  applyBarIndex,
  computeBarIndex,
  DRAFT_FLIP_EASING,
  DRAFT_FLIP_MS,
  lastDraftLineComposerPrefill,
  lastPlannedComposerPrefill,
  MAX_REPS_INPUT_LEN,
  MAX_WEIGHT_INPUT_LEN,
  moveDraftExerciseAbove,
  moveDraftExerciseAboveBar,
  newDraftLineId,
  normalizeExerciseStatus,
  rowStatusModifier,
  sanitizeOptionalDecimalInput,
} from "./workoutHelpers.js";

/**
 * Pointer-based drag activation thresholds. Native HTML5 DnD was replaced because:
 *  - Mobile Safari/Chrome require ~500 ms long-press to activate and often hijack the gesture
 *    as text selection, making reordering feel broken.
 *  - HTML5 DnD source is a single child handle; users expect to grab the whole row/bar.
 * Pointer Events give us uniform mouse/touch/pen handling and full control over when a drag
 * begins, so we can keep mobile scrolling intact while still making drag feel instant.
 */
const POINTER_LONG_PRESS_MS = 220;
const POINTER_TOUCH_CANCEL_PX = 8;
const POINTER_MOUSE_ACTIVATE_PX = 4;

/**
 * Workout composer / editor body. Progress-bar model:
 * - {@code draftLines} keeps invariant "DONE rows first, PLANNED rows after"; the bar sits at that boundary.
 * - {@code barIndex} is derived from the draft (count of leading DONE rows), not a separate state.
 * - Two drag interactions: drag the bar to redraw the boundary, or drag an exercise across the bar to flip its status.
 *
 * Always rendered inside a scrolling card ({@code .modal-body} class) — either the popup
 * (WorkoutModal) or the Today shell. Both share identical layout so the sticky composer and
 * list behave the same regardless of host.
 *
 * Parent can pass {@link onDraftPersist} to fire {@code POST /workout} or {@code PUT /workout/{id}}
 * on every structural change so the server snapshot stays in sync without a submit button.
 * {@link onEscape} is optional — modal hosts pass their close callback; inline hosts omit it.
 */
export function WorkoutEditor({
  loadExercisePicker,
  createUserExercise,
  draftLines,
  setDraftLines,
  exerciseMeta,
  setExerciseMeta,
  isSubmitting,
  submitError,
  onDraftPersist,
  onEscape,
  planCarouselTemplates,
  planCarouselError,
  showPlanCarousel,
  onApplyPlanCarousel,
}) {
  const [composerGroup, setComposerGroup] = useState(() => MUSCLE_GROUPS[0] || "");
  const [composerExercise, setComposerExercise] = useState("");
  const [composerExerciseId, setComposerExerciseId] = useState(null);
  const [pickerCatalog, setPickerCatalog] = useState([]);
  const [pickerCustom, setPickerCustom] = useState([]);
  const [pickerReady, setPickerReady] = useState(false);
  const [pickerLoadError, setPickerLoadError] = useState("");
  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [addCustomName, setAddCustomName] = useState("");
  const [addCustomError, setAddCustomError] = useState("");
  const [addCustomSubmitting, setAddCustomSubmitting] = useState(false);
  const [composerWeight, setComposerWeight] = useState("0");
  const [composerReps, setComposerReps] = useState("");
  /** Prototype: bottom sheet / popover pick list — "group" | "exercise" | null */
  const [composerPickOpen, setComposerPickOpen] = useState(null);
  /** Blue glow on the top composer row after + */
  const [composerRowFlash, setComposerRowFlash] = useState(false);
  const groupPickAnchorRef = useRef(null);
  const exercisePickAnchorRef = useRef(null);
  /**
   * Active DnD descriptor:
   *   {kind: "exercise", fromIndex}   — dragging an exercise row
   *   {kind: "bar"}                   — dragging the progress bar
   *   null                             — no drag in progress
   */
  const [dragState, setDragState] = useState(null);
  /**
   * Highlighted drop target while dragging. {@code kind} matches the hovered slot type:
   *   {kind: "row", index}     — row at exercise array index
   *   {kind: "bar"}            — the progress bar row
   *   {kind: "end"}            — tail drop zone below the last row
   */
  const [dropTarget, setDropTarget] = useState(null);
  const draftFlipContainerRef = useRef(null);
  const prevDraftLayoutRef = useRef(new Map());
  const prevDraftLinesForFlipRef = useRef(null);
  /** Scroll container: the modal-body in popup mode, the editor section in inline mode. */
  const editorContainerRef = useRef(null);
  /** One-shot: after mount, seed composer from the list tail (incl. all-DONE sessions). */
  const openComposerPrefillDoneRef = useRef(false);
  /** Skip the next draft-driven sync so + does not overwrite in-flight composer edits. */
  const skipNextComposerPrefillSyncRef = useRef(false);

  const barIndex = useMemo(() => computeBarIndex(draftLines), [draftLines]);

  useEffect(() => {
    let cancelled = false;
    const apiPart = BODY_PART_API_NAME[composerGroup] || String(composerGroup).toLowerCase();
    setPickerReady(false);
    setPickerLoadError("");
    loadExercisePicker(apiPart)
      .then((data) => {
        if (cancelled) return;
        setPickerCatalog(Array.isArray(data?.catalog) ? data.catalog : []);
        setPickerCustom(Array.isArray(data?.custom) ? data.custom : []);
        setPickerReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setPickerCatalog([]);
        setPickerCustom([]);
        setPickerLoadError(e instanceof Error ? e.message : "picker error");
        setPickerReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [composerGroup, loadExercisePicker]);

  const composerPickItems = useMemo(() => {
    const addNew = { key: "__add_custom__", label: "Dodaj własne…" };
    if (!pickerReady) {
      return [
        { key: "__loading__", label: "Ładowanie…", disabled: true },
        addNew,
      ];
    }
    const c = (pickerCatalog || []).map((e) => ({
      key: `c-${e.id}`,
      label: e.name,
      exerciseId: e.id,
    }));
    const u = (pickerCustom || []).map((e) => ({
      key: `u-${e.id}`,
      label: e.name,
      exerciseId: e.id,
    }));
    if (c.length === 0 && u.length === 0) {
      return [addNew];
    }
    return [...c, ...u, addNew];
  }, [pickerReady, pickerCatalog, pickerCustom]);

  const composerPrefillKey = useMemo(() => {
    const ids = draftLines.map((l) => l.id).join("|");
    const p = lastPlannedComposerPrefill(draftLines, exerciseMeta);
    return `${ids}|${p.plannedRowId}|${p.group ?? ""}|${p.name ?? ""}|${p.exerciseId ?? ""}|${p.weight}|${p.reps}`;
  }, [draftLines, exerciseMeta]);

  useLayoutEffect(() => {
    // One-shot seed from the list tail. Guard fires on the FIRST non-empty observation of
    // draftLines so async prefills (Today view fetches after mount) still seed the composer.
    // An empty initial draft just applies defaults without consuming the one-shot.
    if (!openComposerPrefillDoneRef.current) {
      if (draftLines.length === 0) {
        setComposerWeight("0");
        setComposerReps("");
        setComposerGroup(MUSCLE_GROUPS[0] || "");
        setComposerExercise("");
        setComposerExerciseId(null);
        return;
      }
      openComposerPrefillDoneRef.current = true;
      const tail = lastDraftLineComposerPrefill(draftLines, exerciseMeta);
      setComposerWeight(tail.weight);
      setComposerReps(tail.reps);
      setComposerGroup(tail.group || MUSCLE_GROUPS[0] || "");
      setComposerExercise(tail.name || "");
      setComposerExerciseId(tail.exerciseId != null ? tail.exerciseId : null);
      return;
    }

    if (skipNextComposerPrefillSyncRef.current) {
      skipNextComposerPrefillSyncRef.current = false;
      return;
    }

    const p = lastPlannedComposerPrefill(draftLines, exerciseMeta);
    if (p.plannedRowId) {
      setComposerWeight(p.weight);
      setComposerReps(p.reps);
      setComposerGroup(p.group);
      setComposerExercise(p.name);
      setComposerExerciseId(p.exerciseId != null ? p.exerciseId : null);
      return;
    }
    if (draftLines.length === 0) {
      setComposerWeight(p.weight);
      setComposerReps(p.reps);
      setComposerGroup(MUSCLE_GROUPS[0] || "");
      setComposerExercise("");
      setComposerExerciseId(null);
      return;
    }
    // All rows are DONE (bar at the bottom): keep sticky composer as-is so the user doesn't lose last picks.
  }, [composerPrefillKey, draftLines, exerciseMeta]);

  useEffect(() => {
    // Escape handling. Internal pickers take precedence; only when nothing is open do we
    // delegate to the host via {@code onEscape} (modal uses this to close itself).
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (addCustomOpen) {
        e.preventDefault();
        if (!addCustomSubmitting) setAddCustomOpen(false);
        return;
      }
      if (composerPickOpen) {
        e.preventDefault();
        setComposerPickOpen(null);
        return;
      }
      if (typeof onEscape === "function") onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onEscape, composerPickOpen, addCustomOpen, addCustomSubmitting]);

  useEffect(() => {
    // FLIP animations need to re-measure on scroll. Host always provides a scrollable container
    // via {@code .modal-body}, so listen on that element.
    const el = editorContainerRef.current;
    if (!el) return undefined;
    const resetLayout = () => {
      prevDraftLayoutRef.current = new Map();
    };
    el.addEventListener("scroll", resetLayout, { passive: true });
    return () => el.removeEventListener("scroll", resetLayout);
  }, []);

  useLayoutEffect(() => {
    const container = draftFlipContainerRef.current;
    if (!container || draftLines.length === 0) {
      prevDraftLayoutRef.current = new Map();
      prevDraftLinesForFlipRef.current = draftLines;
      return;
    }

    prevDraftLinesForFlipRef.current = draftLines;

    // Progress bar carries `data-draft-row-id="__bar__"`, so it participates in the same FLIP pass
    // as exercise rows. Status-only transitions (drag-bar moves) still shift the bar across rows and
    // therefore must be animated; rows that don't physically move are filtered by the < 0.5 px check.
    const rowEls = container.querySelectorAll("[data-draft-row-id]");
    const nextRects = new Map();
    for (const el of rowEls) {
      const id = el.getAttribute("data-draft-row-id");
      if (id) nextRects.set(id, el.getBoundingClientRect());
    }

    const prev = prevDraftLayoutRef.current;
    const canFlip =
      prev.size > 0 &&
      prev.size === nextRects.size &&
      [...nextRects.keys()].every((id) => prev.has(id));

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (canFlip && !reduceMotion) {
      for (const el of rowEls) {
        const id = el.getAttribute("data-draft-row-id");
        const oldR = id ? prev.get(id) : null;
        const newR = id ? nextRects.get(id) : null;
        if (!oldR || !newR) continue;
        const dx = oldR.left - newR.left;
        const dy = oldR.top - newR.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.getBoundingClientRect();
        requestAnimationFrame(() => {
          const clearFlipStyles = () => {
            el.style.transition = "";
            el.style.transform = "";
          };
          el.style.transition = `transform ${DRAFT_FLIP_MS}ms ${DRAFT_FLIP_EASING}`;
          el.style.transform = "";
          const onEnd = (ev) => {
            if (ev.propertyName !== "transform") return;
            el.removeEventListener("transitionend", onEnd);
            clearFlipStyles();
          };
          el.addEventListener("transitionend", onEnd);
          window.setTimeout(() => {
            el.removeEventListener("transitionend", onEnd);
            clearFlipStyles();
          }, DRAFT_FLIP_MS + 80);
        });
      }
    }
    prevDraftLayoutRef.current = nextRects;
  }, [draftLines]);

  async function submitAddCustom() {
    const trimmed = addCustomName.trim();
    if (!trimmed) {
      setAddCustomError("Wpisz nazwę ćwiczenia.");
      return;
    }
    setAddCustomSubmitting(true);
    setAddCustomError("");
    try {
      const apiPart = BODY_PART_API_NAME[composerGroup] || String(composerGroup).toLowerCase();
      const created = await createUserExercise(apiPart, trimmed);
      setPickerCustom((prev) =>
        [...prev.filter((x) => x.id !== created.id), created].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        )
      );
      setComposerExercise(created.name);
      setComposerExerciseId(created.id);
      setAddCustomOpen(false);
      setAddCustomName("");
    } catch (e) {
      setAddCustomError(e instanceof Error ? e.message : "Nie udało się zapisać.");
    } finally {
      setAddCustomSubmitting(false);
    }
  }

  /**
   * Tap / click on a draft row: copy its values into the sticky composer so the user can
   * re-add the same exercise with one "+". Triggered only when the pointer gesture did NOT
   * activate a drag — regular drag-and-drop keeps working untouched.
   */
  function prefillComposerFromRow(index) {
    const line = draftLinesRef.current[index];
    if (!line) return;
    const meta = exerciseMeta[line.id] || { weight: "0", reps: "" };
    setComposerGroup(line.group || MUSCLE_GROUPS[0] || "");
    setComposerExercise(line.name || "");
    setComposerExerciseId(line.exerciseId != null ? line.exerciseId : null);
    setComposerWeight(meta.weight || "0");
    setComposerReps(meta.reps || "");
    // Block the next draft-driven sync — otherwise the "lastPlanned" effect would overwrite
    // our picks on the following render if something downstream touches draftLines.
    skipNextComposerPrefillSyncRef.current = true;

    // Re-use the existing + button flash so the user gets the same visual confirmation.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!reduceMotion) {
      setComposerRowFlash(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setComposerRowFlash(true));
      });
    }
  }

  function addExerciseFromComposer() {
    if (!composerGroup || !composerExercise) return;
    const id = newDraftLineId();
    const newLine = {
      id,
      group: composerGroup,
      name: composerExercise,
      exerciseId: composerExerciseId != null ? composerExerciseId : undefined,
      status: "PLANNED",
    };
    // New rows always land below the bar (planned). Appending a PLANNED row keeps the "DONEs first" invariant.
    const nextLines = [...draftLines, newLine];
    const nextMeta = {
      ...exerciseMeta,
      [id]: { weight: composerWeight || "0", reps: composerReps || "" },
    };
    setDraftLines(nextLines);
    setExerciseMeta(nextMeta);
    skipNextComposerPrefillSyncRef.current = true;

    // Autosave: without the footer "Add" button this is the only point where an exercise joins the workout.
    // Pass the freshly computed meta so the parent's request builder doesn't see stale state from closure.
    notifyPersist(nextLines, nextMeta);

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!reduceMotion) {
      setComposerRowFlash(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setComposerRowFlash(true));
      });
    }

    // Reveal the new tail row in the editor's own scroll container.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const body = editorContainerRef.current;
        if (!body) return;
        body.scrollTo({
          top: body.scrollHeight,
          behavior: reduceMotion ? "auto" : "smooth",
        });
      });
    });
  }

  function removeDraftLine(lineId) {
    // Filtering a row re-derives the bar position: removing a DONE row shrinks barIndex, removing PLANNED leaves it.
    const nextLines = draftLines.filter((l) => l.id !== lineId);
    const nextMeta = { ...exerciseMeta };
    delete nextMeta[lineId];
    setDraftLines(nextLines);
    setExerciseMeta(nextMeta);

    // Autosave on remove — mirrors the add/drop flow so the server snapshot stays in sync without a submit button.
    notifyPersist(nextLines, nextMeta);
  }

  function clearEntireDraft() {
    setDraftLines([]);
    setExerciseMeta({});
    setDropTarget(null);
    setDragState(null);
  }

  /**
   * Fires parent's persistence hook with the freshly computed draft (no-op if not provided).
   * The optional {@code nextMeta} lets callers that mutate exerciseMeta (add/remove) hand the
   * post-update map in directly, so the parent's request builder doesn't read stale closure state.
   */
  function notifyPersist(nextLines, nextMeta) {
    if (typeof onDraftPersist !== "function") return;
    if (!Array.isArray(nextLines)) return;
    try {
      onDraftPersist(nextLines, nextMeta);
    } catch {
      /* Parent logs / surfaces errors — don't crash on a transient persist failure. */
    }
  }

  /** Drop-above rule: an exercise dragged onto the row at {@code targetIndex} lands directly above it. */
  function handleExerciseDropAbove(fromIndex, targetIndex) {
    if (isSubmitting) return;
    setDraftLines((prev) => {
      const { lines: next, changed } = moveDraftExerciseAbove(prev, fromIndex, targetIndex);
      if (!changed) return prev;
      notifyPersist(next);
      return next;
    });
  }

  /** Dropping an exercise onto the progress bar → item lands right ABOVE the bar (last DONE). */
  function handleExerciseDropOnBar(fromIndex) {
    if (isSubmitting) return;
    setDraftLines((prev) => {
      const { lines: next, changed } = moveDraftExerciseAboveBar(prev, fromIndex);
      if (!changed) return prev;
      notifyPersist(next);
      return next;
    });
  }

  /** Tail drop zone: no target row → append the exercise at the very end (keeps DONE-first invariant). */
  function handleExerciseAppend(fromIndex) {
    if (isSubmitting) return;
    setDraftLines((prev) => {
      const { lines: next, changed } = appendDraftExerciseToEnd(prev, fromIndex);
      if (!changed) return prev;
      notifyPersist(next);
      return next;
    });
  }

  /** Move the progress bar so that the first {@code nextBarIndex} exercises become DONE, the rest PLANNED. */
  function handleBarDropAt(nextBarIndex) {
    if (isSubmitting) return;
    setDraftLines((prev) => {
      const next = applyBarIndex(prev, nextBarIndex);
      if (next === prev) return prev;
      notifyPersist(next);
      return next;
    });
  }

  // --- Pointer-based DnD ---------------------------------------------------
  // Refs mirror fresh values for pointer listeners attached on window (their closure would
  // otherwise capture stale handlers/state from the render where the drag started).
  const dropTargetRef = useRef(null);
  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);
  const draftLinesRef = useRef(draftLines);
  useEffect(() => {
    draftLinesRef.current = draftLines;
  }, [draftLines]);
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);
  const dropHandlersRef = useRef({});
  dropHandlersRef.current = {
    handleExerciseDropAbove,
    handleBarDropAt,
    handleExerciseDropOnBar,
    handleExerciseAppend,
    // Tap-to-prefill handler shares the same ref so pointerup always sees the latest closure.
    prefillComposerFromRow,
  };
  /** Active pointer-drag session (or null). See {@link startPointerDrag} for the shape. */
  const pointerDragRef = useRef(null);

  /** Walk up from the hit element to the nearest [data-drop-kind] zone (row / bar / end). */
  function hitTestDropZone(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && !(el instanceof HTMLElement && el.dataset && el.dataset.dropKind)) {
      el = el.parentElement;
    }
    if (el instanceof HTMLElement) return el;

    // "Dragged past the bottom" fallback — if the pointer is still horizontally over the
    // draft list but below the last drop zone, snap to the end zone. Matches the expectation
    // that releasing below the lowest row appends the item at the very end.
    const container = draftFlipContainerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (x < rect.left || x > rect.right) return null;
    const endZone = container.querySelector('[data-drop-kind="end"]');
    if (!(endZone instanceof HTMLElement)) return null;
    const endRect = endZone.getBoundingClientRect();
    if (y > endRect.top) return endZone;
    return null;
  }

  function activatePointerDrag() {
    const d = pointerDragRef.current;
    if (!d || d.active) return;
    d.active = true;
    if (d.touchHoldTimer) {
      window.clearTimeout(d.touchHoldTimer);
      d.touchHoldTimer = null;
    }
    // Globally disable touch-action so subsequent touchmoves can be preventDefault-ed.
    document.body.classList.add("is-pointer-dragging");
    if (d.kind === "bar") {
      setDragState({ kind: "bar" });
    } else {
      setDragState({ kind: "exercise", fromIndex: d.fromIndex });
    }
    // Haptic cue on mobile so the user feels the drag "lock in".
    if (d.isTouch && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(8);
      } catch {
        /* ignore vendor quirks */
      }
    }
  }

  function teardownPointerDrag() {
    const d = pointerDragRef.current;
    if (d) {
      if (d.touchHoldTimer) window.clearTimeout(d.touchHoldTimer);
      if (d.moveHandler) window.removeEventListener("pointermove", d.moveHandler);
      if (d.upHandler) {
        window.removeEventListener("pointerup", d.upHandler);
        window.removeEventListener("pointercancel", d.upHandler);
      }
    }
    pointerDragRef.current = null;
    document.body.classList.remove("is-pointer-dragging");
    setDragState(null);
    setDropTarget(null);
  }

  function onPointerDragMove(e) {
    const d = pointerDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const dist = Math.hypot(dx, dy);

    // Activation phase: mouse = small move, touch = long-press (timer). Touch scroll cancels.
    if (!d.active) {
      if (d.isTouch) {
        if (dist > POINTER_TOUCH_CANCEL_PX) {
          // The user is scrolling, not reordering — release so the browser can pan.
          teardownPointerDrag();
        }
        return;
      }
      if (dist < POINTER_MOUSE_ACTIVATE_PX) return;
      activatePointerDrag();
    }

    // Active drag: suppress native scroll/select and hit-test the pointer against drop zones.
    e.preventDefault();
    const zone = hitTestDropZone(e.clientX, e.clientY);
    if (!zone) {
      setDropTarget(null);
      return;
    }
    const kind = zone.dataset.dropKind;
    if (kind === "row") {
      const idx = Number.parseInt(zone.dataset.dropIndex, 10);
      if (Number.isFinite(idx)) setDropTarget({ kind: "row", index: idx });
    } else if (kind === "bar") {
      setDropTarget({ kind: "bar" });
    } else if (kind === "end") {
      setDropTarget({ kind: "end" });
    }
  }

  function onPointerDragUp(e) {
    const d = pointerDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const h = dropHandlersRef.current;
    if (d.active) {
      // Resolve the drop against whatever zone the pointer was last over.
      const target = dropTargetRef.current;
      const total = draftLinesRef.current.length;
      if (target) {
        if (d.kind === "exercise") {
          // Drop-on-self (drag activated but never moved off the source row) reads as a tap →
          // prefill instead of a no-op "drop above itself".
          if (target.kind === "row" && target.index === d.fromIndex) {
            h.prefillComposerFromRow(d.fromIndex);
          } else if (target.kind === "row") {
            h.handleExerciseDropAbove(d.fromIndex, target.index);
          } else if (target.kind === "bar") {
            h.handleExerciseDropOnBar(d.fromIndex);
          } else if (target.kind === "end") {
            h.handleExerciseAppend(d.fromIndex);
          }
        } else if (d.kind === "bar") {
          if (target.kind === "row") h.handleBarDropAt(target.index);
          else if (target.kind === "end") h.handleBarDropAt(total);
        }
      } else if (d.kind === "exercise") {
        // Drag activated but released outside any drop zone → fall back to tap semantics.
        h.prefillComposerFromRow(d.fromIndex);
      }
    } else if (d.kind === "exercise") {
      // No drag was activated → treat the gesture as a tap/click and prefill the composer
      // with the tapped row's values. Quick mobile taps (below long-press) fall here too.
      h.prefillComposerFromRow(d.fromIndex);
    }
    teardownPointerDrag();
  }

  /** Begin a pointer-drag session. {@code kind} is 'exercise' (needs fromIndex) or 'bar'. */
  function startPointerDrag(e, kind, fromIndex) {
    if (isSubmittingRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Never swallow interactions inside inputs/buttons — users still need to type weights/reps
    // and hit the × remove button inside the same row that accepts the drag gesture.
    if (
      e.target instanceof HTMLElement &&
      e.target.closest('input, button, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    const isTouch = e.pointerType === "touch";
    const move = (ev) => onPointerDragMove(ev);
    const up = (ev) => onPointerDragUp(ev);
    const state = {
      pointerId: e.pointerId,
      kind,
      fromIndex: kind === "exercise" ? fromIndex : -1,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      isTouch,
      touchHoldTimer: null,
      moveHandler: move,
      upHandler: up,
    };
    pointerDragRef.current = state;
    if (isTouch) {
      // Long-press before activation: lets the user scroll the list with a normal swipe.
      state.touchHoldTimer = window.setTimeout(() => {
        activatePointerDrag();
      }, POINTER_LONG_PRESS_MS);
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Ensure listeners / body class don't leak if the editor unmounts mid-drag.
  useEffect(() => {
    return () => {
      teardownPointerDrag();
    };
  }, []);

  function setExerciseField(lineId, field, raw) {
    // Mirror composer behavior: same decimal sanitizer + per-field length cap.
    const maxLen = field === "weight" ? MAX_WEIGHT_INPUT_LEN : MAX_REPS_INPUT_LEN;
    const value = sanitizeOptionalDecimalInput(raw, maxLen);
    setExerciseMeta((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || { weight: "0", reps: "" }), [field]: value },
    }));
  }

  function rowDropTargetClass(index) {
    if (dropTarget?.kind === "row" && dropTarget.index === index) return " exerciseRow--dragOver";
    return "";
  }

  function barDropTargetClass() {
    if (dropTarget?.kind === "bar") return " workoutProgressBar--dragOver";
    return "";
  }

  function endZoneDropTargetClass() {
    if (dropTarget?.kind === "end") return " workoutEndDrop--dragOver";
    return "";
  }

  return (
    <>
      <ComposerPickListPortal
        open={composerPickOpen === "group"}
        title="Muscle group"
        items={MUSCLE_GROUPS}
        anchorRef={groupPickAnchorRef}
        onClose={() => setComposerPickOpen(null)}
        onPick={(g) => {
          setComposerGroup(g);
          setComposerExercise("");
          setComposerExerciseId(null);
        }}
      />
      <ComposerPickListPortal
        open={composerPickOpen === "exercise"}
        title="Exercise"
        items={composerPickItems}
        anchorRef={exercisePickAnchorRef}
        onClose={() => setComposerPickOpen(null)}
        onPick={(item) => {
          if (typeof item === "string") {
            setComposerExercise(item);
            setComposerExerciseId(null);
            return;
          }
          if (item.key === "__add_custom__") {
            setAddCustomOpen(true);
            setAddCustomName("");
            setAddCustomError("");
            return;
          }
          setComposerExercise(item.label);
          setComposerExerciseId(item.exerciseId != null ? item.exerciseId : null);
        }}
      />
      {addCustomOpen
        ? createPortal(
            // Centered dialog (not a bottom sheet) — keeps the text input visible above the mobile
            // soft keyboard, which would otherwise cover a bottom-anchored panel.
            <div className="pickList-root pickList-root--centered" role="presentation">
              <button
                type="button"
                className="pickList-backdrop"
                aria-label="Zamknij"
                disabled={addCustomSubmitting}
                onClick={() => !addCustomSubmitting && setAddCustomOpen(false)}
              />
              <div
                className="pickList-panel pickList-panel--dialog"
                role="dialog"
                aria-label="Własne ćwiczenie"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="pickList-header">Dodaj własne ćwiczenie</div>
                <div className="pickList-list" style={{ padding: "12px 16px 16px" }}>
                  {addCustomError ? <div className="errorText">{addCustomError}</div> : null}
                  <input
                    type="text"
                    className="auth-input"
                    style={{ width: "100%", marginBottom: 12, boxSizing: "border-box" }}
                    placeholder="Np. wyciskanie na skosie"
                    value={addCustomName}
                    disabled={addCustomSubmitting}
                    onChange={(e) => setAddCustomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitAddCustom();
                      }
                    }}
                    autoFocus
                  />
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={addCustomSubmitting}
                      onClick={() => setAddCustomOpen(false)}
                    >
                      Anuluj
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={addCustomSubmitting}
                      onClick={() => submitAddCustom()}
                    >
                      {addCustomSubmitting ? "Zapis…" : "Zapisz"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      <div className="modal-body" ref={editorContainerRef}>
        {pickerLoadError ? (
          <div className="errorText">Lista ćwiczeń: {pickerLoadError} — możesz dodać własne („Dodaj własne…”).</div>
        ) : null}
        {submitError ? <div className="errorText">{submitError}</div> : null}
        <section className="groupSection" aria-label="Current workout">
          <div className="groupHeaderRow">
            <div className="groupHeader">Your workout</div>
            {draftLines.length > 0 ? (
              <button
                type="button"
                className="btn btn-compact btn-danger-text"
                disabled={isSubmitting}
                onClick={clearEntireDraft}
                aria-label="Wyczyść cały prefill z listy"
              >
                Wyczyść prefill
              </button>
            ) : null}
          </div>

          <PlanTemplateCarousel
            templates={planCarouselTemplates}
            loadError={planCarouselError}
            visible={showPlanCarousel}
            onApplyPlan={onApplyPlanCarousel}
          />

          <div className="workoutComposerBlock">
            <form
              className={`exerciseRow exerciseRow--composer${
                composerRowFlash ? " exerciseRow--composerFlash" : ""
              }`}
              aria-label="Add new exercise"
              onSubmit={(e) => {
                e.preventDefault();
                if (isSubmitting || !composerExercise) return;
                addExerciseFromComposer();
              }}
              onAnimationEnd={(e) => {
                if (e.target !== e.currentTarget) return;
                if (!e.animationName.includes("composerRowBlueFlash")) return;
                setComposerRowFlash(false);
              }}
            >
              <div className="dragHandleSpacer" aria-hidden="true" />
              <div className="exerciseNameCell exerciseNameCell--composer">
                <button
                  ref={groupPickAnchorRef}
                  type="button"
                  className="composerPickTrigger composerPickTrigger--group"
                  aria-label="Muscle group"
                  aria-haspopup="listbox"
                  aria-expanded={composerPickOpen === "group"}
                  disabled={isSubmitting}
                  onClick={() =>
                    setComposerPickOpen((p) => (p === "group" ? null : "group"))
                  }
                >
                  <span className="composerPickTrigger__text">{composerGroup}</span>
                </button>
                <button
                  ref={exercisePickAnchorRef}
                  type="button"
                  className="composerPickTrigger composerPickTrigger--exercise"
                  aria-label="Exercise"
                  aria-haspopup="listbox"
                  aria-expanded={composerPickOpen === "exercise"}
                  disabled={isSubmitting || composerPickItems.length === 0}
                  onClick={() =>
                    setComposerPickOpen((p) => (p === "exercise" ? null : "exercise"))
                  }
                >
                  <span className="composerPickTrigger__text composerPickTrigger__text--ellipsis">
                    {composerPickItems.length === 0
                      ? "No exercises"
                      : composerExercise || "Exercise"}
                  </span>
                </button>
              </div>
              <div className="exerciseFields">
                <input
                  className="numField"
                  inputMode="decimal"
                  maxLength={MAX_WEIGHT_INPUT_LEN}
                  placeholder="Weight"
                  value={composerWeight}
                  disabled={isSubmitting}
                  onChange={(e) =>
                    setComposerWeight(
                      sanitizeOptionalDecimalInput(e.target.value, MAX_WEIGHT_INPUT_LEN)
                    )
                  }
                  onFocus={(e) => e.target.select()}
                />
                <input
                  className="numField"
                  inputMode="decimal"
                  maxLength={MAX_REPS_INPUT_LEN}
                  placeholder="Reps"
                  value={composerReps}
                  disabled={isSubmitting}
                  onChange={(e) =>
                    setComposerReps(
                      sanitizeOptionalDecimalInput(e.target.value, MAX_REPS_INPUT_LEN)
                    )
                  }
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <button
                type="submit"
                className="rowAdd"
                disabled={isSubmitting || !composerExercise}
                aria-label="Add exercise to list"
              >
                +
              </button>
            </form>
          </div>

          {draftLines.length > 0 ? (
            <div className="checks checks--draftFlip" ref={draftFlipContainerRef}>
              {draftLines.map((line, index) => {
                const row = renderExerciseRow({
                  line,
                  index,
                  dragState,
                  exerciseMeta,
                  rowDropTargetClass,
                  setExerciseField,
                  removeDraftLine,
                  startPointerDrag,
                });
                // Progress bar sits between rows at the boundary index — rendered before the first PLANNED row.
                if (index === barIndex) {
                  return (
                    <React.Fragment key={`bar-slot-${index}`}>
                      {renderProgressBar({
                        atIndex: barIndex,
                        totalRows: draftLines.length,
                        barDropTargetClass,
                        dragState,
                        startPointerDrag,
                      })}
                      {row}
                    </React.Fragment>
                  );
                }
                return <React.Fragment key={line.id}>{row}</React.Fragment>;
              })}
              {/* End-of-list drop zone: renders bar at the bottom when barIndex === length, and accepts drops for append / bar-to-bottom. */}
              {barIndex === draftLines.length
                ? renderProgressBar({
                    atIndex: draftLines.length,
                    totalRows: draftLines.length,
                    barDropTargetClass,
                    dragState,
                    startPointerDrag,
                  })
                : null}
              {renderEndDropZone({
                totalRows: draftLines.length,
                endZoneDropTargetClass,
              })}
            </div>
          ) : (
            <div className="note workoutPlanEmpty">Nothing here yet.</div>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Exercise row renderer — extracted to keep the editor return JSX flat and readable.
 * Drag gesture is bound to the whole row via pointer events (see {@code startPointerDrag}),
 * so the grip is purely decorative.
 */
function renderExerciseRow({
  line,
  index,
  dragState,
  exerciseMeta,
  rowDropTargetClass,
  setExerciseField,
  removeDraftLine,
  startPointerDrag,
}) {
  // Only two row states now: DONE (above bar, green) and PLANNED (below bar, blue).
  // The former "next up" highlight was dropped — all planned rows share one color.
  const rowStatus = normalizeExerciseStatus(line);
  const isDragging = dragState?.kind === "exercise" && dragState.fromIndex === index;

  return (
    <div
      data-draft-row-id={line.id}
      data-drop-kind="row"
      data-drop-index={index}
      className={`exerciseRow exerciseRow--${rowStatusModifier({ status: rowStatus })}${rowDropTargetClass(index)}${isDragging ? " exerciseRow--dragging" : ""}`}
      onPointerDown={(e) => startPointerDrag(e, "exercise", index)}
    >
      <div
        className="dragHandle"
        aria-hidden="true"
        title="Przeciągnij wiersz, aby zmienić kolejność"
      >
        <span className="dragHandleGrip" aria-hidden="true" />
      </div>
      <div className="exerciseNameCell">
        <span className="muscleTag" title="Partia">
          {line.group}
        </span>
        <span className="check-text">{line.name}</span>
      </div>
      <div className="exerciseFields">
        <input
          className="numField"
          inputMode="decimal"
          maxLength={MAX_WEIGHT_INPUT_LEN}
          placeholder="Weight"
          value={exerciseMeta[line.id]?.weight || ""}
          onChange={(e) => setExerciseField(line.id, "weight", e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <input
          className="numField"
          inputMode="decimal"
          maxLength={MAX_REPS_INPUT_LEN}
          placeholder="Reps"
          value={exerciseMeta[line.id]?.reps || ""}
          onChange={(e) => setExerciseField(line.id, "reps", e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <button
        type="button"
        className="rowRemove"
        aria-label={`Remove ${line.name}`}
        onClick={(e) => {
          e.stopPropagation();
          removeDraftLine(line.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Progress bar row — draggable boundary between DONE (above) and PLANNED (below).
 * Like exercise rows, the whole bar surface is the drag source via pointer events.
 */
function renderProgressBar({
  atIndex,
  totalRows,
  barDropTargetClass,
  dragState,
  startPointerDrag,
}) {
  const isDraggingBar = dragState?.kind === "bar";
  const doneCount = atIndex;
  const plannedCount = Math.max(0, totalRows - atIndex);

  return (
    <div
      // Stable id lets the FLIP layout-effect track the bar alongside exercise rows — without it the
      // bar would teleport between positions instead of animating like a reordered row.
      data-draft-row-id="__bar__"
      data-drop-kind="bar"
      className={`workoutProgressBar${isDraggingBar ? " workoutProgressBar--dragging" : ""}${barDropTargetClass()}`}
      role="separator"
      aria-label={`Postęp: ${doneCount} zrobione, ${plannedCount} do zrobienia. Przeciągnij, aby zmienić.`}
      title="Przeciągnij pasek, aby wyznaczyć, do którego ćwiczenia dotarłeś"
      onPointerDown={(e) => startPointerDrag(e, "bar")}
    >
      <div className="workoutProgressBar__handle" aria-hidden="true">
        <span className="workoutProgressBar__grip" aria-hidden="true" />
      </div>
      <div className="workoutProgressBar__label">
        <span className="workoutProgressBar__labelText">Progress</span>
        <span className="workoutProgressBar__counter">
          {doneCount}/{totalRows}
        </span>
      </div>
    </div>
  );
}

/** Invisible tail drop zone. Highlighted via {@code data-drop-kind="end"} during pointer drag. */
function renderEndDropZone({ totalRows, endZoneDropTargetClass }) {
  if (totalRows === 0) return null;
  return (
    <div
      className={`workoutEndDrop${endZoneDropTargetClass()}`}
      data-drop-kind="end"
      aria-hidden="true"
    />
  );
}
