import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyLocale, readCachedLocale } from "./i18n";
import { applyThemePreference, readCachedTheme } from "./theme";
import "./styles.css";

applyLocale(readCachedLocale() ?? "en");
applyThemePreference(readCachedTheme() ?? "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
