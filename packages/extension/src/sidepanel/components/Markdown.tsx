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

export const Markdown = memo(function Markdown({ text, page }: { text: string; page?: LinkPage }) {
  const onLink = (event: MouseEvent<HTMLAnchorElement>, href?: string) => {
    event.preventDefault();
    const forceNewTab = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    void openAgentLink(href ?? "", page, forceNewTab);
  };

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
}, (prev, next) => prev.text === next.text && prev.page?.tabId === next.page?.tabId && prev.page?.url === next.page?.url);
