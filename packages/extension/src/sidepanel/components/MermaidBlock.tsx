import { memo } from "react";
import { renderFlowchartSvg } from "../flowchart-svg";

export const MermaidBlock = memo(function MermaidBlock({ source }: { source: string }) {
  const chart = source.replace(/\n$/, "");
  const svg = renderFlowchartSvg(chart);
  if (!svg) {
    return (
      <pre>
        <code className="language-mermaid">{chart}</code>
      </pre>
    );
  }
  return <div className="cs-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
});
