export type DesktopOs = "macos" | "windows" | "linux";

type NavigatorUAData = {
  platform?: string;
};

export function detectDesktopOs(): DesktopOs {
  const platform = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData?.platform;
  if (platform === "macOS") return "macos";
  if (platform === "Windows") return "windows";
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Windows") || ua.includes("Win32") || ua.includes("Win64")) return "windows";
  return "linux";
}

export function hostInstallScript(os: DesktopOs = detectDesktopOs()): string {
  if (os === "windows") {
    return "curl.exe -fsSL https://github.com/parksben/opensider/releases/latest/download/install.ps1 | iex";
  }
  return "curl -fsSL https://github.com/parksben/opensider/releases/latest/download/install.sh | bash";
}
