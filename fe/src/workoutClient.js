/** Set on Render (Static Site): Environment → `VITE_WORKOUT_API_URL` = public BE URL (no trailing `/`). */
export const WORKOUT_API_BASE =
  import.meta.env.VITE_WORKOUT_API_URL ?? "http://localhost:8080";

export class WorkoutClient {
  /**
   * @param {{ getToken?: () => string | null, onUnauthorized?: () => void }} [options]
   */
  constructor(options = {}) {
    this.getToken = options.getToken ?? (() => null);
    this.onUnauthorized = options.onUnauthorized;
  }

  #withAuth(res) {
    if (res.status === 401) {
      this.onUnauthorized?.();
    }
    return res;
  }

  #headers(jsonBody) {
    const h = {};
    if (jsonBody) {
      h["Content-Type"] = "application/json";
    }
    const t = this.getToken();
    if (t) {
      h.Authorization = `Bearer ${t}`;
    }
    return h;
  }

  postWorkouts(body) {
    const url = `${WORKOUT_API_BASE}/workout`;
    return fetch(url, {
      method: "POST",
      headers: this.#headers(true),
      body: JSON.stringify(body),
    }).then((r) => this.#withAuth(r));
  }

  getExerciseCatalog() {
    return fetch(`${WORKOUT_API_BASE}/workout/exercise-catalog`, {
      headers: this.#headers(false),
    }).then((r) => this.#withAuth(r));
  }

  getWorkouts() {
    return fetch(`${WORKOUT_API_BASE}/workout`, {
      headers: this.#headers(false),
    }).then((r) => this.#withAuth(r));
  }

  /** GET /brogres/graph — [{ workoutDay, volume }, …] for current specialization slice. */
  getGraphVolume() {
    return fetch(`${WORKOUT_API_BASE}/brogres/graph`, {
      headers: this.#headers(false),
    }).then((r) => this.#withAuth(r));
  }

  /**
   * GET /workout/prefill — flat `bodyPart[]` rows with `bodyPartName` on each; `status` PLANNED | NEXT | DONE.
   */
  prefillWorkout() {
    return fetch(`${WORKOUT_API_BASE}/workout/prefill`, {
      method: "GET",
      headers: this.#headers(false),
    }).then((r) => this.#withAuth(r));
  }
}
