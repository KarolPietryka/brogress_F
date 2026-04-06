import React from "react";
import { useNavigate } from "react-router-dom";
import { LoginGate } from "./LoginGate.jsx";
import { saveAuthToStorage } from "./authStorage.js";

export function EntryHome() {
  const navigate = useNavigate();

  return (
    <LoginGate
      initialNick=""
      onLoggedIn={(t, nick) => {
        saveAuthToStorage(t, nick);
        navigate(`/u/${encodeURIComponent(nick)}`, { replace: true });
      }}
    />
  );
}
