import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MUSCLE_GROUPS } from "./workoutData.js";
import {
  digits4,
  newDraftLineId,
  reorderDraftIndices,
  rowStatusModifier,
  DRAFT_DND_TYPE,
  DRAFT_FLIP_MS,
  DRAFT_FLIP_EASING,
} from "./workoutHelpers.js";

export function WorkoutModal({
  exercisesByGroup,
  catalogError,
  draftLines,
  setDraftLines,
  exerciseMeta,
  setExerciseMeta,
  isSubmitting,
  submitError,
  onClose,
  onSubmit,
}) {
  const [activeGroup, setActiveGroup] = useState(null);
  const [draftDragOverIndex, setDraftDragOverIndex] = useState(null);
  const [draftDraggingIndex, setDraftDraggingIndex] = useState(null);
  const draftFlipContainerRef = useRef(null);
  const prevDraftLayoutRef = useRef(new Map());

  const pickerExercises = useMemo(() => {
    if (!activeGroup) return [];
    return exercisesByGroup[activeGroup] || [];
  }, [activeGroup, exercisesByGroup]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const container = draftFlipContainerRef.current;
    if (!container || draftLines.length === 0) {
      prevDraftLayoutRef.current = new Map();
      return;
    }
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

  function addExerciseFromPicker(groupName, exerciseName) {
    const id = newDraftLineId();
    setDraftLines((prev) => [...prev, { id, group: groupName, name: exerciseName, status: "PLANNED" }]);
    setExerciseMeta((prev) => ({
      ...prev,
      [id]: { weight: "0", reps: "" },
    }));
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

  function setExerciseField(lineId, field, raw) {
    const value = digits4(raw);
    setExerciseMeta((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || { weight: "0", reps: "" }), [field]: value },
    }));
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div className="modal-card">
          <div className="modal-head">
            <div>
              <div className="modal-kicker">Add workout</div>
              <h3 className="modal-title" id="modalTitle">
                Pick a group, tap exercises to add
              </h3>
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

          <div className="modal-body">
            {catalogError ? <div className="errorText">{catalogError}</div> : null}
            <div className="grid">
              {MUSCLE_GROUPS.map((g) => {
                const isSelected = activeGroup === g;
                return (
                  <button
                    key={g}
                    type="button"
                    className={`choice ${isSelected ? "selected" : ""}`}
                    onClick={() => setActiveGroup(g)}
                  >
                    <div className="choice-title">{g}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ height: 10 }} />

            {!activeGroup ? (
              <div className="note">Choose a muscle group to see exercises you can add.</div>
            ) : pickerExercises.length === 0 ? (
              <div className="note">No exercises for this group yet.</div>
            ) : (
              <section className="groupSection" aria-label={`Exercises for ${activeGroup}`}>
                <div className="groupHeader">{activeGroup} — tap to add</div>
                <div className="pickerList">
                  {pickerExercises.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      className="exercisePick"
                      onClick={() => addExerciseFromPicker(activeGroup, ex)}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div style={{ height: 16 }} />
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
              {draftLines.length > 0 ? (
                <div className="checks checks--draftFlip" ref={draftFlipContainerRef}>
                  {draftLines.map((line, index) => (
                    <div
                      data-draft-row-id={line.id}
                      className={`exerciseRow exerciseRow--${rowStatusModifier(line.status)}${
                        draftDragOverIndex === index ? " exerciseRow--dragOver" : ""
                      }${draftDraggingIndex === index ? " exerciseRow--dragging" : ""}`}
                      key={line.id}
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
                      <div className="exerciseFields">
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
                        onClick={() => removeDraftLine(line.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="note">Nothing here yet.</div>
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
