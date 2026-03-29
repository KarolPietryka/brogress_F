/** One persisted line: same shape as GET rows and {@link WorkoutSet} (bodyPart on each exercise). */
export class WorkoutExercise {
  bodyPartName = "";
  name = "";
  /** @type {number | null} */
  weight = null;
  /** @type {number | null} */
  reps = null;
  /** @type {string | undefined} */
  status;
}

/** { "exercises": [ ... ] } — POST /workout */
export class WorkoutSubmitRequest {
  /** @type {WorkoutExercise[]} */
  exercises = [];
}
