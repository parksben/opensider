import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Markdown } from "../sidepanel/components/Markdown";
import { applyLocale, t, type Locale } from "../sidepanel/i18n";
import { applyThemePreference, type ThemePreference } from "../sidepanel/theme";

/**
 * 划词工具条的**结果层**页面（跑在一个 iframe 里，由页面内的工具条装上去）。
 *
 * 为什么是一个扩展页而不是在内容脚本里自研渲染：搜索结果要给 Markdown（含代码块），而渲染
 * 器就在侧栏那个 React 包里。做成独立页面还能把样式两个方向都隔开：页面的 CSS 进不来、我们
 * 的 CSS 也漏不出去。
 *
 * 通信（全部走 postMessage，两个方向都用 source 字段自证身份）：
 *   - 父层 → 这里：`{kind, state, text, locale, theme}` 状态；`{copied}` 复制反馈
 *   - 这里 → 父层：`{height}` 高度上报（父层据此夹在视口内）；`{action:"copy", text}` 请求复制
 *
 * 复制动作由父层（内容脚本）执行：它才是页面上下文里那个能拿到剪贴板的对象。
 */

type Kind = "translate" | "search";
type State = "loading" | "ready" | "error";

type Payload = {
  source?: string;
  kind?: Kind;
  state?: State;
  text?: string;
  locale?: Locale;
  theme?: "dark" | "light";
  copied?: boolean;
};

export function SelectionResult() {
  const [kind, setKind] = useState<Kind>("translate");
  const [state, setState] = useState<State>("loading");
  const [text, setText] = useState("");
  const [locale, setLocale] = useState<Locale>("en");
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Payload | undefined;
      if (!data || data.source !== "opensider-selection") return;
      if (typeof data.copied === "boolean") {
        setCopied(data.copied);
        return;
      }
      if (data.kind) setKind(data.kind);
      if (data.state) setState(data.state);
      if (typeof data.text === "string") setText(data.text);
      if (data.locale === "zh" || data.locale === "en") setLocale(data.locale);
      applyThemePreference((data.theme ?? "dark") as ThemePreference);
      applyLocale(data.locale === "zh" ? "zh" : "en");
    };
    window.addEventListener("message", onMessage);
    // 先告诉父层「我起来了」：它可能是先推状态、后加载完的。
    window.parent.postMessage({ source: "opensider-selection-result", ready: true }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 高度上报：父层用它把结果层按行数夹紧（超出就由正文区自己滚）。
  //
  // **不能**再量 `root.scrollHeight`：卡片现在占满父层给的 100% 高度，那个值恒等于 iframe
  // 高度，父层就永远长不高/缩不回去。改成逐块相加：上下 padding + gap + 标题栏高 + 正文
  // 内容高——都与 iframe 当前高度无关，报出来的就是「内容真正需要多高」。
  useLayoutEffect(() => {
    const node = rootRef.current;
    const head = headRef.current;
    const content = contentRef.current;
    if (!node || !head || !content) return;
    const report = () => {
      const style = getComputedStyle(node);
      const paddings = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const gap = parseFloat(style.rowGap) || 0;
      window.parent.postMessage(
        { source: "opensider-selection-result", height: paddings + gap + head.offsetHeight + content.offsetHeight },
        "*",
      );
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(head);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const title = kind === "search" ? t(locale, "selectionSearchTitle") : t(locale, "selectionTranslateTitle");
  const busy = state === "loading";
  const failed = state === "error";

  return (
    <div ref={rootRef} className="cs-selection-result">
      <div ref={headRef} className="cs-selection-head">
        <span className="cs-selection-title">{title}</span>
        {state === "ready" && text ? (
          <button
            type="button"
            className="cs-selection-copy"
            onClick={() => window.parent.postMessage({ source: "opensider-selection-result", action: "copy", text }, "*")}
          >
            {/* 与侧栏那条回复底部的复制钮同一形态：图标 + 文案。 */}
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? t(locale, "copiedReply") : t(locale, "copyReply")}
          </button>
        ) : null}
      </div>
      <div className="cs-selection-body">
        <div ref={contentRef} className="cs-selection-content">
          {busy ? (
            <p className="cs-selection-muted">
              {kind === "search" ? t(locale, "selectionSearching") : t(locale, "selectionTranslating")}
            </p>
          ) : failed ? (
            <p className="cs-selection-error">
              {kind === "search" ? t(locale, "selectionSearchFailed") : t(locale, "selectionTranslateFailed")}
            </p>
          ) : kind === "search" ? (
            <Markdown text={text} />
          ) : (
            <p className="cs-selection-text">{text}</p>
          )}
        </div>
      </div>
    </div>
  );
}
