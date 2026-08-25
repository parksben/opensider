import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";

function fenceLanguage(className?: string): string | undefined {
  const match = /language-([a-z0-9+-]+)/i.exec(className ?? "");
  return match?.[1]?.toLowerCase();
}

function codeText(node: ReactNode): string {
  if (!isValidElement<{ children?: ReactNode; className?: string }>(node)) return "";
  return String(node.props.children ?? "").replace(/\n$/, "");
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
}
