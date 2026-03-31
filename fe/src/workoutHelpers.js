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

export function rowStatusModifier(status) {
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

export function formatWorkoutDate(isoDate) {
  if (!isoDate) return "";
  try {
    return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(
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
