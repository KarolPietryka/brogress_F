import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ComposerPickListPortal } from "./ComposerPickList.jsx";
import { BODY_PART_API_NAME, MUSCLE_GROUPS } from "./workoutData.js";
import {
  digits4,
  draftLinesOnlyStatusChanged,
  lastPlannedComposerPrefill,
  newDraftLineId,
  normalizeExerciseStatus,
  reorderDraftIndices,
  rowStatusModifier,
  DRAFT_DND_TYPE,
  DRAFT_FLIP_MS,
  DRAFT_FLIP_EASING,
} from "./workoutHelpers.js";

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
  onSubmit,
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
  const [draftDragOverIndex, setDraftDragOverIndex] = useState(null);
  const [draftDraggingIndex, setDraftDraggingIndex] = useState(null);
  const draftFlipContainerRef = useRef(null);
  const prevDraftLayoutRef = useRef(new Map());
  const prevDraftLinesForFlipRef = useRef(null);
  const modalBodyRef = useRef(null);

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
    const p = lastPlannedComposerPrefill(draftLines, exerciseMeta);
    setComposerWeight(p.weight);
    setComposerReps(p.reps);
    if (p.plannedRowId) {
      setComposerGroup(p.group);
      setComposerExercise(p.name);
      setComposerExerciseId(p.exerciseId != null ? p.exerciseId : null);
    } else if (draftLines.length === 0) {
      setComposerGroup(MUSCLE_GROUPS[0] || "");
      setComposerExercise("");
      setComposerExerciseId(null);
    } else {
      setComposerExercise("");
      setComposerExerciseId(null);
    }
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

    const prevLines = prevDraftLinesForFlipRef.current;
    const statusOnly =
      prevLines != null && draftLinesOnlyStatusChanged(prevLines, draftLines);
    prevDraftLinesForFlipRef.current = draftLines;

    const rowEls = container.querySelectorAll("[data-draft-row-id]");
    const nextRects = new Map();
    for (const el of rowEls) {
      const id = el.getAttribute("data-draft-row-id");
      if (id) nextRects.set(id, el.getBoundingClientRect());
    }

    if (statusOnly) {
      prevDraftLayoutRef.current = nextRects;
      return;
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
    setDraftLines((prev) => [
      ...prev,
      {
        id,
        group: composerGroup,
        name: composerExercise,
        exerciseId: composerExerciseId != null ? composerExerciseId : undefined,
        status: "PLANNED",
      },
    ]);
    setExerciseMeta((prev) => ({
      ...prev,
      [id]: { weight: composerWeight || "0", reps: composerReps || "" },
    }));
    setComposerExercise("");
    setComposerExerciseId(null);
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

  function removeDraftLine(lineId) {
    setDraftLines((prev) => prev.filter((l) => l.id !== lineId));
    setExerciseMeta((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }

  function clearEntireDraft() {
    setDraftLines([]);
    setExerciseMeta({});
    setDraftDragOverIndex(null);
    setDraftDraggingIndex(null);
  }

  function moveDraftLine(fromIndex, toIndex) {
    setDraftLines((prev) => reorderDraftIndices(prev, fromIndex, toIndex));
  }

  /** PLANNED ↔ NEXT so several rows can be submitted as performed in one Add (BE stores NEXT as DONE). */
  function toggleDraftLinePlanStatus(lineId) {
    if (isSubmitting) return;
    setDraftLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const s = normalizeExerciseStatus(line);
        if (s === "PLANNED") return { ...line, status: "NEXT" };
        if (s === "NEXT") return { ...line, status: "PLANNED" };
        return line;
      })
    );
  }

  function setExerciseField(lineId, field, raw) {
    const value = digits4(raw);
    setExerciseMeta((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || { weight: "0", reps: "" }), [field]: value },
    }));
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
                Add workout
              </div>
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
                <div
                  className={`exerciseRow exerciseRow--composer${
                    composerRowFlash ? " exerciseRow--composerFlash" : ""
                  }`}
                  aria-label="Add new exercise"
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
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      placeholder="Weight"
                      value={composerWeight}
                      disabled={isSubmitting}
                      onChange={(e) => setComposerWeight(digits4(e.target.value))}
                    />
                    <input
                      className="numField"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      placeholder="Reps"
                      value={composerReps}
                      disabled={isSubmitting}
                      onChange={(e) => setComposerReps(digits4(e.target.value))}
                    />
                  </div>
                  <button
                    type="button"
                    className="rowAdd"
                    disabled={isSubmitting || !composerExercise}
                    aria-label="Add exercise to list"
                    onClick={addExerciseFromComposer}
                  >
                    +
                  </button>
                </div>
              </div>

              {draftLines.length > 0 ? (
                <div className="checks checks--draftFlip" ref={draftFlipContainerRef}>
                  {draftLines.map((line, index) => {
                    const rowStatus = normalizeExerciseStatus(line);
                    const canTogglePlanStatus = rowStatus === "PLANNED" || rowStatus === "NEXT";
                    return (
                      <div
                        data-draft-row-id={line.id}
                        className={`exerciseRow exerciseRow--${rowStatusModifier(line.status)}${
                          draftDragOverIndex === index ? " exerciseRow--dragOver" : ""
                        }${draftDraggingIndex === index ? " exerciseRow--dragging" : ""}${
                          canTogglePlanStatus ? " exerciseRow--planClickable" : ""
                        }`}
                        key={line.id}
                        tabIndex={canTogglePlanStatus && !isSubmitting ? 0 : undefined}
                        aria-label={
                          canTogglePlanStatus
                            ? `${line.name}: ${rowStatus === "NEXT" ? "następne — kliknij pasek, by ustawić jako planowane" : "planowane — kliknij pasek, by ustawić jako następne"}`
                            : undefined
                        }
                        onClick={
                          canTogglePlanStatus && !isSubmitting
                            ? () => toggleDraftLinePlanStatus(line.id)
                            : undefined
                        }
                        onKeyDown={
                          canTogglePlanStatus && !isSubmitting
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleDraftLinePlanStatus(line.id);
                                }
                              }
                            : undefined
                        }
                        onDragOver={(e) => {
                          if (isSubmitting) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDraftDragOverIndex(index);
                        }}
                        onDrop={(e) => {
                          if (isSubmitting) return;
                          e.preventDefault();
                          const raw =
                            e.dataTransfer.getData(DRAFT_DND_TYPE) ||
                            e.dataTransfer.getData("text/plain");
                          const fromIndex = Number.parseInt(raw, 10);
                          setDraftDragOverIndex(null);
                          if (!Number.isFinite(fromIndex)) return;
                          moveDraftLine(fromIndex, index);
                        }}
                      >
                      <div
                        className="dragHandle"
                        draggable={!isSubmitting}
                        title="Przeciągnij, aby zmienić kolejność"
                        aria-label={`Zmień kolejność: ${line.name}`}
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          setDraftDraggingIndex(index);
                          e.dataTransfer.setData(DRAFT_DND_TYPE, String(index));
                          e.dataTransfer.setData("text/plain", String(index));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          setDraftDragOverIndex(null);
                          setDraftDraggingIndex(null);
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
                      <div className="exerciseFields" onClick={(e) => e.stopPropagation()}>
                        <input
                          className="numField"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={4}
                          placeholder="Weight"
                          value={exerciseMeta[line.id]?.weight || ""}
                          onChange={(e) => setExerciseField(line.id, "weight", e.target.value)}
                        />
                        <input
                          className="numField"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={4}
                          placeholder="Reps"
                          value={exerciseMeta[line.id]?.reps || ""}
                          onChange={(e) => setExerciseField(line.id, "reps", e.target.value)}
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
                  })}
                </div>
              ) : (
                <div className="note workoutPlanEmpty">Nothing here yet.</div>
              )}
            </section>
          </div>

          <div className="modal-foot">
            {submitError ? <div className="errorText">{submitError}</div> : null}
            <div className="spacer" />
            <button className="btn" type="button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Sending..." : "Add"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
