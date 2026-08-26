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
    background: "#dce4ee",
    primaryColor: "#f7f9fc",
    primaryTextColor: "#1a2330",
    primaryBorderColor: "#3a6d9a",
    secondaryColor: "#e6edf5",
    secondaryTextColor: "#1a2330",
    secondaryBorderColor: "#c3cedb",
    tertiaryColor: "#d4deeb",
    tertiaryTextColor: "#1a2330",
    tertiaryBorderColor: "#c3cedb",
    lineColor: "#5a6876",
    textColor: "#1a2330",
    mainBkg: "#f7f9fc",
    nodeBorder: "#3a6d9a",
    clusterBkg: "#e6edf5",
    clusterBorder: "#c3cedb",
    titleColor: "#1a2330",
    edgeLabelBackground: "#f7f9fc",
    actorBkg: "#f7f9fc",
    actorBorder: "#3a6d9a",
    actorTextColor: "#1a2330",
    signalColor: "#5a6876",
    labelBoxBkgColor: "#f7f9fc",
    labelTextColor: "#1a2330",
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
