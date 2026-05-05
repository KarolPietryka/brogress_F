import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ComposerPickListPortal } from "./ComposerPickList.jsx";
import { BODY_PART_API_NAME, MUSCLE_GROUPS } from "./workoutData.js";
import { formatWorkoutDate } from "./workoutHelpers.js";
import { ExerciseSeriesChart } from "./ExerciseSeriesChart.jsx";

function parseOptionalInt(s) {
  const t = String(s ?? "").trim();
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalDecimal(s) {
  const t = String(s ?? "").trim();
  if (!t) return undefined;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function emptyToUndefined(s) {
  const t = String(s ?? "").trim();
  return t === "" ? undefined : t;
}

/**
 * Charts tab: filters + Search → POST exercise-series; muscle/exercise pickers reuse the same
 * {@link ComposerPickListPortal} + {@code composerPickTrigger} pattern as the workout sticky row.
 */
export function ExerciseSeriesChartPanel({ workoutClient, loadExercisePicker, createUserExercise }) {
  const [chartGroup, setChartGroup] = useState(() => MUSCLE_GROUPS[0] || "");
  const [pickerCatalog, setPickerCatalog] = useState([]);
  const [pickerCustom, setPickerCustom] = useState([]);
  const [pickerReady, setPickerReady] = useState(false);
  const [pickerLoadError, setPickerLoadError] = useState("");
  const [selectedExerciseId, setSelectedExerciseId] = useState(null);
  const [selectedExerciseLabel, setSelectedExerciseLabel] = useState("");
  const [chartPickOpen, setChartPickOpen] = useState(null);
  const groupPickAnchorRef = useRef(null);
  const exercisePickAnchorRef = useRef(null);

  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [addCustomName, setAddCustomName] = useState("");
  const [addCustomError, setAddCustomError] = useState("");
  const [addCustomSubmitting, setAddCustomSubmitting] = useState(false);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [repMin, setRepMin] = useState("");
  const [repMax, setRepMax] = useState("");
  const [weightMin, setWeightMin] = useState("");
  const [weightMax, setWeightMax] = useState("");
  const [seriesPoints, setSeriesPoints] = useState([]);
  const [seriesError, setSeriesError] = useState("");
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const apiPart = BODY_PART_API_NAME[chartGroup] || String(chartGroup).toLowerCase();
    setPickerReady(false);
    setPickerLoadError("");
    setSelectedExerciseId(null);
    setSelectedExerciseLabel("");
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
  }, [chartGroup, loadExercisePicker]);

  const chartExercisePickItems = useMemo(() => {
    const addNew = { key: "__add_custom__", label: "Dodaj własne…" };
    if (!pickerReady) {
      return [{ key: "__loading__", label: "Ładowanie…", disabled: true }, addNew];
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

  const chartData = useMemo(
    () =>
      seriesPoints.map((p) => ({
        day: p.workoutDay,
        totalWeight: Number(p.totalWeight),
        totalReps: Number(p.totalReps),
      })),
    [seriesPoints]
  );

  async function submitAddCustom() {
    const name = addCustomName.trim();
    if (!name) {
      setAddCustomError("Podaj nazwę ćwiczenia.");
      return;
    }
    const apiPart = BODY_PART_API_NAME[chartGroup] || String(chartGroup).toLowerCase();
    setAddCustomSubmitting(true);
    setAddCustomError("");
    try {
      const created = await createUserExercise(apiPart, name);
      const data = await loadExercisePicker(apiPart);
      setPickerCatalog(Array.isArray(data?.catalog) ? data.catalog : []);
      setPickerCustom(Array.isArray(data?.custom) ? data.custom : []);
      setPickerReady(true);
      setAddCustomOpen(false);
      setAddCustomName("");
      if (created?.id != null) {
        setSelectedExerciseId(created.id);
        setSelectedExerciseLabel(created.name || name);
      }
    } catch (e) {
      setAddCustomError(e instanceof Error ? e.message : "Nie udało się zapisać.");
    } finally {
      setAddCustomSubmitting(false);
    }
  }

  async function handleSearch() {
    setSeriesError("");
    if (selectedExerciseId == null || !Number.isFinite(Number(selectedExerciseId))) {
      setSeriesError("Wybierz ćwiczenie z listy.");
      return;
    }

    const body = {
      exerciseId: Number(selectedExerciseId),
      fromDate: emptyToUndefined(fromDate),
      toDate: emptyToUndefined(toDate),
      repMin: parseOptionalInt(repMin),
      repMax: parseOptionalInt(repMax),
      weightMin: parseOptionalDecimal(weightMin),
      weightMax: parseOptionalDecimal(weightMax),
    };

    setSeriesLoading(true);
    setHasSearched(true);
    try {
      const res = await workoutClient.postExerciseSeriesChart(body);
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        let msg = text || `HTTP ${res.status}`;
        try {
          const j = text ? JSON.parse(text) : null;
          if (j && typeof j.message === "string" && j.message) {
            msg = j.message;
          }
        } catch {
          /* keep raw body */
        }
        setSeriesError(msg);
        setSeriesPoints([]);
        return;
      }
      let data;
      try {
        data = text ? JSON.parse(text) : [];
      } catch {
        setSeriesError("Niepoprawna odpowiedź serwera.");
        setSeriesPoints([]);
        return;
      }
      setSeriesPoints(Array.isArray(data) ? data : []);
      setSeriesError("");
    } catch (e) {
      setSeriesError(e instanceof Error ? e.message : "unknown error");
      setSeriesPoints([]);
    } finally {
      setSeriesLoading(false);
    }
  }

  return (
    <>
      <ComposerPickListPortal
        open={chartPickOpen === "group"}
        title="Partia"
        items={MUSCLE_GROUPS}
        anchorRef={groupPickAnchorRef}
        onClose={() => setChartPickOpen(null)}
        onPick={(g) => {
          setChartGroup(g);
          setSelectedExerciseId(null);
          setSelectedExerciseLabel("");
        }}
      />
      <ComposerPickListPortal
        open={chartPickOpen === "exercise"}
        title="Ćwiczenie"
        items={chartExercisePickItems}
        anchorRef={exercisePickAnchorRef}
        onClose={() => setChartPickOpen(null)}
        onPick={(item) => {
          if (typeof item === "string") {
            setSelectedExerciseLabel(item);
            setSelectedExerciseId(null);
            return;
          }
          if (item.key === "__add_custom__") {
            setAddCustomOpen(true);
            setAddCustomName("");
            setAddCustomError("");
            return;
          }
          setSelectedExerciseLabel(item.label);
          setSelectedExerciseId(item.exerciseId != null ? item.exerciseId : null);
        }}
      />
      {addCustomOpen
        ? createPortal(
            <div className="pickList-root pickList-root--centered" role="presentation">
              <button
                type="button"
                className="pickList-backdrop"
                aria-label="Zamknij"
                disabled={addCustomSubmitting}
                onClick={() => !addCustomSubmitting && setAddCustomOpen(false)}
              />
              <div
                className="pickList-panel pickList-panel--dialog"
                role="dialog"
                aria-label="Własne ćwiczenie"
                onClick={(e) => e.stopPropagation()}
              >
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
                        void submitAddCustom();
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
                      onClick={() => void submitAddCustom()}
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

      <div className="panel graph-shell-panel exercise-series-panel">
        <div className="panel-head">
          <h2 className="panel-title">Seria ćwiczenia</h2>
          <p className="panel-hint">
            Suma wagi i powtórzeń po dniu treningu (tylko wykonane serie). Dane po kliknięciu Szukaj.
          </p>
        </div>
        <div className="exercise-series-layout">
          <aside className="exercise-series-filters" aria-label="Filtry wykresu">
            <label className="exercise-series-field">
              <span className="exercise-series-label">Data od</span>
              <input className="exercise-series-control" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label className="exercise-series-field">
              <span className="exercise-series-label">Data do</span>
              <input className="exercise-series-control" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <label className="exercise-series-field">
              <span className="exercise-series-label">Powtórzenia min</span>
              <input
                className="exercise-series-control"
                type="number"
                inputMode="numeric"
                value={repMin}
                onChange={(e) => setRepMin(e.target.value)}
              />
            </label>
            <label className="exercise-series-field">
              <span className="exercise-series-label">Powtórzenia max</span>
              <input
                className="exercise-series-control"
                type="number"
                inputMode="numeric"
                value={repMax}
                onChange={(e) => setRepMax(e.target.value)}
              />
            </label>
            <label className="exercise-series-field">
              <span className="exercise-series-label">Waga min</span>
              <input
                className="exercise-series-control"
                type="number"
                inputMode="decimal"
                value={weightMin}
                onChange={(e) => setWeightMin(e.target.value)}
              />
            </label>
            <label className="exercise-series-field">
              <span className="exercise-series-label">Waga max</span>
              <input
                className="exercise-series-control"
                type="number"
                inputMode="decimal"
                value={weightMax}
                onChange={(e) => setWeightMax(e.target.value)}
              />
            </label>
            <button type="button" className="btn exercise-series-search" onClick={() => void handleSearch()}>
              Szukaj
            </button>
          </aside>
          <div className="exercise-series-main">
            <div className="exercise-series-picks-above-chart" aria-label="Partia i ćwiczenie">
              <div className="exercise-series-field">
                <span className="exercise-series-label">Partia i ćwiczenie</span>
                <div className="exercise-series-composer-row exercise-series-composer-row--above-chart">
                  <button
                    ref={groupPickAnchorRef}
                    type="button"
                    className="composerPickTrigger composerPickTrigger--group exercise-series-pick-wide"
                    aria-label="Partia"
                    aria-haspopup="listbox"
                    aria-expanded={chartPickOpen === "group"}
                    onClick={() => setChartPickOpen((p) => (p === "group" ? null : "group"))}
                  >
                    <span className="composerPickTrigger__text">{chartGroup}</span>
                  </button>
                  <button
                    ref={exercisePickAnchorRef}
                    type="button"
                    className="composerPickTrigger composerPickTrigger--exercise exercise-series-pick-wide"
                    aria-label="Ćwiczenie"
                    aria-haspopup="listbox"
                    aria-expanded={chartPickOpen === "exercise"}
                    disabled={!pickerReady}
                    onClick={() => setChartPickOpen((p) => (p === "exercise" ? null : "exercise"))}
                  >
                    <span className="composerPickTrigger__text composerPickTrigger__text--ellipsis">
                      {!pickerReady
                        ? "Ładowanie…"
                        : selectedExerciseLabel || "— wybierz —"}
                    </span>
                  </button>
                </div>
              </div>
              {pickerLoadError ? (
                <div className="errorText exercise-series-picker-err">Lista ćwiczeń: {pickerLoadError}</div>
              ) : null}
            </div>
            <div className="exercise-series-chart-area">
              {seriesError ? <div className="errorText graph-shell-status">{seriesError}</div> : null}
              {seriesLoading ? (
                <p className="graph-shell-loading" aria-busy="true">
                  Ładowanie…
                </p>
              ) : null}
              {!seriesLoading && !seriesError && !hasSearched ? (
                <div className="empty graph-shell-empty">Wybierz ćwiczenie i ewentualne filtry, potem kliknij Szukaj.</div>
              ) : null}
              {!seriesLoading && hasSearched && !seriesError && seriesPoints.length === 0 ? (
                <div className="empty graph-shell-empty">Brak punktów dla podanych filtrów.</div>
              ) : null}
              {!seriesLoading && seriesPoints.length > 0 ? (
                <div className="volume-chart-region" role="img" aria-label="Wykres wagi i powtórzeń po dniu">
                  <ExerciseSeriesChart data={chartData} formatDayLabel={formatWorkoutDate} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
