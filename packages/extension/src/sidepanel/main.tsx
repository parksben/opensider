import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyThemePreference, readCachedTheme } from "./theme";
import "./styles.css";

applyThemePreference(readCachedTheme() ?? "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
