import { useEffect, useId, useState } from "react";
import type mermaidApi from "mermaid";
import type { ResolvedTheme } from "../theme";

const mermaidThemes: Record<ResolvedTheme, Record<string, string>> = {
  dark: {
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
    lineColor: "#a39b84",
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
    signalColor: "#a39b84",
    labelBoxBkgColor: "#1b1e16",
    labelTextColor: "#ece6d4",
  },
  light: {
    background: "#e8e0c8",
    primaryColor: "#fffdf6",
    primaryTextColor: "#1a1812",
    primaryBorderColor: "#8a5f16",
    secondaryColor: "#efe8d4",
    secondaryTextColor: "#1a1812",
    secondaryBorderColor: "#c9bfa4",
    tertiaryColor: "#e4d9b8",
    tertiaryTextColor: "#1a1812",
    tertiaryBorderColor: "#c9bfa4",
    lineColor: "#5a5346",
    textColor: "#1a1812",
    mainBkg: "#fffdf6",
    nodeBorder: "#8a5f16",
    clusterBkg: "#efe8d4",
    clusterBorder: "#c9bfa4",
    titleColor: "#1a1812",
    edgeLabelBackground: "#fffdf6",
    actorBkg: "#fffdf6",
    actorBorder: "#8a5f16",
    actorTextColor: "#1a1812",
    signalColor: "#5a5346",
    labelBoxBkgColor: "#fffdf6",
    labelTextColor: "#1a1812",
  },
};

let mermaid: typeof mermaidApi | undefined;
let applied: ResolvedTheme | undefined;

async function loadMermaid(theme: ResolvedTheme): Promise<typeof mermaidApi> {
  if (!mermaid) {
    mermaid = (await import("mermaid")).default;
  }
  if (applied !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: theme === "light" ? "base" : "dark",
      fontFamily: '"IBM Plex Sans", sans-serif',
      themeVariables: mermaidThemes[theme],
    });
    applied = theme;
  }
  return mermaid;
}

function useDocumentTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);
  return theme;
}

function sweepMermaidOrphans(renderId?: string) {
  if (renderId) {
    document.getElementById(renderId)?.remove();
    document.getElementById(`d${renderId}`)?.remove();
  }
  document.querySelectorAll('svg[aria-roledescription="error"], [id^="dcs-mmd-"]').forEach((node) => {
    if (node.closest(".cs-mermaid")) return;
    node.remove();
  });
}

export function MermaidBlock({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const chart = source.replace(/\n$/, "");
  const theme = useDocumentTheme();
  const [svg, setSvg] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let renderId = "";
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const api = await loadMermaid(theme);
          const parsed = await api.parse(chart, { suppressErrors: true });
          if (!parsed) {
            sweepMermaidOrphans();
            if (!cancelled) setSvg(undefined);
            return;
          }
          renderId = `cs-mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
          const result = await api.render(renderId, chart);
          sweepMermaidOrphans(renderId);
          if (!cancelled) setSvg(result.svg);
        } catch {
          sweepMermaidOrphans(renderId);
          if (!cancelled) setSvg(undefined);
        }
      })();
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      sweepMermaidOrphans(renderId);
    };
  }, [chart, reactId, theme]);

  if (!svg) {
    return (
      <pre>
        <code className="language-mermaid">{chart}</code>
      </pre>
    );
  }

  return <div className="cs-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
