import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import { WorkoutClient } from "./workoutClient.js";
import { BODY_PART_API_NAME } from "./workoutData.js";
import { WorkoutExercise, WorkoutSubmitRequest } from "./model/workoutRequest.js";
import {
  mapServerWorkout,
  mapPrefillToDraft,
  mapSummaryItemToDraft,
  formatWorkoutDate,
  parseRepsIntForApi,
  parseWeightForApi,
} from "./workoutHelpers.js";
import { GraphPanel } from "./GraphPanel.jsx";
import { WorkoutListPanel } from "./WorkoutListPanel.jsx";
import { WorkoutModal } from "./WorkoutModal.jsx";

export function BrogressWorkspace({ authToken, onAuthLost, onLogout }) {
  const workoutClient = useMemo(
    () =>
      new WorkoutClient({
        getToken: () => authToken,
        onUnauthorized: () => onAuthLost?.(),
      }),
    [authToken, onAuthLost]
  );

  const openModalInFlight = useRef(false);
  /** Flips to true on the first successful drop-induced PUT so {@link closeModal} knows to refresh the summary list. */
  const draftDirtyRef = useRef(false);
  /** When set, modal submit calls PUT /workout/{id} instead of POST /workout (today). */
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const [exerciseMeta, setExerciseMeta] = useState(() => ({}));
  const [templateItems, setTemplateItems] = useState([]);
  const [templateLoadError, setTemplateLoadError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [graphShellOpen, setGraphShellOpen] = useState(false);
  const [graphVolumePoints, setGraphVolumePoints] = useState([]);
  const [graphVolumeError, setGraphVolumeError] = useState("");
  const [graphVolumeLoading, setGraphVolumeLoading] = useState(false);
  const [graphReloadTrigger, setGraphReloadTrigger] = useState(0);

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

  const loadExercisePicker = useCallback(async (bodyPart) => {
    const res = await workoutClient.getExercisePicker(bodyPart);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  }, [workoutClient]);

  const createUserExercise = useCallback(async (bodyPart, name) => {
    const res = await workoutClient.postUserExercise({ bodyPart, name });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  }, [workoutClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
  }, [refreshWorkoutsFromServer]);

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
            `Could not load chart data (${e instanceof Error ? e.message : "unknown error"}).`
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
  }, [graphShellOpen, graphReloadTrigger, workoutClient]);

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
    setEditingWorkout(null);
    setIsOpen(true);
  }

  function openModalForSummaryItem(mappedItem) {
    if (openModalInFlight.current) return;
    setIsSubmitting(false);
    setSubmitError("");
    // Fresh edit session → clear any previous "dirty" flag so opening-and-closing without drops won't refetch.
    draftDirtyRef.current = false;
    const { draftLines: d, exerciseMeta: m } = mapSummaryItemToDraft(mappedItem);
    setDraftLines(d);
    setExerciseMeta(m);
    setEditingWorkout({
      id: mappedItem.id,
      dateLabel: formatWorkoutDate(mappedItem.workoutDate),
    });
    setIsOpen(true);
  }

  function closeModal() {
    // Remember intent before clearing state: if any drop persisted, summary list is stale and must reload.
    const shouldRefreshSummary = draftDirtyRef.current;
    draftDirtyRef.current = false;
    setIsOpen(false);
    setIsSubmitting(false);
    setSubmitError("");
    setEditingWorkout(null);
    if (shouldRefreshSummary) {
      // Fire-and-forget; a transient fetch error surfaces via templateLoadError without blocking close.
      refreshWorkoutsFromServer().catch((e) => {
        setTemplateLoadError(
          `Zmiany zapisane, ale lista nie odświeżyła się (${e instanceof Error ? e.message : "unknown error"}).`
        );
      });
      if (graphShellOpen) {
        setGraphReloadTrigger((v) => v + 1);
      }
    }
  }

  /**
   * Builds a {@link WorkoutSubmitRequest} from the given draft lines.
   *
   * The optional {@code metaOverride} lets callers that just mutated state (add/remove) hand in the
   * freshly computed meta map — otherwise we'd read a stale closure here and lose the new row's
   * weight/reps on the first autosave request.
   */
  function buildSubmitRequestFromLines(lines, metaOverride) {
    const meta = metaOverride || exerciseMeta;
    const request = new WorkoutSubmitRequest();
    request.exercises = lines.map((line) => {
      const row = new WorkoutExercise();
      row.bodyPartName = BODY_PART_API_NAME[line.group] || String(line.group).toLowerCase();
      row.name = line.name;
      row.exerciseId = line.exerciseId != null ? line.exerciseId : null;
      row.weight = parseWeightForApi(meta[line.id]?.weight);
      row.reps = parseRepsIntForApi(meta[line.id]?.reps || "");
      row.status = line.status ?? "PLANNED";
      return row;
    });
    return request;
  }

  /**
   * Autosave: every structural change inside the modal (drop, add, remove) snapshots the workout to the server.
   *
   * Mode routing:
   *   - edit mode  (editingWorkout set) → PUT /workout/{id}
   *   - compose mode (no editingWorkout) → POST /workout on the first call, then transition to edit mode
   *     using the returned id so subsequent calls become PUTs instead of repeatedly replacing today's rows.
   *
   * Persists are best-effort snapshots (no reps/weight validation) — kept that way so interim states don't
   * block the UI. Surface failures via {@link submitError} without rolling back local state.
   */
  const persistDraftAfterDrop = useCallback(
    (nextLines, nextMeta) => {
      if (!Array.isArray(nextLines)) return;
      // Empty draft → nothing to create, and wiping an existing workout is out of scope of autosave.
      if (nextLines.length === 0) return;

      const request = buildSubmitRequestFromLines(nextLines, nextMeta);

      // Fire-and-forget on purpose — don't block the UI; surface errors via a non-blocking state update.
      (async () => {
        try {
          const res = editingWorkout
            ? await workoutClient.putWorkout(editingWorkout.id, request)
            : await workoutClient.postWorkouts(request);
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(text || `HTTP ${res.status}`);
          }

          // Compose → edit transition: pick up the created workout's id so the next autosave PUTs instead
          // of POSTing again (BE would otherwise delete+replace today's sets on each call).
          if (!editingWorkout) {
            const created = await res.json().catch(() => null);
            if (created?.id != null) {
              setEditingWorkout({
                id: created.id,
                dateLabel: formatWorkoutDate(created.workoutDate),
              });
            }
          }

          // Mark the session as dirty so closing the modal triggers a summary-list refresh.
          draftDirtyRef.current = true;
          setSubmitError("");
        } catch (e) {
          setSubmitError(
            `Nie udało się zapisać zmian (${e instanceof Error ? e.message : "unknown error"}).`
          );
        }
      })();
    },
    // buildSubmitRequestFromLines is closed over exerciseMeta/editingWorkout — list both so stale closures don't slip in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingWorkout, workoutClient, exerciseMeta]
  );

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div>
            <div className="title">Brogress</div>
          </div>
        </div>
        <div className="header-actions">
          {typeof onLogout === "function" ? (
            <button className="btn" type="button" onClick={onLogout}>
              Log out
            </button>
          ) : null}
          <button
            className={`btn${graphShellOpen ? " btn-toggle-on" : ""}`}
            type="button"
            aria-pressed={graphShellOpen}
            aria-label={graphShellOpen ? "Back to workout list" : "Show current series chart"}
            onClick={() =>
              setGraphShellOpen((v) => {
                const next = !v;
                // Session replay often replays SVG charts (Recharts) poorly; this event marks the toggle in PostHog.
                if (import.meta.env.VITE_POSTHOG_KEY) {
                  posthog.capture("brogress_shell_view", {
                    view: next ? "graph_series" : "workout_list",
                  });
                }
                return next;
              })
            }
          >
            Your Brogress
          </button>
          <button className="btn primary" type="button" onClick={openModal}>
            Add exercise
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
            onSelectWorkout={openModalForSummaryItem}
          />
        )}
      </section>

      {isOpen ? (
        <WorkoutModal
          loadExercisePicker={loadExercisePicker}
          createUserExercise={createUserExercise}
          draftLines={draftLines}
          setDraftLines={setDraftLines}
          exerciseMeta={exerciseMeta}
          setExerciseMeta={setExerciseMeta}
          isSubmitting={isSubmitting}
          submitError={submitError}
          onClose={closeModal}
          onDraftPersist={persistDraftAfterDrop}
          modalKicker={editingWorkout ? "Edit workout" : "Add workout"}
          modalKickerDetail={editingWorkout?.dateLabel ?? ""}
        />
      ) : null}
    </main>
  );
}
