import type { AgentProgress, HostStatusState } from "@shared";
import { ChevronsLeft, ChevronsRight, CircleArrowUp, RotateCw, Unplug } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { isPlaceholderTitle } from "../persist";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

const TITLE_GAP = 32;

export function Header({
  locale,
  status,
  error,
  progress,
  compact,
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
  compact?: boolean;
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
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [sidePad, setSidePad] = useState({ left: TITLE_GAP, right: TITLE_GAP });
  // Agent 切换钮已经搬到输入框里（见 ChatPane）；顶栏左侧只剩状态。连接中的完整进度
  // 也搬到了输入框底部，顶栏这里只保留 `2/6` 这种最小提示（窄宽度下仍然只有它）。
  const showStatus = status !== "ready";

  useLayoutEffect(() => {
    if (compact) return;
    const bar = barRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!bar || !left || !right) return;
    const measure = () => {
      // 标题层直接以左右 cluster 的占位为 inset，两侧各留 TITLE_GAP。
      // 面板太窄、放不下两个安全间距时，按可分配空间对半压缩（绝不覆盖两侧控件），
      // 标题自身照常 truncate。
      const room = bar.offsetWidth;
      const rest = room - left.offsetWidth - right.offsetWidth;
      const gap = Math.max(0, Math.min(TITLE_GAP, rest / 2));
      setSidePad({
        left: left.offsetWidth + gap,
        right: right.offsetWidth + gap,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(left);
    observer.observe(right);
    return () => observer.disconnect();
  }, [compact, status, error, sessionsOpen, updateAvailable]);

  const titleCluster = (align: "left" | "center") => (
    <div
      title={title}
      className={`min-w-0 truncate whitespace-nowrap text-[14px] font-medium tracking-tight text-[var(--text)] ${
        align === "left" ? "w-full text-left" : "w-full text-center"
      }`}
    >
      {title}
    </div>
  );

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
      {compact ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {statusChip}
            {retryButton}
            {titleCluster("left")}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1.5">
            {updateButton}
            {drawerButton}
          </div>
        </div>
      ) : (
        <div ref={barRef} className="relative flex items-center justify-between">
          <div ref={leftRef} className="flex shrink-0 items-center gap-1.5">
            {statusChip}
            {retryButton}
          </div>
          <div
            className="pointer-events-none absolute bottom-0 top-0 flex items-center justify-center"
            style={{ left: sidePad.left, right: sidePad.right }}
          >
            <div className="flex w-full min-w-0 items-center justify-center">{titleCluster("center")}</div>
          </div>
          <div ref={rightRef} className="flex shrink-0 items-center justify-end gap-1.5">
            {updateButton}
            {drawerButton}
          </div>
        </div>
      )}

      {error && status === "error" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bad)]">{error}</p>
      ) : null}
    </header>
  );
}
