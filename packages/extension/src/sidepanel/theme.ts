export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_CACHE_KEY = "opensider/theme";
export const THEME_ORDER: ThemePreference[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function nextTheme(current: ThemePreference): ThemePreference {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

export function readCachedTheme(): ThemePreference | undefined {
  try {
    const value = window.localStorage.getItem(THEME_CACHE_KEY);
    return isThemePreference(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, preference);
  } catch {
    // quota / private mode
  }
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

export function applyThemePreference(preference: ThemePreference): void {
  writeCachedTheme(preference);
  applyResolvedTheme(resolveTheme(preference));
}

export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => onChange();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
