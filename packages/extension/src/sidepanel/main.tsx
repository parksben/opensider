import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyLocale, detectBrowserLocale, readCachedLocale } from "./i18n";
import { applyThemePreference, detectBrowserTheme, readCachedTheme } from "./theme";
import "./styles.css";

applyLocale(readCachedLocale() ?? detectBrowserLocale());
applyThemePreference(readCachedTheme() ?? detectBrowserTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
