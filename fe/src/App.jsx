import React from "react";
import { Route, Routes } from "react-router-dom";
import { EntryHome } from "./EntryHome.jsx";
import { UserAppShell } from "./UserAppShell.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EntryHome />} />
      <Route path="/u/:nick" element={<UserAppShell />} />
    </Routes>
  );
}
