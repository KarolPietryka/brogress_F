import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import { WorkoutClient } from "./workoutClient.js";
import { BODY_PART_API_NAME } from "./workoutData.js";
import { WorkoutExercise, WorkoutSubmitRequest } from "./model/workoutRequest.js";
import {
  mapServerWorkout,
  mapPrefillToDraft,
  filterRecentPlanTemplatesWithSnapshots,
  mapSummaryItemToDraft,
  formatWorkoutDate,
  parseRepsIntForApi,
  parseWeightForApi,
} from "./workoutHelpers.js";
import { GraphPanel } from "./GraphPanel.jsx";
import { WorkoutListPanel } from "./WorkoutListPanel.jsx";
import { WorkoutEditor } from "./WorkoutEditor.jsx";
import { WorkoutModal } from "./WorkoutModal.jsx";

function calendarTodayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True when {@code GET /workout} summary list already has a row for the calendar “today” (YMD prefix match on {@code workoutDate}). */
function listHasWorkoutForToday(items) {
  const ymd = calendarTodayYmd();
  return items.some((it) => String(it.workoutDate).slice(0, 10) === ymd);
}

/** Server id for today’s workout row (for delete), or null — use when prefill loaded an existing today session but {@code todayEditingWorkout} was never set. */
function todayWorkoutIdFromSummaryList(items) {
  const ymd = calendarTodayYmd();
  const row = Array.isArray(items) ? items.find((it) => String(it.workoutDate).slice(0, 10) === ymd) : null;
  return row?.id != null ? row.id : null;
}

/**
 * Three views share one shell:
 *   "today"   — inline {@link WorkoutEditor} for the current day's workout (default after login).
 *   "history" — summary list; clicking a row opens {@link WorkoutModal} with that workout.
 *   "chart"   — aggregate volume chart.
 *
 * Today and the History popup hold independent draft/meta/editingWorkout state so edits to an
 * older workout inside the popup don't clobber whatever the user is composing for today.
 */
export function BrogressWorkspace({ authToken, onAuthLost, onLogout }) {
  const workoutClient = useMemo(
    () =>
      new WorkoutClient({
        getToken: () => authToken,
        onUnauthorized: () => onAuthLost?.(),
      }),
    [authToken, onAuthLost]
  );

  /** Which top-level view is visible. Changes are user-driven (header tabs) or implicit on mount. */
  const [view, setView] = useState("today");

  // --- Today state ---------------------------------------------------------
  // Prefill fires once per mount (per login); subsequent interactions just mutate the draft.
  const todayPrefillInFlightRef = useRef(false);
  const [todayDraftLines, setTodayDraftLines] = useState([]);
  const [todayExerciseMeta, setTodayExerciseMeta] = useState(() => ({}));
  const [todayEditingWorkout, setTodayEditingWorkout] = useState(null);
  const [todaySubmitError, setTodaySubmitError] = useState("");
  /** Flips to true on first persisted drop so switching to History refreshes the list. */
  const todayDirtyRef = useRef(false);

  // --- History popup state -------------------------------------------------
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyDraftLines, setHistoryDraftLines] = useState([]);
  const [historyExerciseMeta, setHistoryExerciseMeta] = useState(() => ({}));
  const [historyEditingWorkout, setHistoryEditingWorkout] = useState(null);
  const [historySubmitError, setHistorySubmitError] = useState("");
  const historyDirtyRef = useRef(false);

  // --- Summary list & chart -----------------------------------------------
  const [templateItems, setTemplateItems] = useState([]);
  const [templateLoadError, setTemplateLoadError] = useState("");
  const [graphVolumePoints, setGraphVolumePoints] = useState([]);
  const [graphVolumeError, setGraphVolumeError] = useState("");
  const [graphVolumeLoading, setGraphVolumeLoading] = useState(false);
  const [graphReloadTrigger, setGraphReloadTrigger] = useState(0);

  const [planTemplates, setPlanTemplates] = useState([]);
  const [planTemplatesError, setPlanTemplatesError] = useState("");

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

  const loadPlanTemplates = useCallback(async () => {
    try {
      const res = await workoutClient.getRecentPlanTemplates();
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setPlanTemplatesError(text || `HTTP ${res.status}`);
        setPlanTemplates([]);
        return;
      }
      const data = await res.json();
      setPlanTemplates(filterRecentPlanTemplatesWithSnapshots(Array.isArray(data) ? data : []));
      setPlanTemplatesError("");
    } catch (e) {
      setPlanTemplatesError(e instanceof Error ? e.message : "unknown error");
      setPlanTemplates([]);
    }
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
    // Initial summary fetch: needed so History view has data the moment the user switches.
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
    void loadPlanTemplates();
  }, [loadPlanTemplates]);

  useEffect(() => {
    // Today editor seed: fetch the prefill once per mount so the user lands straight into the
    // current day's draft (no "Add exercise" click, no popup). Failures fall back to an empty draft.
    //
    // The {@code todayPrefillInFlightRef} guard (ref survives StrictMode's simulated
    // unmount/remount in dev) prevents a duplicate request. We intentionally do NOT use a
    // {@code cancelled} flag here — it would race with the ref under StrictMode: the first
    // effect's cleanup would flip the flag and drop the in-flight response, while the second
    // effect would skip the refetch because the ref is already set.
    if (todayPrefillInFlightRef.current) return;
    todayPrefillInFlightRef.current = true;
    (async () => {
      try {
        const res = await workoutClient.prefillWorkout();
        if (!res.ok) return;
        const data = await res.json();
        const { draftLines, exerciseMeta } = mapPrefillToDraft(data);
        setTodayDraftLines(draftLines);
        setTodayExerciseMeta(exerciseMeta);
      } catch {
        /* Keep the empty draft; Today view will just show the composer. */
      }
    })();
  }, [workoutClient]);

  useEffect(() => {
    // Chart data is fetched lazily — only when the chart view is active — and re-fetched whenever
    // a modal persist flips the reload trigger so the chart stays in sync with the list.
    if (view !== "chart") return undefined;
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
  }, [view, graphReloadTrigger, workoutClient]);

  /**
   * Builds a {@link WorkoutSubmitRequest} from the given draft lines.
   *
   * Requires {@code meta} (not the closed-over state) so callers that just mutated their meta map
   * (add/remove) can hand in the fresh snapshot without races.
   */
  function buildSubmitRequestFromLines(lines, meta) {
    const request = new WorkoutSubmitRequest();
    request.exercises = lines.map((line) => {
      const row = new WorkoutExercise();
      row.bodyPartName = BODY_PART_API_NAME[line.group] || String(line.group).toLowerCase();
      row.name = line.name;
      row.exerciseId = line.exerciseId != null ? line.exerciseId : null;
      const metaRow = meta?.[line.id];
      row.weight = parseWeightForApi(metaRow?.weight);
      row.reps = parseRepsIntForApi(metaRow?.reps || "");
      row.status = line.status ?? "PLANNED";
      return row;
    });
    return request;
  }

  /**
   * Shared persist pipeline: POST when no workout exists yet, PUT when one does. The channel
   * passed in decides which set of state setters to update (Today vs History popup) so the two
   * editors never race or overwrite each other's editing target.
   */
  const persistDraft = useCallback(
    (channel, nextLines, nextMetaArg) => {
      if (!Array.isArray(nextLines)) return;
      // Empty draft → nothing to create, and wiping an existing workout is out of scope of autosave.
      if (nextLines.length === 0) return;

      const isToday = channel === "today";
      const editing = isToday ? todayEditingWorkout : historyEditingWorkout;
      const nextMeta = nextMetaArg || (isToday ? todayExerciseMeta : historyExerciseMeta);

      const request = buildSubmitRequestFromLines(nextLines, nextMeta);

      (async () => {
        try {
          const res = editing
            ? await workoutClient.putWorkout(editing.id, request)
            : await workoutClient.postWorkouts(request);
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(text || `HTTP ${res.status}`);
          }

          // Compose → edit transition: pick up the created workout's id so the next autosave PUTs
          // instead of POSTing again (BE would otherwise delete+replace today's sets every call).
          if (!editing) {
            const created = await res.json().catch(() => null);
            if (created?.id != null) {
              const target = {
                id: created.id,
                dateLabel: formatWorkoutDate(created.workoutDate),
              };
              if (isToday) setTodayEditingWorkout(target);
              else setHistoryEditingWorkout(target);
              if (isToday) {
                refreshWorkoutsFromServer().catch(() => {});
              }
            }
          }

          if (isToday) {
            todayDirtyRef.current = true;
            setTodaySubmitError("");
          } else {
            historyDirtyRef.current = true;
            setHistorySubmitError("");
          }
        } catch (e) {
          const msg = `Nie udało się zapisać zmian (${e instanceof Error ? e.message : "unknown error"}).`;
          if (isToday) setTodaySubmitError(msg);
          else setHistorySubmitError(msg);
        }
      })();
    },
    // Explicit deps so stale closures don't slip in; build helper is pure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayEditingWorkout, historyEditingWorkout, todayExerciseMeta, historyExerciseMeta, workoutClient, refreshWorkoutsFromServer]
  );

  const persistTodayDraft = useCallback(
    (nextLines, nextMeta) => persistDraft("today", nextLines, nextMeta),
    [persistDraft]
  );

  const persistHistoryDraft = useCallback(
    (nextLines, nextMeta) => persistDraft("history", nextLines, nextMeta),
    [persistDraft]
  );

  /** Carousel swipe: in-memory {@code bodyPart} from list payload only — no prefill HTTP. */
  const applyPlanFromCarousel = useCallback((plan) => {
    const { draftLines, exerciseMeta } = mapPrefillToDraft({ bodyPart: plan?.bodyPart });
    setTodayDraftLines(draftLines);
    setTodayExerciseMeta(exerciseMeta);
  }, []);

  const todayPersistedWorkoutId = useMemo(() => {
    if (todayEditingWorkout?.id != null) return todayEditingWorkout.id;
    return todayWorkoutIdFromSummaryList(templateItems);
  }, [todayEditingWorkout, templateItems]);

  const handleDeleteTodaysWorkout = useCallback(async () => {
    const id = todayPersistedWorkoutId;
    if (id == null) return;
    setTodaySubmitError("");
    const res = await workoutClient.deleteWorkout(id);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      setTodaySubmitError(text || `Nie udało się usunąć treningu (HTTP ${res.status}).`);
      return;
    }
    setTodayEditingWorkout(null);
    try {
      await refreshWorkoutsFromServer();
    } catch (e) {
      setTemplateLoadError(
        `Nie udało się odświeżyć listy (${e instanceof Error ? e.message : "unknown error"}).`
      );
    }
    try {
      const preRes = await workoutClient.prefillWorkout();
      if (preRes.ok) {
        const data = await preRes.json();
        const mapped = mapPrefillToDraft(data);
        setTodayDraftLines(mapped.draftLines);
        setTodayExerciseMeta(mapped.exerciseMeta);
      } else {
        setTodayDraftLines([]);
        setTodayExerciseMeta({});
      }
    } catch {
      setTodayDraftLines([]);
      setTodayExerciseMeta({});
    }
    await loadPlanTemplates();
  }, [todayPersistedWorkoutId, workoutClient, refreshWorkoutsFromServer, loadPlanTemplates]);

  /**
   * Plans-from-history strip: only when there is **no** persisted workout for today in {@code templateItems} (same
   * source as History). If today’s row exists — user is already in “today’s session” — the carousel is hidden.
   * Still show the template error strip if the list call failed, **unless** today already has a workout (then nothing).
   */
  const showPlanCarouselUi = useMemo(() => {
    if (listHasWorkoutForToday(templateItems)) return false;
    return (
      Boolean(planTemplatesError) || (Array.isArray(planTemplates) && planTemplates.length > 0)
    );
  }, [planTemplates, planTemplatesError, templateItems]);

  function openHistoryModal(mappedItem) {
    // Fresh edit session → clear any previous "dirty" flag so opening-and-closing without drops
    // won't refetch the summary.
    historyDirtyRef.current = false;
    setHistorySubmitError("");
    const { draftLines, exerciseMeta } = mapSummaryItemToDraft(mappedItem);
    setHistoryDraftLines(draftLines);
    setHistoryExerciseMeta(exerciseMeta);
    setHistoryEditingWorkout({
      id: mappedItem.id,
      dateLabel: formatWorkoutDate(mappedItem.workoutDate),
    });
    setIsHistoryModalOpen(true);
  }

  function closeHistoryModal() {
    // Remember intent before clearing state: if any drop persisted, summary list is stale.
    const shouldRefresh = historyDirtyRef.current;
    historyDirtyRef.current = false;
    setIsHistoryModalOpen(false);
    setHistoryEditingWorkout(null);
    setHistoryDraftLines([]);
    setHistoryExerciseMeta({});
    setHistorySubmitError("");
    if (shouldRefresh) {
      refreshWorkoutsFromServer().catch((e) => {
        setTemplateLoadError(
          `Zmiany zapisane, ale lista nie odświeżyła się (${e instanceof Error ? e.message : "unknown error"}).`
        );
      });
      if (view === "chart") {
        setGraphReloadTrigger((v) => v + 1);
      }
    }
  }

  function switchView(nextView) {
    if (nextView === view) return;
    // Entering History with a pending today-autosave in flight → refresh so the summary list
    // reflects whatever Today just created/updated on the server.
    if (nextView === "history" && todayDirtyRef.current) {
      todayDirtyRef.current = false;
      refreshWorkoutsFromServer().catch((e) => {
        setTemplateLoadError(
          `Zmiany zapisane, ale lista nie odświeżyła się (${e instanceof Error ? e.message : "unknown error"}).`
        );
      });
    }
    if (nextView === "chart" && todayDirtyRef.current) {
      todayDirtyRef.current = false;
      setGraphReloadTrigger((v) => v + 1);
    }
    setView(nextView);
    if (import.meta.env.VITE_POSTHOG_KEY) {
      // Session replay often replays SVG charts (Recharts) poorly; this event marks the toggle in PostHog.
      posthog.capture("brogress_shell_view", { view: nextView });
    }
  }

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
          <button
            type="button"
            className={`btn${view === "today" ? " btn-toggle-on" : ""}`}
            aria-pressed={view === "today"}
            onClick={() => switchView("today")}
          >
            Today
          </button>
          <button
            type="button"
            className={`btn${view === "history" ? " btn-toggle-on" : ""}`}
            aria-pressed={view === "history"}
            onClick={() => switchView("history")}
          >
            History
          </button>
          <button
            type="button"
            className={`btn${view === "chart" ? " btn-toggle-on" : ""}`}
            aria-pressed={view === "chart"}
            aria-label={view === "chart" ? "Hide current series chart" : "Show current series chart"}
            onClick={() => switchView("chart")}
          >
            Your Brogress
          </button>
          {typeof onLogout === "function" ? (
            <button className="btn" type="button" onClick={onLogout}>
              Log out
            </button>
          ) : null}
        </div>
      </header>

      <section className="content">
        {view === "today" ? (
          // Today card mirrors the popup's modal-card look so the editor body, sticky composer
          // and list all behave identically — just without the backdrop / close button.
          <div className="modal-card todayCard">
            <WorkoutEditor
              loadExercisePicker={loadExercisePicker}
              createUserExercise={createUserExercise}
              draftLines={todayDraftLines}
              setDraftLines={setTodayDraftLines}
              exerciseMeta={todayExerciseMeta}
              setExerciseMeta={setTodayExerciseMeta}
              isSubmitting={false}
              submitError={todaySubmitError}
              onDraftPersist={persistTodayDraft}
              planCarouselTemplates={planTemplates}
              planCarouselError={planTemplatesError}
              showPlanCarousel={showPlanCarouselUi}
              onApplyPlanCarousel={applyPlanFromCarousel}
              showTodaysWorkoutDelete={todayPersistedWorkoutId != null}
              onDeleteTodaysWorkoutRequest={handleDeleteTodaysWorkout}
            />
          </div>
        ) : null}
        {view === "history" ? (
          <WorkoutListPanel
            items={templateItems}
            loadError={templateLoadError}
            onSelectWorkout={openHistoryModal}
          />
        ) : null}
        {view === "chart" ? (
          <GraphPanel
            volumePoints={graphVolumePoints}
            volumeError={graphVolumeError}
            volumeLoading={graphVolumeLoading}
          />
        ) : null}
      </section>

      {isHistoryModalOpen ? (
        <WorkoutModal
          loadExercisePicker={loadExercisePicker}
          createUserExercise={createUserExercise}
          draftLines={historyDraftLines}
          setDraftLines={setHistoryDraftLines}
          exerciseMeta={historyExerciseMeta}
          setExerciseMeta={setHistoryExerciseMeta}
          isSubmitting={false}
          submitError={historySubmitError}
          onClose={closeHistoryModal}
          onDraftPersist={persistHistoryDraft}
          modalKicker="Edit workout"
          modalKickerDetail={historyEditingWorkout?.dateLabel ?? ""}
        />
      ) : null}
    </main>
  );
}
