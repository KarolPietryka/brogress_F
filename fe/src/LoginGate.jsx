import React, { useState } from "react";
import { authRequest } from "./authClient.js";

export function LoginGate({ nick, onLoggedIn }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login");

  async function submitLogin() {
    setError("");
    setBusy(true);
    try {
      const result = await authRequest("login", { nick, password });
      if (!result.ok) {
        setError(
          result.status === 401
            ? "Wrong password or account does not exist."
            : result.errorText || `HTTP ${result.status}`
        );
        return;
      }
      onLoggedIn(result.data.token, result.data.nick);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister() {
    setError("");
    setBusy(true);
    try {
      const result = await authRequest("register", { nick, password });
      if (!result.ok) {
        setError(
          result.status === 409
            ? "This nick is already taken."
            : result.errorText || `HTTP ${result.status}`
        );
        return;
      }
      onLoggedIn(result.data.token, result.data.nick);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app app--entry">
      <section className="content content--entry">
        <div className="panel auth-panel">
          <div className="panel-head">
            <h1 className="panel-title">Brogress</h1>
            <p className="panel-hint">
              Add <code>/u/your-login</code> to the URL to log in to your account.
            </p>
            <p className="panel-hint">
              Nick from URL: <strong>{nick || "—"}</strong>
            </p>
          </div>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !password) return;
              if (mode === "register") void submitRegister();
              else void submitLogin();
            }}
          >
            <label className="auth-label">
              Password
              <input
                className="auth-input"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="auth-poc-warning" role="note">
              don&apos;t put nothing serious here because I will save password without hashing it. Im serious
              it&apos;s only POC. Go to{" "}
              <a
                href="https://brogress-f.onrender.com/u/kapiet"
                target="_blank"
                rel="noopener noreferrer"
                className="auth-poc-warning-link"
              >
                https://brogress-f.onrender.com/u/kapiet
              </a>{" "}
              if you want to see some data (password: kapiet)
            </p>
            {error ? <div className="errorText">{error}</div> : null}
            <div className="auth-actions">
              <button className="btn primary" type="submit" disabled={busy || !password}>
                {busy ? "…" : mode === "register" ? "Create account" : "Log in"}
              </button>
            </div>
            <button
              className="btn btn-linkish"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode((m) => (m === "login" ? "register" : "login"));
                setError("");
              }}
            >
              {mode === "login" ? "First time? Create an account" : "I have an account — log in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
