import { WORKOUT_API_BASE } from "./workoutClient.js";

/**
 * @param {"login" | "register"} mode
 * @param {{ nick: string, password: string }} body
 * @returns {Promise<{ ok: boolean, status: number, data?: { token: string, nick: string }, errorText?: string }>}
 */
export async function authRequest(mode, body) {
  const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
  const res = await fetch(`${WORKOUT_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, errorText: text || `HTTP ${res.status}` };
  }
  if (!data?.token || !data?.nick) {
    return { ok: false, status: res.status, errorText: "Invalid response from server" };
  }
  return { ok: true, status: res.status, data };
}
