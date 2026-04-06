import {
  BODY_PART_TO_GROUP_LABEL,
} from "./workoutData.js";

/** BE: {@code status} DONE | PLANNED | NEXT; legacy {@code planned}. */
export function normalizeExerciseStatus(e) {
  const s = e?.status;
  if (s === "PLANNED" || s === "NEXT" || s === "DONE") return s;
  if (e?.planned === true) return "PLANNED";
  return "DONE";
}

/**
 * CSS suffix for row styling. Pass a row-like object ({@code status}, optional legacy {@code planned}) or a bare status string.
 */
export function rowStatusModifier(statusOrRow) {
  const s =
    statusOrRow != null && typeof statusOrRow === "object" && !Array.isArray(statusOrRow)
      ? normalizeExerciseStatus(statusOrRow)
      : normalizeExerciseStatus({ status: statusOrRow });
  if (s === "PLANNED") return "planned";
  if (s === "NEXT") return "next";
  return "done";
}

/**
 * Aligns draft with BE prefill semantics: first PLANNED/NEXT row in list order is NEXT; other plan rows PLANNED; DONE unchanged.
 * Use after add/remove/reorder — not after per-row PLANNED↔NEXT toggle (user may target a non-head row).
 */
export function normalizeDraftPlanHeadNext(lines) {
  if (!lines?.length) return lines;
  const headIndex = lines.findIndex((line) => {
    const s = normalizeExerciseStatus(line);
    return s === "PLANNED" || s === "NEXT";
  });
  if (headIndex < 0) return lines;
  return lines.map((line, i) => {
    const s = normalizeExerciseStatus(line);
    if (s === "DONE") return line;
    const wantNext = i === headIndex;
    if (wantNext) return s === "NEXT" ? line : { ...line, status: "NEXT" };
    return s === "PLANNED" ? line : { ...line, status: "PLANNED" };
  });
}

/**
 * Last PLANNED row (bottom-up): group, name, weight/reps for the “add exercise” composer.
 * When none: plannedRowId/group/name empty/null, weight/reps default.
 */
export function lastPlannedComposerPrefill(draftLines, exerciseMeta) {
  const empty = {
    plannedRowId: "",
    group: null,
    name: null,
    exerciseId: null,
    weight: "0",
    reps: "",
  };
  if (!draftLines?.length) return { ...empty };
  for (let i = draftLines.length - 1; i >= 0; i--) {
    const line = draftLines[i];
    if (normalizeExerciseStatus(line) !== "PLANNED") continue;
    const m = exerciseMeta[line.id] || { weight: "0", reps: "" };
    const w = m.weight != null && String(m.weight) !== "" ? String(m.weight) : "0";
    const r = m.reps != null && String(m.reps) !== "" ? String(m.reps) : "";
    return {
      plannedRowId: line.id,
      group: line.group,
      name: line.name,
      exerciseId: line.exerciseId != null ? line.exerciseId : null,
      weight: w,
      reps: r,
    };
  }
  return { ...empty };
}

/** Weight/reps only — same source as {@link lastPlannedComposerPrefill}. */
export function lastPlannedExerciseMeta(draftLines, exerciseMeta) {
  const p = lastPlannedComposerPrefill(draftLines, exerciseMeta);
  return { weight: p.weight, reps: p.reps };
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
    exerciseId: e.exerciseId != null ? e.exerciseId : undefined,
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
export function mapServerWorkout(w) {
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
export function mapPrefillToDraft(prefill) {
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
    draftLines.push({
      id,
      group,
      name: ex.name,
      exerciseId: ex.exerciseId != null ? ex.exerciseId : undefined,
      status: normalizeExerciseStatus(ex),
    });
    exerciseMeta[id] = {
      weight: prefillWeightField(ex.weight),
      reps: prefillNumberToDigitsField(ex.reps),
    };
  }
  return { draftLines, exerciseMeta };
}

/**
 * Builds modal draft state from a {@link mapServerWorkout} list item (summary card).
 */
export function mapSummaryItemToDraft(mappedItem) {
  const rows = mappedItem?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { draftLines: [], exerciseMeta: {} };
  }
  const draftLines = [];
  const exerciseMeta = {};
  for (const row of rows) {
    const id = newDraftLineId();
    draftLines.push({
      id,
      group: row.group,
      name: row.name,
      exerciseId: row.exerciseId != null ? row.exerciseId : undefined,
      status: normalizeExerciseStatus(row),
    });
    exerciseMeta[id] = {
      weight: prefillWeightField(row.weight),
      reps:
        row.reps != null && String(row.reps) !== ""
          ? prefillNumberToDigitsField(row.reps)
          : "",
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

export function formatWorkoutDate(isoDate) {
  if (!isoDate) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
      new Date(`${isoDate}T12:00:00`)
    );
  } catch {
    return String(isoDate);
  }
}

export function digits4(value) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 4);
}

export function parseIntOrNull(s) {
  if (!s) return null;
  const n = Number.parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
}

/** Empty weight field submits as 0 (bodyweight / default). */
export function parseWeightIntOrNull(s) {
  if (s === "" || s == null) return 0;
  const n = Number.parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
}

export function newDraftLineId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const DRAFT_DND_TYPE = "application/x-brogress-draft-index";

export const DRAFT_FLIP_MS = 320;
export const DRAFT_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * True when {@code next} is the same ordered list as {@code prev} (same id/group/name per index);
 * only {@code status} may differ. Used to skip FLIP — viewport rects go stale after scroll.
 */
export function draftLinesOnlyStatusChanged(prev, next) {
  if (prev == null || prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id || a.group !== b.group || a.name !== b.name) return false;
    if (a.exerciseId !== b.exerciseId) return false;
  }
  return true;
}

/** Reorder so the item at {@code fromIndex} ends up immediately before the row that was at {@code toIndex} (drop target). */
export function reorderDraftIndices(lines, fromIndex, toIndex) {
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
