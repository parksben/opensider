import type { Locale } from "./i18n";

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

// 安装不再由 shell 壳脚本承担：用户把下面这段提示词发给自己在用的本机 AI Agent，
// 由它按仓库里的 skill 分步完成（探测平台、装桥接、引导加载扩展、验证）。
// skill 入口固定在 main 分支：skill 自己会先解析最新 release 的 tag，再用该 tag 的
// 文件与资产，保证与二进制同版本。
//
// 三段提示词一律只有两行：**意图 + 入口 URL + 按其流程执行**。读取、确认浏览器、
// 选扩展目录、逐步验证这些约束全写在 skill 里——不要往提示词里再塞一遍，重复只会
// 互相干扰（改 skill 时要同步 README 中英同名段落，两边逐字一致）。
export const INSTALL_SKILL_URL =
  "https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md";

export function hostInstallPrompt(locale: Locale = "en"): string {
  if (locale === "zh") {
    return [
      "帮我安装 OpenSider 浏览器扩展。",
      `请先读取 ${INSTALL_SKILL_URL}，按其安装流程执行。`,
    ].join("\n");
  }
  return [
    "Install the OpenSider browser extension for me.",
    `Read ${INSTALL_SKILL_URL} and follow its install flow.`,
  ].join("\n");
}

export function hostUpdatePrompt(locale: Locale = "en"): string {
  if (locale === "zh") {
    return [
      "帮我更新 OpenSider 浏览器扩展。",
      `请先读取 ${INSTALL_SKILL_URL}，按其更新流程执行。`,
    ].join("\n");
  }
  return [
    "Update the OpenSider browser extension for me.",
    `Read ${INSTALL_SKILL_URL} and follow its update flow.`,
  ].join("\n");
}

export function hostUninstallPrompt(locale: Locale = "en"): string {
  if (locale === "zh") {
    return [
      "帮我卸载 OpenSider 浏览器扩展。",
      `请先读取 ${INSTALL_SKILL_URL}，按其卸载流程执行。`,
    ].join("\n");
  }
  return [
    "Uninstall the OpenSider browser extension for me.",
    `Read ${INSTALL_SKILL_URL} and follow its removal flow.`,
  ].join("\n");
}
