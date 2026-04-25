import React, { useEffect, useState } from "react";
import { HomePickCarousel } from "./HomePickCarousel.jsx";
import { formatWorkoutDate, rowStatusModifier } from "./workoutHelpers.js";

/** Match .workoutRows breakpoints so one row matches visible column count. */
function useSummaryGridColumns() {
  const [cols, setCols] = useState(6);
  useEffect(() => {
    const m520 = window.matchMedia("(max-width: 520px)");
    const m900 = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      if (m520.matches) setCols(2);
      else if (m900.matches) setCols(3);
      else setCols(6);
    };
    sync();
    m520.addEventListener("change", sync);
    m900.addEventListener("change", sync);
    return () => {
      m520.removeEventListener("change", sync);
      m900.removeEventListener("change", sync);
    };
  }, []);
  return cols;
}

function WorkoutRowTile({ row }) {
  return (
    <div className={`workoutRow workoutRow--${rowStatusModifier(row)}`}>
      <span className="workoutRowGroup">{row.group}</span>
      <span className="workoutRowName">{row.name}</span>
      <span className="workoutRowStats" aria-label="Weight and reps">
        {row.reps ? `${row.weight || "0"} × ${row.reps}` : "—"}
      </span>
    </div>
  );
}

export function WorkoutListPanel({ items, loadError, onSelectWorkout }) {
  const gridCols = useSummaryGridColumns();
  const [expandedHistoricalIds, setExpandedHistoricalIds] = useState(() => new Set());
  const selectable = typeof onSelectWorkout === "function";

  function toggleHistoricalExpanded(id) {
    setExpandedHistoricalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function editKeyDown(e, item) {
    if (!selectable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectWorkout(item);
    }
  }

  function expandKeyDown(e, id) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleHistoricalExpanded(id);
    }
  }

  return (
    <div className="panel panel--withCarousel">
      <HomePickCarousel />
      <div className="template" aria-live="polite">
        {loadError ? <div className="errorText">{loadError}</div> : null}
        {items.length === 0 && !loadError ? (
          <div className="empty">
            Nothing here yet. Click <span className="pill">Add exercise</span>.
          </div>
        ) : null}
        {items.map((item, index) => {
          const isLatest = index === 0;
          const expanded = isLatest || expandedHistoricalIds.has(item.id);
          const rows = item.rows || [];
          const dateLabel = formatWorkoutDate(item.workoutDate);
          const maxSlots = Math.max(1, gridCols - 1);
          const hasOverflow = rows.length > maxSlots;
          const visibleCount = hasOverflow ? maxSlots : rows.length;
          const visibleRows = rows.slice(0, visibleCount);

          // Latest session: one tap opens the same modal as Add exercise.
          if (isLatest) {
            return (
              <div
                className={`card${selectable ? " card--selectable" : ""}`}
                key={item.id}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-label={selectable ? `Open workout editor for ${dateLabel}` : undefined}
                onClick={selectable ? () => onSelectWorkout(item) : undefined}
                onKeyDown={selectable ? (e) => editKeyDown(e, item) : undefined}
              >
                <div className="card-top">
                  <div className="card-title">{dateLabel}</div>
                </div>
                <div className="workoutRows">
                  {rows.map((row, idx) => (
                    <WorkoutRowTile key={`${item.id}-${idx}`} row={row} />
                  ))}
                </div>
              </div>
            );
          }

          // Older sessions: if "…" overflow tile is shown while collapsed, first tap expands; then tap opens editor.
          // When everything fits the preview grid, one tap opens the editor (no expand step needed).
          if (!expanded && !hasOverflow) {
            return (
              <div
                className={`card${selectable ? " card--selectable" : ""}`}
                key={item.id}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-label={selectable ? `Open workout editor for ${dateLabel}` : undefined}
                onClick={selectable ? () => onSelectWorkout(item) : undefined}
                onKeyDown={selectable ? (e) => editKeyDown(e, item) : undefined}
              >
                <div className="card-top">
                  <div className="card-title">{dateLabel}</div>
                </div>
                <div
                  className="workoutRows workoutRows--collapsed"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                >
                  {rows.map((row, idx) => (
                    <WorkoutRowTile key={`${item.id}-${idx}`} row={row} />
                  ))}
                </div>
              </div>
            );
          }

          if (!expanded) {
            return (
              <div
                className="card card--expandCollapsed"
                key={item.id}
                role="button"
                tabIndex={0}
                aria-expanded="false"
                aria-label={`Expand workout summary for ${dateLabel}`}
                onClick={() => toggleHistoricalExpanded(item.id)}
                onKeyDown={(e) => expandKeyDown(e, item.id)}
              >
                <div className="card-top">
                  <div className="card-title">{dateLabel}</div>
                </div>
                <div className="workoutSummaryCollapsedHit workoutSummaryCollapsedHit--static">
                  <div
                    className="workoutRows workoutRows--collapsed"
                    style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                  >
                    {visibleRows.map((row, idx) => (
                      <WorkoutRowTile key={`${item.id}-c-${idx}`} row={row} />
                    ))}
                    <div className="workoutRow workoutRow--more" aria-hidden>
                      <span className="workoutRowMoreDots">...</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              className={`card${selectable ? " card--selectable" : ""}`}
              key={item.id}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              aria-label={selectable ? `Open workout editor for ${dateLabel}` : undefined}
              onClick={selectable ? () => onSelectWorkout(item) : undefined}
              onKeyDown={selectable ? (e) => editKeyDown(e, item) : undefined}
            >
              <div className="card-top">
                <div className="card-title">{dateLabel}</div>
                <button
                  type="button"
                  className="workoutSummaryCollapse"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHistoricalExpanded(item.id);
                  }}
                >
                  Collapse
                </button>
              </div>
              <div className="workoutRows">
                {rows.map((row, idx) => (
                  <WorkoutRowTile key={`${item.id}-${idx}`} row={row} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
