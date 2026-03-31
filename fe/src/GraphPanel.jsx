import React, { useMemo, useState } from "react";
import { VolumeChart } from "./VolumeChart.jsx";
import { formatWorkoutDate } from "./workoutHelpers.js";

export function GraphPanel({ volumePoints, volumeError, volumeLoading }) {
  const [sortDir, setSortDir] = useState("desc");

  const chartData = useMemo(
    () =>
      volumePoints.map((p) => ({
        day: p.workoutDay,
        volume: Number(p.volume),
      })),
    [volumePoints]
  );

  const sortedPoints = useMemo(() => {
    if (!sortDir) return volumePoints;
    return [...volumePoints].sort((a, b) => {
      const da = a.workoutDay || "";
      const db = b.workoutDay || "";
      const cmp = da < db ? -1 : da > db ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [volumePoints, sortDir]);

  function toggleSort() {
    setSortDir((prev) => {
      if (prev === null) return "asc";
      if (prev === "asc") return "desc";
      return null;
    });
  }

  return (
    <div className="panel graph-shell-panel">
      <div className="panel-head">
        <h2 className="panel-title">Current series</h2>
      </div>
      {volumeError ? <div className="errorText graph-shell-status">{volumeError}</div> : null}
      {volumeLoading ? (
        <div className="graph-shell" aria-busy="true" aria-label="Loading chart data">
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
          <p className="graph-shell-loading">Loading…</p>
        </div>
      ) : (
        <div className="graph-volume-body" aria-live="polite">
          {volumePoints.length === 0 && !volumeError ? (
            <div className="empty graph-shell-empty">No data points in the current series.</div>
          ) : null}
          {volumePoints.length > 0 ? (
            <>
              <div
                className="volume-chart-region"
                role="img"
                aria-label="Line chart of training volume by workout day"
              >
                <VolumeChart data={chartData} formatDayLabel={formatWorkoutDate} />
              </div>
              <div className="graph-volume-table-wrap graph-volume-table-wrap--below">
                <table className="graph-volume-table">
                  <thead>
                  <tr>
                    <th
                        scope="col"
                        role="button"
                        tabIndex={0}
                        aria-sort={
                          sortDir === "asc"
                              ? "ascending"
                              : sortDir === "desc"
                                  ? "descending"
                                  : "none"
                        }
                        onClick={toggleSort}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSort();
                          }
                        }}
                        style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      Day{" "}
                      <span aria-hidden="true">
                              {sortDir === "asc"
                                  ? "▲"
                                  : sortDir === "desc"
                                      ? "▼"
                                      : "⇅"}
                            </span>
                    </th>
                    <th scope="col" className="graph-volume-col-num">
                      Volume
                    </th>
                  </tr>
                  </thead>
                  <tbody>
                  {sortedPoints.map((row) => (
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
  );
}
