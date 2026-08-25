import { useEffect, useId, useState } from "react";
import type mermaidApi from "mermaid";

let mermaid: typeof mermaidApi | undefined;
let ready = false;

async function loadMermaid(): Promise<typeof mermaidApi> {
  if (!mermaid) {
    mermaid = (await import("mermaid")).default;
  }
  if (!ready) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: '"IBM Plex Sans", sans-serif',
      themeVariables: {
        background: "#10120c",
        primaryColor: "#1b1e16",
        primaryTextColor: "#ece6d4",
        primaryBorderColor: "#d4a054",
        secondaryColor: "#14160f",
        secondaryTextColor: "#ece6d4",
        secondaryBorderColor: "#2c3124",
        tertiaryColor: "#262318",
        tertiaryTextColor: "#ece6d4",
        tertiaryBorderColor: "#2c3124",
        lineColor: "#8f8872",
        textColor: "#ece6d4",
        mainBkg: "#1b1e16",
        nodeBorder: "#d4a054",
        clusterBkg: "#14160f",
        clusterBorder: "#2c3124",
        titleColor: "#ece6d4",
        edgeLabelBackground: "#14160f",
        actorBkg: "#1b1e16",
        actorBorder: "#d4a054",
        actorTextColor: "#ece6d4",
        signalColor: "#8f8872",
        labelBoxBkgColor: "#1b1e16",
        labelTextColor: "#ece6d4",
      },
    });
    ready = true;
  }
  return mermaid;
}

export function MermaidBlock({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const chart = source.replace(/\n$/, "");
  const [svg, setSvg] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const api = await loadMermaid();
          const id = `cs-mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
          const result = await api.render(id, chart);
          if (!cancelled) setSvg(result.svg);
        } catch {
          if (!cancelled) setSvg(undefined);
        }
      })();
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chart, reactId]);

  if (!svg) {
    return (
      <pre>
        <code className="language-mermaid">{chart}</code>
      </pre>
    );
  }

  return <div className="cs-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
