import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BODY_PART_API_NAME,
  BODY_PART_TO_GROUP_LABEL,
  MUSCLE_GROUPS,
} from "./workoutData.js";
import { WorkoutClient, WORKOUT_API_BASE } from "./workoutClient.js";
import { WorkoutBodyPart, WorkoutExercise, WorkoutSubmitRequest } from "./model/workoutRequest.js";

const workoutClient = new WorkoutClient();

/** BE: {@code status} DONE | PLANNED | NEXT; legacy {@code planned}. */
function normalizeExerciseStatus(e) {
  const s = e?.status;
  if (s === "PLANNED" || s === "NEXT" || s === "DONE") return s;
  if (e?.planned === true) return "PLANNED";
  return "DONE";
}

function rowStatusModifier(status) {
  const s = normalizeExerciseStatus({ status });
  if (s === "PLANNED") return "planned";
  if (s === "NEXT") return "next";
  return "done";
}

function exerciseToRow(group, e) {
  return {
    orderId: e.orderId ?? 0,
    group,
    name: e.name,
    weight: e.weight != null && e.weight !== "" ? String(e.weight) : "",
    reps: e.reps != null ? String(e.reps) : "",
    status: normalizeExerciseStatus(e),
  };
}

function flattenBodyPartRows(blockList) {
  return (blockList || []).flatMap((bp) => {
    const group = BODY_PART_TO_GROUP_LABEL[bp.bodyPartName] || bp.bodyPartName;
    return (bp.exercises || []).map((e) => exerciseToRow(group, e));
  });
}

/** GET /workout: executed + plan merged, sorted by orderId; each row carries {@code status} for styling. */
function mapServerWorkout(w) {
  const executed = flattenBodyPartRows(w.bodyPart);
  const planned = flattenBodyPartRows(w.exercisePlan);
  const rows = [...executed, ...planned]
    .sort((a, b) => a.orderId - b.orderId)
    .map(({ orderId: _o, ...row }) => row);
  return {
    id: w.id,
    workoutDate: w.workoutDate,
    rows,
  };
}

/** Maps GET /workout/prefill JSON to modal draft state (same shape as manual picks + meta). */
function mapPrefillToDraft(prefill) {
  const bodyParts = prefill?.bodyPart;
  if (!Array.isArray(bodyParts) || bodyParts.length === 0) {
    return { draftLines: [], exerciseMeta: {} };
  }
  const flat = [];
  for (const bp of bodyParts) {
    const group = BODY_PART_TO_GROUP_LABEL[bp.bodyPartName] || bp.bodyPartName;
    for (const ex of bp.exercises || []) {
      flat.push({ group, ex });
    }
  }
  flat.sort((a, b) => (a.ex.orderId ?? 0) - (b.ex.orderId ?? 0));
  const draftLines = [];
  const exerciseMeta = {};
  for (const { group, ex } of flat) {
    const id = newDraftLineId();
    draftLines.push({ id, group, name: ex.name, status: normalizeExerciseStatus(ex) });
    exerciseMeta[id] = {
      weight: prefillNumberToDigitsField(ex.weight),
      reps: prefillNumberToDigitsField(ex.reps),
    };
  }
  return { draftLines, exerciseMeta };
}

function prefillNumberToDigitsField(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return digits4(String(Math.round(n)));
}

function formatWorkoutDate(isoDate) {
  if (!isoDate) return "";
  try {
    return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(
      new Date(`${isoDate}T12:00:00`)
    );
  } catch {
    return String(isoDate);
  }
}

function digits4(value) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 4);
}

function parseIntOrNull(s) {
  if (!s) return null;
  const n = Number.parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
}

function newDraftLineId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const openModalInFlight = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  /** Which muscle group's exercise list is shown in the picker (single). */
  const [activeGroup, setActiveGroup] = useState(null);
  /** Ordered lines added to the current workout draft. */
  const [draftLines, setDraftLines] = useState([]);
  const [exerciseMeta, setExerciseMeta] = useState(() => ({})); // { [lineId]: { weight, reps } }
  const [templateItems, setTemplateItems] = useState([]);
  const [exercisesByGroup, setExercisesByGroup] = useState(() => ({}));
  const [catalogError, setCatalogError] = useState("");
  const [templateLoadError, setTemplateLoadError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const refreshWorkoutsFromServer = useCallback(async () => {
    const woRes = await workoutClient.getWorkouts();
    if (!woRes.ok) {
      const text = await woRes.text().catch(() => "");
      throw new Error(text || `HTTP ${woRes.status}`);
    }
    const list = await woRes.json();
    setTemplateItems(Array.isArray(list) ? list.map(mapServerWorkout) : []);
    setTemplateLoadError("");
  }, []);

  const loadExerciseCatalog = useCallback(async () => {
    const catRes = await workoutClient.getExerciseCatalog();
    if (!catRes.ok) {
      const text = await catRes.text().catch(() => "");
      throw new Error(text || `HTTP ${catRes.status}`);
    }
    const cat = await catRes.json();
    setExercisesByGroup(cat && typeof cat === "object" ? cat : {});
    setCatalogError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadExerciseCatalog();
      } catch (e) {
        if (!cancelled) {
          setCatalogError(
            `Nie udało się pobrać katalogu ćwiczeń (${e instanceof Error ? e.message : "unknown error"}).`
          );
        }
      }
      try {
        await refreshWorkoutsFromServer();
      } catch (e) {
        if (!cancelled) {
          setTemplateLoadError(
            `Nie udało się pobrać treningów (${e instanceof Error ? e.message : "unknown error"}).`
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadExerciseCatalog, refreshWorkoutsFromServer]);

  const pickerExercises = useMemo(() => {
    if (!activeGroup) return [];
    return exercisesByGroup[activeGroup] || [];
  }, [activeGroup, exercisesByGroup]);

  const canSend = useMemo(() => draftLines.length > 0, [draftLines]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
  }, [isOpen]);

  async function openModal() {
    if (openModalInFlight.current) return;
    openModalInFlight.current = true;
    setActiveGroup(null);
    setIsSubmitting(false);
    setSubmitError("");

    let draftLines = [];
    let exerciseMeta = {};
    try {
      const res = await workoutClient.prefillWorkout();
      if (res.ok) {
        const data = await res.json();
        ({ draftLines, exerciseMeta } = mapPrefillToDraft(data));
      }
    } catch {
      /* keep empty draft */
    } finally {
      openModalInFlight.current = false;
    }

    setDraftLines(draftLines);
    setExerciseMeta(exerciseMeta);
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
    setIsSubmitting(false);
    setSubmitError("");
  }

  function addExerciseFromPicker(groupName, exerciseName) {
    const id = newDraftLineId();
    setDraftLines((prev) => [...prev, { id, group: groupName, name: exerciseName, status: "PLANNED" }]);
    setExerciseMeta((prev) => ({
      ...prev,
      [id]: { weight: "", reps: "" },
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
    setSubmitError("");
  }

  function setExerciseField(lineId, field, raw) {
    const value = digits4(raw);
    setExerciseMeta((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || { weight: "", reps: "" }), [field]: value },
    }));
  }

  async function addWorkoutToTemplate() {
    if (!canSend) {
      setSubmitError("Add at least one exercise to the workout below.");
      return;
    }

    for (const line of draftLines) {
      const reps = parseIntOrNull(exerciseMeta[line.id]?.reps || "");
      const weight = parseIntOrNull(exerciseMeta[line.id]?.weight || "");
      if (reps == null || weight == null) {
        setSubmitError("Fill in Weight and Reps for every exercise in your workout.");
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError("");

    const request = new WorkoutSubmitRequest();
    /** One bodyPart block per draft line so global order matches the UI (same as prefill). */
    request.bodyPart = draftLines.map((line) => {
      const block = new WorkoutBodyPart();
      block.bodyPartName = BODY_PART_API_NAME[line.group] || String(line.group).toLowerCase();
      const row = new WorkoutExercise();
      row.name = line.name;
      row.weight = parseIntOrNull(exerciseMeta[line.id]?.weight || "");
      row.reps = parseIntOrNull(exerciseMeta[line.id]?.reps || "");
      row.status = line.status ?? "PLANNED";
      block.exercises = [row];
      return block;
    });

    console.info("POST /workout payload", request);

    try {
      const res = await workoutClient.postWorkouts(request);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      closeModal();
      try {
        await refreshWorkoutsFromServer();
      } catch (e2) {
        setTemplateLoadError(
          `Trening zapisany, ale lista nie odświeżyła się (${e2 instanceof Error ? e2.message : "unknown error"}).`
        );
      }
    } catch (e) {
      setSubmitError(
        `Failed to POST to ${WORKOUT_API_BASE}/workout (${e instanceof Error ? e.message : "unknown error"})`
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div>
            <div className="title">Brogress</div>
            <div className="subtitle">Workout template builder</div>
          </div>
        </div>
        <button className="btn primary" type="button" onClick={openModal}>
          Add workout
        </button>
      </header>

      <section className="content">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Template</h2>
            <p className="panel-hint">
              Add a workout: pick a muscle group, tap exercises, then set weight and reps below.
            </p>
          </div>
          <div className="template" aria-live="polite">
            {templateLoadError ? <div className="errorText">{templateLoadError}</div> : null}
            {templateItems.length === 0 && !templateLoadError ? (
              <div className="empty">
                Nothing here yet. Click <span className="pill">Add workout</span>.
              </div>
            ) : null}
            {templateItems.map((item) => (
              <div className="card" key={item.id}>
                <div className="card-top">
                  <div className="card-title">{formatWorkoutDate(item.workoutDate)}</div>
                </div>
                <div className="workoutRows">
                  {item.rows.map((row, idx) => (
                    <div
                      className={`workoutRow workoutRow--${rowStatusModifier(row.status)}`}
                      key={`${item.id}-${idx}`}
                    >
                      <span className="workoutRowGroup">{row.group}</span>
                      <span className="workoutRowName">{row.name}</span>
                      <span className="workoutRowStats" aria-label="Ciężar i powtórzenia">
                        {row.weight && row.reps ? `${row.weight} × ${row.reps}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {isOpen ? (
        <>
          <div className="modal-backdrop" onClick={closeModal} />
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
                  onClick={closeModal}
                >
                  X
                </button>
              </div>

              <div className="modal-body">
                {catalogError ? <div className="errorText">{catalogError}</div> : null}
                <div className="grid">
                  {MUSCLE_GROUPS.map((g) => {
                    const count = (exercisesByGroup[g] || []).length;
                    const isSelected = activeGroup === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        className={`choice ${isSelected ? "selected" : ""}`}
                        onClick={() => setActiveGroup(g)}
                      >
                        <div className="choice-title">{g}</div>
                        <div className="choice-sub">{count > 0 ? `${count} exercises` : ""}</div>
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
                    <div className="checks">
                      {draftLines.map((line) => (
                        <div
                          className={`exerciseRow exerciseRow--${rowStatusModifier(line.status)}`}
                          key={line.id}
                        >
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
                <button className="btn" type="button" onClick={closeModal} disabled={isSubmitting}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={addWorkoutToTemplate}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Add"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
