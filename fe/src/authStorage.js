export const STORAGE_TOKEN = "brogress_token";
export const STORAGE_NICK = "brogress_nick";

export function saveAuthToStorage(token, nick) {
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_NICK, nick);
}

export function clearAuthFromStorage() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_NICK);
}

export function readAuthFromStorage() {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const nick = localStorage.getItem(STORAGE_NICK);
  if (!token || !nick) return null;
  return { token, nick };
}
