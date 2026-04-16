import posthog from "posthog-js";

function posthogEnabled() {
  return Boolean(import.meta.env.VITE_POSTHOG_KEY);
}

/**
 * Call after login or when restoring session — links anonymous events to this person.
 * distinct_id: case-insensitive nick (matches auth); display name in properties.
 */
export function identifyPosthogUser(canonicalNick) {
  if (!posthogEnabled()) return;
  const nick = canonicalNick?.trim();
  if (!nick) return;
  posthog.identify(nick.toLowerCase(), { name: nick });
}

/** Call on logout — stops attributing further events on this device to the previous user. */
export function resetPosthogSession() {
  if (!posthogEnabled()) return;
  posthog.reset();
}
