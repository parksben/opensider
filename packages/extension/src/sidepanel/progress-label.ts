import type { AgentProgress } from "@shared";
import { t, type Locale } from "./i18n";

/**
 * Host 连接阶段 → 文案键。
 *
 * Host 报的 `phase` 是协议值（resolve / spawn / handshake…），`label` 只作兜底：认不出来
 * 时直接显示 Host 自己写的那一句，不猜含义。
 */
const PHASE_KEYS = {
  resolve: "progressResolve",
  spawn: "progressSpawn",
  handshake: "progressHandshake",
  auth: "progressAuth",
  session: "progressSession",
  models: "progressModels",
} as const;

/** 「2/6 · 拉起」或（还没有进度时）「连接中」。 */
export function progressText(locale: Locale, progress?: AgentProgress): string {
  if (!progress) return t(locale, "connecting");
  const key = PHASE_KEYS[progress.phase as keyof typeof PHASE_KEYS];
  return `${progress.index}/${progress.total} · ${key ? t(locale, key) : progress.label}`;
}

/** 进度条的百分比（0–100），没有进度时返回 undefined（不画填充）。 */
export function progressPercent(progress?: AgentProgress): number | undefined {
  if (!progress || progress.total <= 0) return undefined;
  return Math.round((progress.index / progress.total) * 100);
}
