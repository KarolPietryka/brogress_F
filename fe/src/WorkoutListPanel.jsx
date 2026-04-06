import React, { useEffect, useState } from "react";
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
    <div className={`workoutRow workoutRow--${rowStatusModifier(row.status)}`}>
      <span className="workoutRowGroup">{row.group}</span>
      <span className="workoutRowName">{row.name}</span>
      <span className="workoutRowStats" aria-label="Weight and reps">
        {row.reps ? `${row.weight || "0"} × ${row.reps}` : "—"}
      </span>
    </div>
  );
}

export function WorkoutListPanel({ items, loadError }) {
  const gridCols = useSummaryGridColumns();
  const [expandedHistoricalIds, setExpandedHistoricalIds] = useState(() => new Set());

  function toggleHistoricalExpanded(id) {
    setExpandedHistoricalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="panel">
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
          const maxSlots = Math.max(1, gridCols - 1);
          const hasOverflow = rows.length > maxSlots;
          const visibleCount = hasOverflow ? maxSlots : rows.length;
          const visibleRows = rows.slice(0, visibleCount);

          return (
            <div className="card" key={item.id}>
              <div className="card-top">
                <div className="card-title">{formatWorkoutDate(item.workoutDate)}</div>
                {!isLatest && expanded ? (
                  <button
                    type="button"
                    className="workoutSummaryCollapse"
                    onClick={() => toggleHistoricalExpanded(item.id)}
                  >
                    Collapse
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <div className="workoutRows">
                  {rows.map((row, idx) => (
                    <WorkoutRowTile key={`${item.id}-${idx}`} row={row} />
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="workoutSummaryCollapsedHit"
                  onClick={() => toggleHistoricalExpanded(item.id)}
                  aria-expanded="false"
                  aria-label={`Show full workout summary for ${formatWorkoutDate(item.workoutDate)}`}
                >
                  <div
                    className="workoutRows workoutRows--collapsed"
                    style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                  >
                    {visibleRows.map((row, idx) => (
                      <WorkoutRowTile key={`${item.id}-c-${idx}`} row={row} />
                    ))}
                    {hasOverflow ? (
                      <div className="workoutRow workoutRow--more" aria-hidden>
                        <span className="workoutRowMoreDots">...</span>
                      </div>
                    ) : null}
                  </div>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
