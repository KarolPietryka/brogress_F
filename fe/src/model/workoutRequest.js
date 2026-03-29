/** { "name", "weight", "reps", "status" } — status: PLANNED | NEXT | DONE */
export class WorkoutExercise {
  name = "";
  /** @type {number | null} */
  weight = null;
  /** @type {number | null} */
  reps = null;
  /** @type {string | undefined} */
  status;
}

/** { "bodyPartName", "exercises" } */
export class WorkoutBodyPart {
  bodyPartName = "";
  /** @type {WorkoutExercise[]} */
  exercises = [];
}

/** { "bodyPart": [ ... ] } — POST /workout */
export class WorkoutSubmitRequest {
  /** @type {WorkoutBodyPart[]} */
  bodyPart = [];
}
