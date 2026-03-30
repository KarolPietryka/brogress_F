import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BODY_PART_API_NAME,
  BODY_PART_TO_GROUP_LABEL,
  MUSCLE_GROUPS,
} from "./workoutData.js";
import { WorkoutClient, WORKOUT_API_BASE } from "./workoutClient.js";
import { WorkoutExercise, WorkoutSubmitRequest } from "./model/workoutRequest.js";
import { VolumeChart } from "./VolumeChart.jsx";

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
  const repsStr = e.reps != null && e.reps !== "" ? String(e.reps) : "";
  const hasReps = repsStr !== "";
  const wRaw = e.weight;
  const weightStr =
    wRaw != null && wRaw !== ""
      ? String(wRaw)
      : hasReps
        ? "0"
        : "";
  return {
    orderId: e.orderId ?? 0,
    group,
    name: e.name,
    weight: weightStr,
    reps: repsStr,
    status: normalizeExerciseStatus(e),
  };
}

/** GET /workout: each list item includes {@code bodyPartName} (same as entity). */
function mapExerciseListToRows(list) {
  return (list || []).map((e) => {
    const group = BODY_PART_TO_GROUP_LABEL[e.bodyPartName] || e.bodyPartName;
    return exerciseToRow(group, e);
  });
}

/** GET /workout: executed + plan merged, sorted by orderId; each row carries {@code status} for styling. */
function mapServerWorkout(w) {
  const executed = mapExerciseListToRows(w.bodyPart);
  const planned = mapExerciseListToRows(w.exercisePlan);
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
  const exercises = prefill?.bodyPart;
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { draftLines: [], exerciseMeta: {} };
  }
  const sorted = [...exercises].sort((a, b) => (a.orderId ?? 0) - (b.orderId ?? 0));
  const draftLines = [];
  const exerciseMeta = {};
  for (const ex of sorted) {
    const group = BODY_PART_TO_GROUP_LABEL[ex.bodyPartName] || ex.bodyPartName;
    const id = newDraftLineId();
    draftLines.push({ id, group, name: ex.name, status: normalizeExerciseStatus(ex) });
    exerciseMeta[id] = {
      weight: prefillWeightField(ex.weight),
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

/** Prefill weight: missing or invalid → "0" so bodyweight / no-BE-weight rows are editable. */
function prefillWeightField(value) {
  if (value == null || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
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

/** Empty weight field submits as 0 (bodyweight / default). */
function parseWeightIntOrNull(s) {
  if (s === "" || s == null) return 0;
  const n = Number.parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
}

function newDraftLineId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const DRAFT_DND_TYPE = "application/x-brogress-draft-index";

const DRAFT_FLIP_MS = 320;
const DRAFT_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Reorder so the item at {@code fromIndex} ends up immediately before the row that was at {@code toIndex} (drop target). */
function reorderDraftIndices(lines, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= lines.length ||
    toIndex >= lines.length
  ) {
    return lines;
  }
  const next = [...lines];
  const [item] = next.splice(fromIndex, 1);
  const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(insertAt, 0, item);
  return next;
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
  /** Drop-target row index while reordering "Your workout" (drag handle only). */
  const [draftDragOverIndex, setDraftDragOverIndex] = useState(null);
  /** Source row index while HTML5 drag is active (visual “lift”). */
  const [draftDraggingIndex, setDraftDraggingIndex] = useState(null);
  const draftFlipContainerRef = useRef(null);
  const prevDraftLayoutRef = useRef(new Map());
  /** GRAPH SHELL: toggles main content between workout history and graph placeholder. */
  const [graphShellOpen, setGraphShellOpen] = useState(false);
  const [graphVolumePoints, setGraphVolumePoints] = useState([]);
  const [graphVolumeError, setGraphVolumeError] = useState("");
  const [graphVolumeLoading, setGraphVolumeLoading] = useState(false);

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

  useEffect(() => {
    if (!graphShellOpen) return undefined;
    let cancelled = false;
    setGraphVolumeLoading(true);
    setGraphVolumeError("");
    (async () => {
      try {
        const res = await workoutClient.getGraphVolume();
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) {
          setGraphVolumePoints(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!cancelled) {
          setGraphVolumeError(
            `Nie udało się pobrać wykresu (${e instanceof Error ? e.message : "unknown error"}).`
          );
          setGraphVolumePoints([]);
        }
      } finally {
        if (!cancelled) setGraphVolumeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphShellOpen]);

  const pickerExercises = useMemo(() => {
    if (!activeGroup) return [];
    return exercisesByGroup[activeGroup] || [];
  }, [activeGroup, exercisesByGroup]);

  const graphChartData = useMemo(
    () =>
      graphVolumePoints.map((p) => ({
        day: p.workoutDay,
        volume: Number(p.volume),
      })),
    [graphVolumePoints]
  );

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

  // FLIP: after reorder, animate rows from previous positions to the new layout.
  useLayoutEffect(() => {
    if (!isOpen) {
      prevDraftLayoutRef.current = new Map();
      return;
    }
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
  }, [draftLines, isOpen]);

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
    setDraftDragOverIndex(null);
    setDraftDraggingIndex(null);
  }

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
    setSubmitError("");
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

  async function addWorkoutToTemplate() {
    if (!canSend) {
      setSubmitError("Add at least one exercise to the workout below.");
      return;
    }

    for (const line of draftLines) {
      const reps = parseIntOrNull(exerciseMeta[line.id]?.reps || "");
      const weight = parseWeightIntOrNull(exerciseMeta[line.id]?.weight);
      if (reps == null) {
        setSubmitError("Fill in Reps for every exercise in your workout.");
        return;
      }
      if (weight === null) {
        setSubmitError("Invalid weight for an exercise in your workout.");
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError("");

    const request = new WorkoutSubmitRequest();
    request.exercises = draftLines.map((line) => {
      const row = new WorkoutExercise();
      row.bodyPartName = BODY_PART_API_NAME[line.group] || String(line.group).toLowerCase();
      row.name = line.name;
      row.weight = parseWeightIntOrNull(exerciseMeta[line.id]?.weight);
      row.reps = parseIntOrNull(exerciseMeta[line.id]?.reps || "");
      row.status = line.status ?? "PLANNED";
      return row;
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
        <div className="header-actions">
          <button
            className={`btn${graphShellOpen ? " btn-toggle-on" : ""}`}
            type="button"
            aria-pressed={graphShellOpen}
            aria-label={graphShellOpen ? "Wróć do listy treningów" : "Pokaż wykres wolumenu"}
            onClick={() => setGraphShellOpen((v) => !v)}
          >
            Your Brogress
          </button>
          <button className="btn primary" type="button" onClick={openModal}>
            Add workout
          </button>
        </div>
      </header>

      <section className="content">
        {graphShellOpen ? (
          <div className="panel graph-shell-panel">
            <div className="panel-head">
              <h2 className="panel-title">Wolumen</h2>
              <p className="panel-hint">
                Bieżąca seria — wolumen wg dnia treningu (<span className="pill">GET /brogres/graph</span>).
              </p>
            </div>
            {graphVolumeError ? <div className="errorText graph-shell-status">{graphVolumeError}</div> : null}
            {graphVolumeLoading ? (
              <div className="graph-shell" aria-busy="true" aria-label="Ładowanie danych wykresu">
                <div className="graph-shell-chart">
                  <div className="graph-shell-bars">
                    <div className="graph-shell-bar" style={{ height: "42%" }} />
                    <div className="graph-shell-bar" style={{ height: "68%" }} />
                    <div className="graph-shell-bar" style={{ height: "55%" }} />
                    <div className="graph-shell-bar" style={{ height: "88%" }} />
                    <div className="graph-shell-bar" style={{ height: "36%" }} />
                    <div className="graph-shell-bar" style={{ height: "72%" }} />
                  </div>
                  <div className="graph-shell-axis graph-shell-axis--x" />
                  <div className="graph-shell-axis graph-shell-axis--y" />
                </div>
                <p className="graph-shell-loading">Ładowanie…</p>
              </div>
            ) : (
              <div className="graph-volume-body" aria-live="polite">
                {graphVolumePoints.length === 0 && !graphVolumeError ? (
                  <div className="empty graph-shell-empty">Brak punktów w bieżącej serii.</div>
                ) : null}
                {graphVolumePoints.length > 0 ? (
                  <>
                    <div
                      className="volume-chart-region"
                      role="img"
                      aria-label="Wykres liniowy wolumenu w kolejnych dniach treningu"
                    >
                      <VolumeChart data={graphChartData} formatDayLabel={formatWorkoutDate} />
                    </div>
                    <div className="graph-volume-table-wrap graph-volume-table-wrap--below">
                      <table className="graph-volume-table">
                        <thead>
                          <tr>
                            <th scope="col">Dzień</th>
                            <th scope="col" className="graph-volume-col-num">
                              Wolumen
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {graphVolumePoints.map((row) => (
                            <tr key={row.workoutDay}>
                              <td>{formatWorkoutDate(row.workoutDay)}</td>
                              <td className="graph-volume-num">{Number(row.volume)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ) : (
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
                          {row.reps ? `${row.weight || "0"} × ${row.reps}` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
