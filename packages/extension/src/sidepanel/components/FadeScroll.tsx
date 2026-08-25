import { useEffect, useRef, useState, type ReactNode } from "react";

function edgesOf(node: HTMLElement): { top: boolean; bottom: boolean } {
  return {
    top: node.scrollTop > 2,
    bottom: node.scrollHeight - node.clientHeight - node.scrollTop > 2,
  };
}

export function FadeScroll({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const sync = () => {
    const node = ref.current;
    if (!node) {
      setEdges({ top: false, bottom: false });
      return;
    }
    setEdges(edgesOf(node));
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    const mutations = new MutationObserver(sync);
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [children]);

  return (
    <div className="cs-process">
      <div ref={ref} className={className} onScroll={sync}>
        {children}
      </div>
      <div className={`cs-process-scrim cs-process-scrim-top${edges.top ? " is-on" : ""}`} />
      <div className={`cs-process-scrim cs-process-scrim-bottom${edges.bottom ? " is-on" : ""}`} />
    </div>
  );
}
