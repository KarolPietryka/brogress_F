import {
  BODY_PART_TO_GROUP_LABEL,
} from "./workoutData.js";

/** BE status: DONE | PLANNED. Legacy values (NEXT from old clients, {@code planned} boolean) are coerced. */
export function normalizeExerciseStatus(e) {
  const s = e?.status;
  if (s === "DONE") return "DONE";
  if (s === "PLANNED") return "PLANNED";
  if (s === "NEXT") return "PLANNED";
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
  return "done";
}

/**
 * Progress-bar position = number of leading DONE rows in the draft.
 * Invariant in the new model: DONE rows come first, PLANNED rows after — bar sits at the boundary.
 */
export function computeBarIndex(lines) {
  if (!lines?.length) return 0;
  let i = 0;
  while (i < lines.length && normalizeExerciseStatus(lines[i]) === "DONE") i++;
  return i;
}

/**
 * Applies a new bar position: first {@code barIndex} rows become DONE, the rest PLANNED.
 * Preserves row identity and per-row meta — only {@code status} may change.
 */
export function applyBarIndex(lines, barIndex) {
  if (!lines?.length) return lines;
  const clamped = Math.max(0, Math.min(barIndex, lines.length));
  let changed = false;
  const next = lines.map((line, i) => {
    const want = i < clamped ? "DONE" : "PLANNED";
    const current = normalizeExerciseStatus(line);
    if (current === want && line.status === want) return line;
    changed = true;
    return { ...line, status: want };
  });
  return changed ? next : lines;
}

/**
 * Drop-above rule: dragging any row onto a target row places it DIRECTLY above that target.
 * The moved row inherits the target's status (DONE/PLANNED) — that is what "above target" means
 * visually: it sits on the target's side of the progress bar. Invariant "DONEs first" is preserved
 * as long as the caller honors the bar model.
 *
 * @param {Array} lines current draft rows.
 * @param {number} fromIndex source row index.
 * @param {number} targetIndex row index to land above.
 * @returns {{ lines: Array, changed: boolean }}
 */
export function moveDraftExerciseAbove(lines, fromIndex, targetIndex) {
  if (!Array.isArray(lines) || lines.length === 0) return { lines, changed: false };
  if (fromIndex < 0 || fromIndex >= lines.length) return { lines, changed: false };
  if (targetIndex < 0 || targetIndex >= lines.length) return { lines, changed: false };
  // Same row, or source already sits directly above target → nothing to move.
  if (fromIndex === targetIndex) return { lines, changed: false };
  if (fromIndex + 1 === targetIndex) return { lines, changed: false };

  // Compute insertion slot after removal: everything past fromIndex shifts left by one.
  const item = lines[fromIndex];
  const targetStatus = normalizeExerciseStatus(lines[targetIndex]);
  const withoutItem = lines.filter((_, i) => i !== fromIndex);
  const insertAt = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;

  const moved = { ...item, status: targetStatus };
  const reordered = [
    ...withoutItem.slice(0, insertAt),
    moved,
    ...withoutItem.slice(insertAt),
  ];
  return { lines: reordered, changed: true };
}

/**
 * Drop-above rule applied to the progress bar: the dragged row lands ABOVE the bar — i.e. becomes
 * the last DONE row. Bar position is then re-derived from statuses.
 */
export function moveDraftExerciseAboveBar(lines, fromIndex) {
  if (!Array.isArray(lines) || lines.length === 0) return { lines, changed: false };
  if (fromIndex < 0 || fromIndex >= lines.length) return { lines, changed: false };

  const barBefore = computeBarIndex(lines);
  // Item is already the last DONE → dropping on the bar changes nothing.
  if (fromIndex < barBefore && fromIndex + 1 === barBefore) return { lines, changed: false };

  const item = lines[fromIndex];
  const withoutItem = lines.filter((_, i) => i !== fromIndex);
  const insertAt = fromIndex < barBefore ? barBefore - 1 : barBefore;

  const moved = { ...item, status: "DONE" };
  const reordered = [
    ...withoutItem.slice(0, insertAt),
    moved,
    ...withoutItem.slice(insertAt),
  ];
  return { lines: reordered, changed: true };
}

/**
 * Tail drop zone (no concrete target row) → append at the very end. Status matches the current tail
 * so the "DONEs first" invariant survives (empty tail falls back to the item's own status).
 */
export function appendDraftExerciseToEnd(lines, fromIndex) {
  if (!Array.isArray(lines) || lines.length === 0) return { lines, changed: false };
  if (fromIndex < 0 || fromIndex >= lines.length) return { lines, changed: false };
  if (fromIndex === lines.length - 1) return { lines, changed: false };

  const item = lines[fromIndex];
  const withoutItem = lines.filter((_, i) => i !== fromIndex);
  const tailStatus =
    withoutItem.length > 0
      ? normalizeExerciseStatus(withoutItem[withoutItem.length - 1])
      : normalizeExerciseStatus(item);
  const moved = { ...item, status: tailStatus };
  return { lines: [...withoutItem, moved], changed: true };
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

/**
 * Last row in {@code draftLines} (visual list order): group, name, weight/reps for the sticky composer.
 * Used when opening the modal so the composer matches the tail row even if every row is DONE.
 */
export function lastDraftLineComposerPrefill(draftLines, exerciseMeta) {
  const empty = {
    rowId: "",
    group: null,
    name: null,
    exerciseId: null,
    weight: "0",
    reps: "",
  };
  if (!draftLines?.length) return { ...empty };
  const line = draftLines[draftLines.length - 1];
  const m = exerciseMeta[line.id] || { weight: "0", reps: "" };
  const w = m.weight != null && String(m.weight) !== "" ? String(m.weight) : "0";
  const r = m.reps != null && String(m.reps) !== "" ? String(m.reps) : "";
  return {
    rowId: line.id,
    group: line.group,
    name: line.name,
    exerciseId: line.exerciseId != null ? line.exerciseId : null,
    weight: w,
    reps: r,
  };
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

/** Max characters in modal weight/reps inputs (digits + optional single decimal separator). */
export const MAX_WEIGHT_INPUT_LEN = 8;
export const MAX_REPS_INPUT_LEN = 6;

/**
 * Keeps digits and at most one decimal separator (comma or dot) for locale-friendly typing.
 * Does not normalize comma↔dot so Polish users can keep "," in the field while editing.
 */
export function sanitizeOptionalDecimalInput(value, maxLen) {
  const cap = Math.max(1, maxLen);
  const str = String(value ?? "");
  let hasSep = false;
  const out = [];
  for (let i = 0; i < str.length; i++) {
    if (out.length >= cap) break;
    const c = str[i];
    if (c >= "0" && c <= "9") {
      out.push(c);
      continue;
    }
    if ((c === "," || c === ".") && !hasSep) {
      hasSep = true;
      out.push(c);
    }
  }
  return out.join("");
}

/** Prefill weight: missing or invalid → "0" so bodyweight / no-BE-weight rows are editable. */
function prefillWeightField(value) {
  if (value == null || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const withComma = String(n).replace(".", ",");
  return sanitizeOptionalDecimalInput(withComma, MAX_WEIGHT_INPUT_LEN);
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

/** Empty weight field submits as 0 (bodyweight / default). Accepts "," or "." as decimal separator. */
export function parseWeightForApi(s) {
  if (s === "" || s == null) return 0;
  const t = String(s).trim().replace(",", ".");
  if (t === "" || t === ".") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reps are integers on the API; accept "," or "." while typing and round when serializing.
 * Empty / invalid → null (caller may omit or let BE validate).
 */
export function parseRepsIntForApi(s) {
  if (s === "" || s == null) return null;
  const t = String(s).trim().replace(",", ".");
  if (t === "" || t === ".") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

export function newDraftLineId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const DRAFT_DND_TYPE = "application/x-brogress-draft-index";
export const BAR_DND_TYPE = "application/x-brogress-bar-drag";

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
