import type { AgentModeKind, AgentModeOption } from "@shared";
import {
  Bot,
  ClipboardList,
  FolderPen,
  Hammer,
  MessageCircleQuestion,
  Unlock,
  Workflow,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { RippleButton } from "./RippleButton";
import { useRipple } from "../useRipple";

/**
 * 会话模式（Agent 自己那套 plan / build / ask / autopilot…）。
 *
 * 与权限下拉是**两个概念**：权限是我们的拦卡档位，这个是引擎自己的工作流模式。整个控件
 * 的数据来自 Host 发现的结果（见 internal/modes），我们只负责画：
 *
 *  - 少于两项**不渲染**：一项等于没得切，画一个点了没反应的下拉不如不画；
 *  - 名称原样用引擎给的 `name`，**不翻译**（各家叫法不同，自己造译名只会误导）；
 *  - 图标按后端给的 kind 选，认不出来用中性的 Workflow；
 *  - 窄宽度（compact）只留图标，tooltip 里给出名称与含义。
 */

const ICONS: Record<AgentModeKind, typeof Workflow> = {
  plan: ClipboardList,
  build: Hammer,
  ask: MessageCircleQuestion,
  agent: Bot,
  edits: FolderPen,
  auto: Zap,
  full_access: Unlock,
  unknown: Workflow,
};

export function agentModeIcon(kind: AgentModeKind) {
  return ICONS[kind] ?? ICONS.unknown;
}

function tooltipOf(locale: Locale, option: AgentModeOption | undefined) {
  if (!option) return t(locale, "agentMode");
  const name = displayName(option);
  const desc = option.desc?.trim();
  // 有引擎给的说明就用「名称 — 说明」；没有就退回「Agent 模式：名称」，反正不编造含义。
  return desc ? `${name} — ${desc}` : `${t(locale, "agentMode")}: ${name}`;
}

/**
 * 只做**排版**：首字母大写。
 *
 * 引擎给的名字不翻译也不换词（opencode 那类只给 id 的引擎会把 `build` / `plan` 原样报
 * 回来，直接画出来全是小写）。已有的驼峰、句首大写（`Accept edits`）不受影响。
 */
function displayName(option: AgentModeOption) {
  const name = option.name.trim() || option.id;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function AgentModeSelect({
  locale,
  options,
  currentId,
  compact,
  onMode,
}: {
  locale: Locale;
  options: AgentModeOption[];
  currentId: string;
  compact: boolean;
  onMode: (modeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (options.length < 2) return null;

  const current = options.find((option) => option.id === currentId) ?? options[0];
  const CurrentIcon = agentModeIcon(current.kind);
  const tip = tooltipOf(locale, current);

  return (
    // 与权限下拉同规：不撑开、紧挨左侧三个图标钮，多余空间留给右侧。
    <div ref={rootRef} className={`relative min-w-0 shrink ${compact ? "" : "min-w-[5rem] max-w-full"}`}>
      <button
        type="button"
        title={tip}
        aria-label={tip}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => spawn(event)}
        className="relative flex h-7 max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]"
      >
        <CurrentIcon size={14} className="shrink-0" />
        {compact ? null : <span className="min-w-0 truncate">{displayName(current)}</span>}
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="cs-ripple"
            style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
            onAnimationEnd={() => done(ripple.id)}
          />
        ))}
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-[80] mb-1.5 w-64 rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
          {options.map((option) => {
            const Icon = agentModeIcon(option.kind);
            const active = option.id === currentId;
            return (
              <RippleButton
                key={option.id}
                onClick={() => {
                  onMode(option.id);
                  setOpen(false);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left ${
                  active ? "bg-[var(--hover-strong)]" : ""
                }`}
              >
                <span
                  className={`flex items-center gap-1.5 text-[12px] ${
                    active ? "text-[var(--text)]" : "text-[var(--muted)]"
                  }`}
                >
                  <Icon size={14} />
                  {displayName(option)}
                </span>
                {option.desc ? (
                  <span className="pl-[22px] text-[11px] leading-snug text-[var(--muted)]">{option.desc}</span>
                ) : null}
              </RippleButton>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
