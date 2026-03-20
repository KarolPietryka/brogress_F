import React, { useEffect, useMemo, useState } from "react";
import { BODY_PART_API_NAME, EXERCISES_BY_GROUP, MUSCLE_GROUPS } from "./workoutData.js";
import { WorkoutClient } from "./workoutClient.js";
import { WorkoutBodyPart, WorkoutExercise, WorkoutSubmitRequest } from "./workoutRequest.js";

const workoutClient = new WorkoutClient();

function formatTime(ts) {
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(ts));
  } catch {
    return "";
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
  const [isOpen, setIsOpen] = useState(false);
  /** Which muscle group's exercise list is shown in the picker (single). */
  const [activeGroup, setActiveGroup] = useState(null);
  /** Ordered lines added to the current workout draft. */
  const [draftLines, setDraftLines] = useState([]);
  const [exerciseMeta, setExerciseMeta] = useState(() => ({})); // { [lineId]: { weight, reps } }
  const [templateItems, setTemplateItems] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const pickerExercises = useMemo(() => {
    if (!activeGroup) return [];
    return EXERCISES_BY_GROUP[activeGroup] || [];
  }, [activeGroup]);

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

  function openModal() {
    setIsOpen(true);
    setActiveGroup(null);
    setDraftLines([]);
    setExerciseMeta({});
    setIsSubmitting(false);
    setSubmitError("");
  }

  function closeModal() {
    setIsOpen(false);
    setIsSubmitting(false);
    setSubmitError("");
  }

  function addExerciseFromPicker(groupName, exerciseName) {
    const id = newDraftLineId();
    setDraftLines((prev) => [...prev, { id, group: groupName, name: exerciseName }]);
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

    const groups = [...new Set(draftLines.map((l) => l.group))];
    const exercises = draftLines.map((line) => ({
      name: line.name,
      weight: exerciseMeta[line.id]?.weight || "",
      reps: exerciseMeta[line.id]?.reps || "",
    }));

    const request = new WorkoutSubmitRequest();
    const groupOrder = [];
    const byGroup = new Map();
    for (const line of draftLines) {
      if (!byGroup.has(line.group)) {
        byGroup.set(line.group, []);
        groupOrder.push(line.group);
      }
      const row = new WorkoutExercise();
      row.name = line.name;
      row.weight = parseIntOrNull(exerciseMeta[line.id]?.weight || "");
      row.reps = parseIntOrNull(exerciseMeta[line.id]?.reps || "");
      byGroup.get(line.group).push(row);
    }
    request.bodyPart = groupOrder.map((groupName) => {
      const block = new WorkoutBodyPart();
      block.bodyPartName = BODY_PART_API_NAME[groupName] || String(groupName).toLowerCase();
      block.exercises = byGroup.get(groupName);
      return block;
    });

    console.info("POST /workout payload", request);

    try {
      const res = await workoutClient.post(request);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      setTemplateItems((prev) => [...prev, { groups, exercises, createdAt: Date.now() }]);
      closeModal();
    } catch (e) {
      setSubmitError(
        `Failed to POST to http://localhost:8080/workout (${e instanceof Error ? e.message : "unknown error"})`
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
            {templateItems.length === 0 ? (
              <div className="empty">
                Nothing here yet. Click <span className="pill">Add workout</span>.
              </div>
            ) : (
              templateItems.map((item) => (
                <div className="card" key={`${item.createdAt}-${item.groups.join("+")}`}>
                  <div className="card-top">
                    <div className="card-title">{item.groups.join(" + ")}</div>
                    <div className="card-meta">{formatTime(item.createdAt)}</div>
                  </div>
                  <div className="tags">
                    {item.exercises.map((e) => (
                      <span className="tag" key={e.name}>
                        {e.weight && e.reps ? `${e.name} ${e.weight}x${e.reps}` : e.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
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
                <div className="grid">
                  {MUSCLE_GROUPS.map((g) => {
                    const count = (EXERCISES_BY_GROUP[g] || []).length;
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

                {draftLines.length > 0 ? (
                  <>
                    <div style={{ height: 16 }} />
                    <section className="groupSection" aria-label="Current workout">
                      <div className="groupHeader">Your workout</div>
                      <div className="checks">
                        {draftLines.map((line) => (
                          <div className="exerciseRow" key={line.id}>
                            <div className="exerciseNameCell">
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
                    </section>
                  </>
                ) : null}
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
