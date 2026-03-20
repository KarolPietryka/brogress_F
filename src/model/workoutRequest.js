/** { "name", "weight", "reps" } */
export class WorkoutExercise {
  name = "";
  /** @type {number | null} */
  weight = null;
  /** @type {number | null} */
  reps = null;
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
