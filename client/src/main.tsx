import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { dropLegacyAudioCaches } from "./lib/audioCache";
import "./index.css";

void dropLegacyAudioCaches();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
