import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { watchAppUpdates } from "./lib/appUpdate";
import { dropLegacyAudioCaches } from "./lib/audioCache";
import "./index.css";

void dropLegacyAudioCaches();
watchAppUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
