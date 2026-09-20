import type { AgentOption } from "@shared";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { COMPOSER_ICON_PX } from "../layout";
import { RippleButton } from "./RippleButton";
import { useRipple } from "../useRipple";

/**
 * 推理档位（引擎自己的思考/努力程度，ACP 里是 `category: "thought_level"`）。
 *
 * 与模式下拉同构，纪律也一样：
 *  - 数据来自引擎的会话广告（见 internal/sessioncfg），**一项都不编**；
 *  - 少于两个值**不渲染**（一项等于没得选）；引擎不广告这个类别就整个控件不出现
 *    （Copilot CLI 与 OpenCode 至今都没有这一类）；
 *  - 名称与值名**原样用引擎给的**（Claude 是 `Effort` + `Default/Low/High/Max`），
 *    只做首字母大写当排版，不翻译、不造译名。
 *
 * **它不带图标**：档位名（`Xhigh` / `Medium`）就是用户唯一要看的信息，图标既挤不掉
 * 多余的宽度、又要跟模式 / 权限那两个下拉抢地方。带上图标时，窄宽度下 48px 里被
 * 「内边距 16 + 图标 14 + 间距 4」吃掉，标签只剩 14px——连一个省略号都排不下，看着
 * 就是硬切。所以这里**不设人为上限**：钮跟着内容走，只有整行真的挤不下时才省略。
 */

function displayName(name: string) {
  const trimmed = (name || "").trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function tooltipOf(option: AgentOption, currentId: string) {
  const label = displayName(option.name || option.id);
  const value = option.values?.find((item) => item.id === currentId);
  const valueName = value ? displayName(value.name || value.id) : currentId;
  return valueName ? `${label} — ${valueName}` : label;
}

export function AgentOptionSelect({
  option,
  onValue,
}: {
  option: AgentOption | undefined;
  onValue: (configId: string, value: string) => void;
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

  // 布尔项没有值名可列（界面上没法选「真/假」），少于两项也没有可选的余地。
  const values = option?.values ?? [];
  if (!option || values.length < 2) return null;

  const currentId = option.current ?? values[0].id;
  const current = values.find((value) => value.id === currentId) ?? values[0];
  const tip = tooltipOf(option, current.id);

  return (
    <div ref={rootRef} className="relative min-w-0 shrink">
      <button
        type="button"
        title={tip}
        aria-label={tip}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => spawn(event)}
        className="relative flex h-7 w-fit max-w-full min-w-0 items-center overflow-hidden whitespace-nowrap rounded-full px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]"
      >
        <span className="min-w-0 truncate">{displayName(current.name || current.id)}</span>
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
        <div className="absolute right-0 bottom-full z-[80] mb-1.5 w-48 rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
          <p className="px-2.5 py-1 text-[11px] text-[var(--muted)]">{displayName(option.name || option.id)}</p>
          {values.map((value) => {
            const active = value.id === current.id;
            return (
              <RippleButton
                key={value.id}
                title={value.desc ? `${displayName(value.name || value.id)} — ${value.desc}` : undefined}
                onClick={() => {
                  onValue(option.id, value.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] ${
                  active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <Check size={COMPOSER_ICON_PX} className={active ? "shrink-0" : "shrink-0 opacity-0"} />
                <span className="min-w-0 truncate">{displayName(value.name || value.id)}</span>
              </RippleButton>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
