/** Ustaw na Renderze (Static Site): Environment → `VITE_WORKOUT_API_URL` = publiczny URL BE (bez końcowego `/`). */
export const WORKOUT_API_BASE =
  import.meta.env.VITE_WORKOUT_API_URL ?? "http://localhost:8080";

export class WorkoutClient {
  /**
   * Sends a POST request to submit workout data.
   *
   * Example JSON body:
   * {
   *   "exercises": [
   *     { "bodyPartName": "chest", "name": "Bench Press", "weight": 100, "reps": 10, "status": "DONE" },
   *     { "bodyPartName": "chest", "name": "Push-ups", "weight": 0, "reps": 20, "status": "PLANNED" },
   *     { "bodyPartName": "back", "name": "Pull-ups", "weight": 0, "reps": 12, "status": "NEXT" }
   *   ]
   * }
   *
   * @param {object} body - The object to be converted to JSON (e.g., WorkoutSubmitRequest).
   * @returns {Promise<Response>} - A promise resolving to the response from the server.
   */
  postWorkouts(body) {
    const url = `${WORKOUT_API_BASE}/workout`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  getExerciseCatalog() {
    return fetch(`${WORKOUT_API_BASE}/workout/exercise-catalog`);
  }

  getWorkouts() {
    return fetch(`${WORKOUT_API_BASE}/workout`);
  }

  /** GET /brogres/graph — [{ workoutDay, volume }, …] for current specialization slice. */
  getGraphVolume() {
    return fetch(`${WORKOUT_API_BASE}/brogres/graph`);
  }

  /**
   * GET /workout/prefill — flat `bodyPart[]` rows with `bodyPartName` on each; `status` PLANNED | NEXT | DONE.
   */
  prefillWorkout() {
    return fetch(`${WORKOUT_API_BASE}/workout/prefill`, { method: "GET" });
  }
}
