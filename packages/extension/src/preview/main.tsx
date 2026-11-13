import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../sidepanel/styles.css";
import "./preview.css";
import { ArtifactPreview } from "./ArtifactPreview";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ArtifactPreview />
  </StrictMode>,
);
