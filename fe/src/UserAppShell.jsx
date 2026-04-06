import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BrogressWorkspace } from "./BrogressWorkspace.jsx";
import { LoginGate } from "./LoginGate.jsx";
import {
  clearAuthFromStorage,
  readAuthFromStorage,
  saveAuthToStorage,
} from "./authStorage.js";

export function UserAppShell() {
  const { nick: nickParam } = useParams();
  const navigate = useNavigate();
  const decodedNick = decodeURIComponent(nickParam || "").trim();
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readAuthFromStorage();
    if (stored && stored.nick.toLowerCase() === decodedNick.toLowerCase()) {
      setToken(stored.token);
    } else {
      clearAuthFromStorage();
      setToken(null);
    }
    setReady(true);
  }, [decodedNick]);

  const saveAuth = useCallback(
    (t, canonicalNick) => {
      saveAuthToStorage(t, canonicalNick);
      setToken(t);
      if (canonicalNick.toLowerCase() !== decodedNick.toLowerCase()) {
        navigate(`/u/${encodeURIComponent(canonicalNick)}`, { replace: true });
      }
    },
    [decodedNick, navigate]
  );

  const clearAuth = useCallback(() => {
    clearAuthFromStorage();
    setToken(null);
  }, []);

  if (!ready) {
    return null;
  }
  if (!decodedNick) {
    return (
      <main className="app app--entry">
        <section className="content content--entry">
          <div className="panel">
            <p className="panel-hint">Brak nicka w adresie. Wróć na <Link to="/">stronę główną</Link>.</p>
          </div>
        </section>
      </main>
    );
  }
  if (!token) {
    return <LoginGate initialNick={decodedNick} onLoggedIn={saveAuth} />;
  }
  return (
    <BrogressWorkspace
      authToken={token}
      onAuthLost={clearAuth}
      onLogout={clearAuth}
    />
  );
}
