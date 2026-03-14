import React, { useEffect, useMemo, useState } from "react";
import { BODY_PART_API_NAME, EXERCISES_BY_GROUP, MUSCLE_GROUPS } from "./workoutData.js";

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

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState(() => new Set());
  const [selectedExercises, setSelectedExercises] = useState(() => new Set());
  const [exerciseMeta, setExerciseMeta] = useState(() => ({})); // { [exerciseName]: { weight: "123", reps: "10" } }
  const [templateItems, setTemplateItems] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const selectedGroupList = useMemo(() => {
    return MUSCLE_GROUPS.filter((g) => selectedGroups.has(g));
  }, [selectedGroups]);

  const visibleExercisesAll = useMemo(() => {
    if (selectedGroups.size === 0) return [];
    const all = new Set();
    for (const g of selectedGroups) {
      const list = EXERCISES_BY_GROUP[g] || [];
      for (const ex of list) all.add(ex);
    }
    return Array.from(all);
  }, [selectedGroups]);

  const canSend = useMemo(() => {
    return selectedGroups.size > 0 && visibleExercisesAll.length > 0 && selectedExercises.size > 0;
  }, [selectedGroups, visibleExercisesAll, selectedExercises]);

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
    setSelectedGroups(new Set());
    setSelectedExercises(new Set());
    setExerciseMeta({});
    setIsSubmitting(false);
    setSubmitError("");
  }

  function closeModal() {
    setIsOpen(false);
    setIsSubmitting(false);
    setSubmitError("");
  }

  function toggleExercise(exercise, checked) {
    setSelectedExercises((prev) => {
      const next = new Set(prev);
      if (checked) next.add(exercise);
      else next.delete(exercise);
      return next;
    });
  }

  function setExerciseField(exercise, field, raw) {
    const value = digits4(raw);
    setExerciseMeta((prev) => ({
      ...prev,
      [exercise]: { ...(prev[exercise] || { weight: "", reps: "" }), [field]: value },
    }));
    // Typing implies intent to include the exercise.
    setSelectedExercises((prev) => new Set(prev).add(exercise));
  }

  function buildWorkoutRequestBody() {
    const bodyPart = selectedGroupList
      .map((groupName) => {
      const list = EXERCISES_BY_GROUP[groupName] || [];
      const exercises = list
        .filter((ex) => selectedExercises.has(ex))
        .map((name) => ({
          name,
          reps: parseIntOrNull(exerciseMeta[name]?.reps || ""),
          weight: parseIntOrNull(exerciseMeta[name]?.weight || ""),
        }));

        return {
          bodyPartName: BODY_PART_API_NAME[groupName] || String(groupName).toLowerCase(),
          exercises,
        };
      })
      .filter((p) => p.exercises.length > 0);

    return { bodyPart };
  }

  async function addWorkoutToTemplate() {
    if (!canSend) {
      setSubmitError("Select at least one muscle group and one exercise.");
      return;
    }

    for (const ex of selectedExercises) {
      const reps = parseIntOrNull(exerciseMeta[ex]?.reps || "");
      const weight = parseIntOrNull(exerciseMeta[ex]?.weight || "");
      if (reps == null || weight == null) {
        setSubmitError("Fill in Weight and Reps for every selected exercise.");
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError("");

    const groups = MUSCLE_GROUPS.filter((g) => selectedGroups.has(g));
    const exercises = Array.from(selectedExercises).map((name) => ({
      name,
      weight: exerciseMeta[name]?.weight || "",
      reps: exerciseMeta[name]?.reps || "",
    }));

    const payload = buildWorkoutRequestBody();
    // Helpful for debugging in browser DevTools.
    console.info("POST /workout payload", payload);

    try {
      const res = await fetch("http://localhost:8080/workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

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

  useEffect(() => {
    if (selectedGroups.size === 0) {
      setSelectedExercises(new Set());
      setExerciseMeta({});
      return;
    }

    const visible = new Set();
    for (const g of selectedGroups) {
      const list = EXERCISES_BY_GROUP[g] || [];
      for (const ex of list) visible.add(ex);
    }

    setSelectedExercises((prev) => new Set(Array.from(prev).filter((e) => visible.has(e))));
    setExerciseMeta((prev) => {
      const next = {};
      for (const [ex, meta] of Object.entries(prev)) {
        if (visible.has(ex)) next[ex] = meta;
      }
      return next;
    });
  }, [selectedGroups]);

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
            <p className="panel-hint">Add a workout: pick a muscle group, then exercises.</p>
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
                    Pick muscle groups and exercises
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
                    const isSelected = selectedGroups.has(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        className={`choice ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(g)) next.delete(g);
                            else next.add(g);
                            return next;
                          });
                        }}
                      >
                        <div className="choice-title">{g}</div>
                        <div className="choice-sub">{count > 0 ? `${count} exercises` : ""}</div>
                      </button>
                    );
                  })}
                </div>

                <div style={{ height: 10 }} />

                {selectedGroups.size === 0 ? (
                  <div className="note">Click one or more muscle groups to see exercises.</div>
                ) : visibleExercisesAll.length === 0 ? (
                  <div className="note">No exercises for the selected muscle groups yet.</div>
                ) : (
                  <div className="grouped">
                    {selectedGroupList.map((groupName) => {
                      const list = EXERCISES_BY_GROUP[groupName] || [];
                      return (
                        <section className="groupSection" key={groupName}>
                          <div className="groupHeader">{groupName}</div>
                          {list.length === 0 ? (
                            <div className="note">No exercises yet.</div>
                          ) : (
                            <div className="checks">
                              {list.map((ex) => (
                                <div className="exerciseRow" key={`${groupName}:${ex}`}>
                                  <label className="exerciseLeft">
                                    <input
                                      type="checkbox"
                                      checked={selectedExercises.has(ex)}
                                      onChange={(e) => toggleExercise(ex, e.target.checked)}
                                    />
                                    <span className="check-text">{ex}</span>
                                  </label>
                                  <div className="exerciseFields">
                                    <input
                                      className="numField"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      maxLength={4}
                                      placeholder="Weight"
                                      value={exerciseMeta[ex]?.weight || ""}
                                      onChange={(e) => setExerciseField(ex, "weight", e.target.value)}
                                    />
                                    <input
                                      className="numField"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      maxLength={4}
                                      placeholder="Reps"
                                      value={exerciseMeta[ex]?.reps || ""}
                                      onChange={(e) => setExerciseField(ex, "reps", e.target.value)}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
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
