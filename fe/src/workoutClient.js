const WORKOUT_URL = "http://localhost:8080/workout";

export class WorkoutClient {
  /**
   * @param {object} body — obiekt do JSON.stringify (np. WorkoutSubmitRequest)
   * @returns {Promise<Response>}
   */
  post(body) {
    return fetch(WORKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
