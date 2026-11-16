import type { AgentProgress, HostStatusState } from "@shared";
import { ChevronsLeft, ChevronsRight, CircleArrowUp, MessageSquare, RotateCw, Unplug } from "lucide-react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { isPlaceholderTitle } from "../persist";
import { COMPOSER_ICON_PX } from "../layout";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

export function Header({
  locale,
  status,
  error,
  progress,
  sessionTitle,
  sessionsOpen,
  updateAvailable,
  onRetry,
  onToggleSessions,
  onShowUpdate,
}: {
  locale: Locale;
  status: HostStatusState;
  error?: string;
  progress?: AgentProgress;
  sessionTitle: string;
  sessionsOpen: boolean;
  /** 扩展或桥接落后于最新 release 时，抽屉钮左侧多一个提示图标。 */
  updateAvailable?: boolean;
  onRetry?: () => void;
  onToggleSessions: () => void;
  onShowUpdate: () => void;
}) {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const unnamed = isPlaceholderTitle(sessionTitle);
  const title = unnamed ? label("untitled") : sessionTitle.trim();
  // Agent 切换钮已经搬到输入框里（见 ChatPane）；连接中的完整进度也搬到了输入框底部，
  // 顶栏这里只保留 `2/6` 这种最小提示。状态放在右侧：标题左缘固定在图标处，连接 / 重连
  // 都不会把它推来推去。
  const showStatus = status !== "ready";

  const statusChip = showStatus ? (
    <div className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px]" title={error}>
      <Unplug
        size={13}
        className={status === "error" || status === "missing" ? "text-[var(--bad)]" : "text-[var(--warn)]"}
      />
      <span className="text-[var(--muted)]">
        {status === "starting"
          ? label("starting")
          : status === "connecting"
            ? progress
              ? `${progress.index}/${progress.total}`
              : label("connecting")
            : label("offline")}
      </span>
    </div>
  ) : null;

  const retryButton =
    (status === "error" || status === "missing") && onRetry ? (
      <RippleButton
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--text)]"
      >
        <RotateCw size={12} />
        {label("retry")}
      </RippleButton>
    ) : null;

  const drawerButton = (
    <IconButton
      label={sessionsOpen ? label("collapseSessions") : label("expandSessions")}
      onClick={onToggleSessions}
      aria-expanded={sessionsOpen}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
    >
      {sessionsOpen ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
    </IconButton>
  );

  // 有新版本时才出现，紧贴在抽屉钮左侧；点开是一个可直接复制提示词的模态窗。
  const updateButton = updateAvailable ? (
    <IconButton
      label={label("updateDialogTitle")}
      onClick={onShowUpdate}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--brass)]"
    >
      <CircleArrowUp size={14} />
      <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--brass)]" />
    </IconButton>
  ) : null;

  return (
    <header className="relative z-40 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] px-3 py-2.5 backdrop-blur">
      {/* 一行到底：`min-w-0` 在标题上，面板再窄也只是省略标题，右侧按钮永远完整；标题
          不可点击改名（重命名只在右侧会话卡片上）。 */}
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <MessageSquare
            size={COMPOSER_ICON_PX}
            aria-hidden
            className="shrink-0 text-[var(--muted)] opacity-80"
          />
          <div
            title={title}
            className="min-w-0 flex-1 truncate whitespace-nowrap text-left text-[14px] font-medium tracking-tight text-[var(--text)]"
          >
            {title}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {statusChip}
          {retryButton}
          {updateButton}
          {drawerButton}
        </div>
      </div>

      {error && status === "error" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bad)]">{error}</p>
      ) : null}
    </header>
  );
}
