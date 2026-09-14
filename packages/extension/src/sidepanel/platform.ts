export type DesktopOs = "macos" | "windows" | "linux";

import type { Locale } from "./i18n";

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
export const INSTALL_SKILL_URL =
  "https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md";

export function hostInstallPrompt(locale: Locale = "en"): string {
  if (locale === "zh") {
    return [
      "帮我安装 OpenSider 浏览器扩展。",
      `请先读取 ${INSTALL_SKILL_URL}，然后严格按其中的流程执行。`,
      "开始前先跟我确认我平时用哪个浏览器；每一步都分步引导我操作，并自己验证结果。",
    ].join("\n");
  }
  return [
    "Install OpenSider for me.",
    `Read ${INSTALL_SKILL_URL} and follow it exactly.`,
    "Ask me which browser I use before you start, walk me through every step that needs me, and verify each stage yourself.",
  ].join("\n");
}

export function hostUpdatePrompt(locale: Locale = "en"): string {
  if (locale === "zh") {
    return [
      "帮我更新 OpenSider（浏览器扩展 + 本机桥接）。",
      `请先读取 ${INSTALL_SKILL_URL}，按其更新流程执行：对比本机已装版本与最新 release，更新落后的那一半，再引导我在浏览器里重新加载扩展并验证。`,
    ].join("\n");
  }
  return [
    "Update OpenSider (the browser extension and the local bridge) for me.",
    `Read ${INSTALL_SKILL_URL} and follow its update flow: compare what is installed here with the latest release, refresh whichever half is behind, then walk me through reloading the extension and verify it.`,
  ].join("\n");
}
