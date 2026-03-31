import React from "react";
import { formatWorkoutDate, rowStatusModifier } from "./workoutHelpers.js";

export function WorkoutListPanel({ items, loadError }) {
  return (
    <div className="panel">
      <div className="template" aria-live="polite">
        {loadError ? <div className="errorText">{loadError}</div> : null}
        {items.length === 0 && !loadError ? (
          <div className="empty">
            Nothing here yet. Click <span className="pill">Add exercise</span>.
          </div>
        ) : null}
        {items.map((item) => (
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
  );
}
