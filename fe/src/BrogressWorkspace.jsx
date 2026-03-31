import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkoutClient, WORKOUT_API_BASE } from "./workoutClient.js";
import { BODY_PART_API_NAME } from "./workoutData.js";
import { WorkoutExercise, WorkoutSubmitRequest } from "./model/workoutRequest.js";
import {
  mapServerWorkout,
  mapPrefillToDraft,
  parseIntOrNull,
  parseWeightIntOrNull,
} from "./workoutHelpers.js";
import { GraphPanel } from "./GraphPanel.jsx";
import { WorkoutListPanel } from "./WorkoutListPanel.jsx";
import { WorkoutModal } from "./WorkoutModal.jsx";

export function BrogressWorkspace({ authToken, urlNick, onAuthLost, onLogout }) {
  const workoutClient = useMemo(
    () =>
      new WorkoutClient({
        getToken: () => authToken,
        onUnauthorized: () => onAuthLost?.(),
      }),
    [authToken, onAuthLost]
  );

  const openModalInFlight = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const [exerciseMeta, setExerciseMeta] = useState(() => ({}));
  const [templateItems, setTemplateItems] = useState([]);
  const [exercisesByGroup, setExercisesByGroup] = useState(() => ({}));
  const [catalogError, setCatalogError] = useState("");
  const [templateLoadError, setTemplateLoadError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
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
  }, [workoutClient]);

  const loadExerciseCatalog = useCallback(async () => {
    const catRes = await workoutClient.getExerciseCatalog();
    if (!catRes.ok) {
      const text = await catRes.text().catch(() => "");
      throw new Error(text || `HTTP ${catRes.status}`);
    }
    const cat = await catRes.json();
    setExercisesByGroup(cat && typeof cat === "object" ? cat : {});
    setCatalogError("");
  }, [workoutClient]);

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

  const canSend = useMemo(() => draftLines.length > 0, [draftLines]);

  async function openModal() {
    if (openModalInFlight.current) return;
    openModalInFlight.current = true;
    setIsSubmitting(false);
    setSubmitError("");

    let prefillDraft = [];
    let prefillMeta = {};
    try {
      const res = await workoutClient.prefillWorkout();
      if (res.ok) {
        const data = await res.json();
        ({ draftLines: prefillDraft, exerciseMeta: prefillMeta } = mapPrefillToDraft(data));
      }
    } catch {
      /* keep empty draft */
    } finally {
      openModalInFlight.current = false;
    }

    setDraftLines(prefillDraft);
    setExerciseMeta(prefillMeta);
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
    setIsSubmitting(false);
    setSubmitError("");
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
            <div className="subtitle">
              Workout template builder
              {urlNick ? (
                <>
                  {" "}
                  · <span className="header-nick">{urlNick}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="header-actions">
          {typeof onLogout === "function" ? (
            <button className="btn" type="button" onClick={onLogout}>
              Wyloguj
            </button>
          ) : null}
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
          <GraphPanel
            volumePoints={graphVolumePoints}
            volumeError={graphVolumeError}
            volumeLoading={graphVolumeLoading}
          />
        ) : (
          <WorkoutListPanel
            items={templateItems}
            loadError={templateLoadError}
          />
        )}
      </section>

      {isOpen ? (
        <WorkoutModal
          exercisesByGroup={exercisesByGroup}
          catalogError={catalogError}
          draftLines={draftLines}
          setDraftLines={setDraftLines}
          exerciseMeta={exerciseMeta}
          setExerciseMeta={setExerciseMeta}
          isSubmitting={isSubmitting}
          submitError={submitError}
          onClose={closeModal}
          onSubmit={addWorkoutToTemplate}
        />
      ) : null}
    </main>
  );
}
