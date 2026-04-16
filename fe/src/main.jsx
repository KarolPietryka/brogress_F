import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import posthog from "posthog-js";
import App from "./App.jsx";

// PostHog analytics — autocapture page views and clicks (free tier)
const phKey = import.meta.env.VITE_POSTHOG_KEY;
if (phKey) {
  // EU cloud: set VITE_POSTHOG_HOST=https://eu.i.posthog.com on Render (or in .env.local)
  posthog.init(phKey, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    autocapture: true,
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

