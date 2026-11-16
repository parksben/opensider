import { Children, isValidElement, memo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openAgentLink, type LinkPage } from "../open-link";
import { MermaidBlock } from "./MermaidBlock";

function fenceLanguage(className?: string): string | undefined {
  const match = /language-([a-z0-9+-]+)/i.exec(className ?? "");
  return match?.[1]?.toLowerCase();
}

function codeText(node: ReactNode): string {
  if (!isValidElement<{ children?: ReactNode; className?: string }>(node)) return "";
  return String(node.props.children ?? "").replace(/\n$/, "");
}

/**
 * `variant="doc"` 只用于产物预览页（`ArtifactPreview`）：那一页是「读文档」，标题要
 * 有层级、字号更大；聊天里的消息保持原来的紧凑样式，不加 `prose`。
 */
export const Markdown = memo(function Markdown({
  text,
  page,
  variant = "chat",
}: {
  text: string;
  page?: LinkPage;
  variant?: "chat" | "doc";
}) {
  const onLink = (event: MouseEvent<HTMLAnchorElement>, href?: string) => {
    event.preventDefault();
    const forceNewTab = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    void openAgentLink(href ?? "", page, forceNewTab);
  };

  // GFM 的删除线只认 `~~`，但 micromark 默认把单个 `~` 也当成删除线，会把
  // 「约 2~3 个工作日…再 2~3 个工作日」这类文案整段划掉。关掉单波浪号后这类内容
  // 原样输出，`~~删掉~~` 仍然生效。
  return (
    <div className={variant === "doc" ? "markdown prose md-doc" : "markdown"}>
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        components={{
          a({ href, children }) {
            return (
              <a href={href} onClick={(event) => onLink(event, href)}>
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="cs-md-table">
                <table>{children}</table>
              </div>
            );
          },
          pre({ children }) {
            const code = Children.toArray(children).find((child) => isValidElement(child));
            if (
              isValidElement<{ className?: string }>(code) &&
              fenceLanguage(code.props.className) === "mermaid"
            ) {
              return <MermaidBlock source={codeText(code)} />;
            }
            return <pre>{children}</pre>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}, (prev, next) =>
  prev.text === next.text &&
  prev.variant === next.variant &&
  prev.page?.tabId === next.page?.tabId &&
  prev.page?.url === next.page?.url);
