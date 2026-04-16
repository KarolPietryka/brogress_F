import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ComposerPickListPortal } from "./ComposerPickList.jsx";
import { BODY_PART_API_NAME, MUSCLE_GROUPS } from "./workoutData.js";
import {
  appendDraftExerciseToEnd,
  applyBarIndex,
  BAR_DND_TYPE,
  computeBarIndex,
  DRAFT_DND_TYPE,
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
 * Workout composer / editor. Progress-bar model:
 * - {@code draftLines} keeps invariant "DONE rows first, PLANNED rows after"; the bar sits at that boundary.
 * - {@code barIndex} is derived from the draft (count of leading DONE rows), not a separate state.
 * - Two drag interactions: drag the bar to redraw the boundary, or drag an exercise across the bar to flip its status.
 *
 * Parent can pass {@link onDraftPersist} to fire {@code PUT /workout/{id}} on every drop while editing an existing session.
 */
export function WorkoutModal({
  loadExercisePicker,
  createUserExercise,
  draftLines,
  setDraftLines,
  exerciseMeta,
  setExerciseMeta,
  isSubmitting,
  submitError,
  onClose,
  onDraftPersist,
  modalKicker = "Add workout",
  modalKickerDetail = "",
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
  const modalBodyRef = useRef(null);
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
    // Opening the modal: always mirror the last list row (DONE or PLANNED) once per mount.
    if (!openComposerPrefillDoneRef.current) {
      openComposerPrefillDoneRef.current = true;
      if (draftLines.length === 0) {
        setComposerWeight("0");
        setComposerReps("");
        setComposerGroup(MUSCLE_GROUPS[0] || "");
        setComposerExercise("");
        setComposerExerciseId(null);
        return;
      }
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
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose, composerPickOpen, addCustomOpen, addCustomSubmitting]);

  useEffect(() => {
    const el = modalBodyRef.current;
    if (!el) return;
    const onScroll = () => {
      prevDraftLayoutRef.current = new Map();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
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

    // Reveal the new tail row on small viewports (composer stays sticky above the list scroll area).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const body = modalBodyRef.current;
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
      /* Parent logs / surfaces errors — don't crash the modal on a transient persist failure. */
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

  function setExerciseField(lineId, field, raw) {
    const value = digits4(raw);
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

  /** Reads the DnD kind from the current drag (exercise / bar) — null if neither type is present. */
  function readDragKind(e) {
    const types = e.dataTransfer?.types;
    if (!types) return null;
    if (Array.prototype.includes.call(types, BAR_DND_TYPE)) return "bar";
    if (Array.prototype.includes.call(types, DRAFT_DND_TYPE)) return "exercise";
    return null;
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
            <div className="pickList-root" role="presentation">
              <button
                type="button"
                className="pickList-backdrop"
                aria-label="Zamknij"
                disabled={addCustomSubmitting}
                onClick={() => !addCustomSubmitting && setAddCustomOpen(false)}
              />
              <div
                className="pickList-panel pickList-panel--sheet"
                role="dialog"
                aria-label="Własne ćwiczenie"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="pickList-sheetGrip" aria-hidden="true" />
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
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div className="modal-card">
          <div className="modal-head">
            <div>
              <div className="modal-kicker" id="modalTitle">
                {modalKicker}
              </div>
              {modalKickerDetail ? (
                <p className="modal-head-detail">{modalKickerDetail}</p>
              ) : null}
            </div>
            <button
              className="icon-btn"
              type="button"
              aria-label="Close"
              onClick={onClose}
            >
              X
            </button>
          </div>

          <div className="modal-body" ref={modalBodyRef}>
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
                      isSubmitting,
                      dragState,
                      dropTarget,
                      exerciseMeta,
                      rowDropTargetClass,
                      readDragKind,
                      setDragState,
                      setDropTarget,
                      setExerciseField,
                      removeDraftLine,
                      handleExerciseDropAbove,
                      handleBarDropAt,
                    });
                    // Progress bar sits between rows at the boundary index — rendered before the first PLANNED row.
                    if (index === barIndex) {
                      return (
                        <React.Fragment key={`bar-slot-${index}`}>
                          {renderProgressBar({
                            atIndex: barIndex,
                            totalRows: draftLines.length,
                            isSubmitting,
                            barDropTargetClass,
                            dragState,
                            setDragState,
                            setDropTarget,
                            readDragKind,
                            handleBarDropAt,
                            handleExerciseDropOnBar,
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
                        isSubmitting,
                        barDropTargetClass,
                        dragState,
                        setDragState,
                        setDropTarget,
                        readDragKind,
                        handleBarDropAt,
                        handleExerciseDropOnBar,
                      })
                    : null}
                  {renderEndDropZone({
                    totalRows: draftLines.length,
                    endZoneDropTargetClass,
                    isSubmitting,
                    readDragKind,
                    setDropTarget,
                    setDragState,
                    handleExerciseAppend,
                    handleBarDropAt,
                  })}
                </div>
              ) : (
                <div className="note workoutPlanEmpty">Nothing here yet.</div>
              )}
            </section>
          </div>

        </div>
      </div>
    </>
  );
}

/** Exercise row renderer — extracted to keep the modal return JSX flat and readable. */
function renderExerciseRow({
  line,
  index,
  isSubmitting,
  dragState,
  dropTarget,
  exerciseMeta,
  rowDropTargetClass,
  readDragKind,
  setDragState,
  setDropTarget,
  setExerciseField,
  removeDraftLine,
  handleExerciseDropAbove,
  handleBarDropAt,
}) {
  // Only two row states now: DONE (above bar, green) and PLANNED (below bar, blue).
  // The former "next up" highlight was dropped — all planned rows share one color.
  const rowStatus = normalizeExerciseStatus(line);
  const isDragging = dragState?.kind === "exercise" && dragState.fromIndex === index;

  return (
    <div
      data-draft-row-id={line.id}
      className={`exerciseRow exerciseRow--${rowStatusModifier({ status: rowStatus })}${rowDropTargetClass(index)}${isDragging ? " exerciseRow--dragging" : ""}`}
      draggable={false}
      onDragOver={(e) => {
        if (isSubmitting) return;
        const kind = readDragKind(e);
        if (!kind) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget({ kind: "row", index });
      }}
      onDragLeave={() => {
        setDropTarget((prev) =>
          prev?.kind === "row" && prev.index === index ? null : prev
        );
      }}
      onDrop={(e) => {
        if (isSubmitting) return;
        const kind = readDragKind(e);
        if (!kind) return;
        e.preventDefault();
        setDropTarget(null);
        setDragState(null);
        if (kind === "exercise") {
          // Drop-above rule: exercise lands directly above the hovered row (inherits its status).
          const raw =
            e.dataTransfer.getData(DRAFT_DND_TYPE) ||
            e.dataTransfer.getData("text/plain");
          const fromIndex = Number.parseInt(raw, 10);
          if (!Number.isFinite(fromIndex)) return;
          handleExerciseDropAbove(fromIndex, index);
          return;
        }
        // Bar dropped on a row → bar renders ABOVE that row (barIndex = row's current index).
        handleBarDropAt(index);
      }}
    >
      <div
        className="dragHandle"
        title="Przeciągnij, aby zmienić kolejność"
        aria-label={`Zmień kolejność: ${line.name}`}
        draggable={!isSubmitting}
        onDragStart={(e) => {
          if (isSubmitting) {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          setDragState({ kind: "exercise", fromIndex: index });
          e.dataTransfer.setData(DRAFT_DND_TYPE, String(index));
          e.dataTransfer.setData("text/plain", String(index));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={(e) => {
          e.stopPropagation();
          setDropTarget(null);
          setDragState(null);
        }}
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

/** Progress bar row — draggable boundary between DONE (above) and PLANNED (below). */
function renderProgressBar({
  atIndex,
  totalRows,
  isSubmitting,
  barDropTargetClass,
  dragState,
  setDragState,
  setDropTarget,
  readDragKind,
  handleBarDropAt,
  handleExerciseDropOnBar,
}) {
  const isDraggingBar = dragState?.kind === "bar";
  const doneCount = atIndex;
  const plannedCount = Math.max(0, totalRows - atIndex);

  return (
    <div
      // Stable id lets the FLIP layout-effect track the bar alongside exercise rows — without it the
      // bar would teleport between positions instead of animating like a reordered row.
      data-draft-row-id="__bar__"
      className={`workoutProgressBar${isDraggingBar ? " workoutProgressBar--dragging" : ""}${barDropTargetClass()}`}
      role="separator"
      aria-label={`Postęp: ${doneCount} zrobione, ${plannedCount} do zrobienia. Przeciągnij, aby zmienić.`}
      onDragOver={(e) => {
        if (isSubmitting) return;
        const kind = readDragKind(e);
        if (!kind) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget({ kind: "bar" });
      }}
      onDragLeave={() => {
        setDropTarget((prev) => (prev?.kind === "bar" ? null : prev));
      }}
      onDrop={(e) => {
        if (isSubmitting) return;
        const kind = readDragKind(e);
        if (!kind) return;
        e.preventDefault();
        setDropTarget(null);
        setDragState(null);
        if (kind === "bar") return; // dropping bar onto itself — no-op
        const raw =
          e.dataTransfer.getData(DRAFT_DND_TYPE) ||
          e.dataTransfer.getData("text/plain");
        const fromIndex = Number.parseInt(raw, 10);
        if (!Number.isFinite(fromIndex)) return;
        handleExerciseDropOnBar(fromIndex);
      }}
    >
      <div
        className="workoutProgressBar__handle"
        title="Przeciągnij pasek, aby wyznaczyć, do którego ćwiczenia dotarłeś"
        aria-label="Przeciągnij pasek postępu"
        draggable={!isSubmitting}
        onDragStart={(e) => {
          if (isSubmitting) {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          setDragState({ kind: "bar" });
          e.dataTransfer.setData(BAR_DND_TYPE, "1");
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={(e) => {
          e.stopPropagation();
          setDropTarget(null);
          setDragState(null);
        }}
      >
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

/** Invisible tail drop zone. Accepts exercise drops (append) and bar drops (bar to bottom). */
function renderEndDropZone({
  totalRows,
  endZoneDropTargetClass,
  isSubmitting,
  readDragKind,
  setDropTarget,
  setDragState,
  handleExerciseAppend,
  handleBarDropAt,
}) {
  if (totalRows === 0) return null;
  return (
    <div
      className={`workoutEndDrop${endZoneDropTargetClass()}`}
      aria-hidden="true"
      onDragOver={(e) => {
        if (isSubmitting) return;
        const kind = readDragKind(e);
        if (!kind) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget({ kind: "end" });
      }}
      onDragLeave={() => {
        setDropTarget((prev) => (prev?.kind === "end" ? null : prev));
      }}
      onDrop={(e) => {
        if (isSubmitting) return;
        const kind = readDragKind(e);
        if (!kind) return;
        e.preventDefault();
        // Clear both drop highlight and active drag so the source row stops rendering as "dragging".
        setDropTarget(null);
        setDragState(null);
        if (kind === "bar") {
          handleBarDropAt(totalRows);
          return;
        }
        const raw =
          e.dataTransfer.getData(DRAFT_DND_TYPE) ||
          e.dataTransfer.getData("text/plain");
        const fromIndex = Number.parseInt(raw, 10);
        if (!Number.isFinite(fromIndex)) return;
        handleExerciseAppend(fromIndex);
      }}
    />
  );
}
