import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { FeatureBoundary } from "./FeatureBoundary";
performance.mark("lotus-shell-start");
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FeatureBoundary>
      <App />
    </FeatureBoundary>
  </StrictMode>,
);
