import { ChevronDown, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FadeScroll } from "./FadeScroll";

export function TextFold({
  label,
  icon,
  paneClass,
  children,
  open,
  onOpenChange,
  follow,
}: {
  label: string;
  icon?: ReactNode;
  paneClass: string;
  children: ReactNode;
  /**
   * 受控展开态：调用方（例如正在跑的工具调用）说「现在必须展开」时传 `true`，结束后传
   * `undefined` 把控制权还给用户——那时回到他自己上次点的状态。不传始终是非受控。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * 展开的内容区是否跟着流式输出贴底（运行中的工具结果 / 思考）。用户往上滚就松开、
   * 滚回底部附近又跟上，见 `FadeScroll`。
   */
  follow?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : ownOpen;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const anchorTop = useRef<number | null>(null);

  const toggle = () => {
    anchorTop.current = toggleRef.current?.getBoundingClientRect().top ?? null;
    if (controlled) onOpenChange?.(!isOpen);
    else setOwnOpen((value) => !value);
  };

  /**
   * 展开 / 收起会把下面的内容顶走，所以把灰字那一行钉回原处（`useThreadFollow` 只处理
   * 「消息流长高」，不懂「这一行刚才在这儿」）。
   *
   * 贴底时不做这件事：`thread-follow` 的 `scrollTop` 语义是「0 = 底部、上翻变负」，
   * 在这里叠加任何位移都会把列表从底部顶开，用户就看不到刚展开的内容了。贴底时
   * `useThreadFollow` 自己会收到 resize 并把 `scrollTop` 归零，跟着走就行。
   */
  useLayoutEffect(() => {
    if (anchorTop.current == null || !toggleRef.current) return;
    const thread = toggleRef.current.closest(".cs-thread");
    if (!(thread instanceof HTMLElement)) {
      anchorTop.current = null;
      return;
    }
    if (thread.scrollTop === 0) {
      anchorTop.current = null;
      return;
    }
    thread.scrollTop += toggleRef.current.getBoundingClientRect().top - anchorTop.current;
    anchorTop.current = null;
  }, [isOpen]);

  return (
    <div>
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        className="group/fold flex w-full min-w-0 items-center bg-transparent py-0.5 text-left"
      >
        <span className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 text-[12px] text-[var(--muted)]">
          {icon}
          <span className="min-w-0 truncate whitespace-nowrap" title={label}>
            {label}
          </span>
          {isOpen ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover/fold:opacity-100" />
          )}
        </span>
      </button>
      {isOpen ? (
        <FadeScroll className={paneClass} follow={follow}>
          {children}
        </FadeScroll>
      ) : null}
    </div>
  );
}
