import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BrogressWorkspace } from "./BrogressWorkspace.jsx";
import { LoginGate } from "./LoginGate.jsx";

const STORAGE_TOKEN = "brogress_token";
const STORAGE_NICK = "brogress_nick";

export function UserAppShell() {
  const { nick: nickParam } = useParams();
  const decodedNick = decodeURIComponent(nickParam || "").trim();
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem(STORAGE_TOKEN);
    const n = sessionStorage.getItem(STORAGE_NICK);
    if (t && n && n.toLowerCase() === decodedNick.toLowerCase()) {
      setToken(t);
    } else {
      sessionStorage.removeItem(STORAGE_TOKEN);
      sessionStorage.removeItem(STORAGE_NICK);
      setToken(null);
    }
    setReady(true);
  }, [decodedNick]);

  const saveAuth = useCallback((t, canonicalNick) => {
    sessionStorage.setItem(STORAGE_TOKEN, t);
    sessionStorage.setItem(STORAGE_NICK, canonicalNick);
    setToken(t);
  }, []);

  const clearAuth = useCallback(() => {
    sessionStorage.removeItem(STORAGE_TOKEN);
    sessionStorage.removeItem(STORAGE_NICK);
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
    return <LoginGate nick={decodedNick} onLoggedIn={saveAuth} />;
  }
  const storedNick = sessionStorage.getItem(STORAGE_NICK) || decodedNick;
  return (
    <BrogressWorkspace
      authToken={token}
      urlNick={storedNick}
      onAuthLost={clearAuth}
      onLogout={clearAuth}
    />
  );
}
