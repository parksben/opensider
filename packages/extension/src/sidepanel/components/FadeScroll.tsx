import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { paneFollowsBottom } from "./pane-follow";

function edgesOf(node: HTMLElement): { top: boolean; bottom: boolean } {
  return {
    top: node.scrollTop > 2,
    bottom: node.scrollHeight - node.clientHeight - node.scrollTop > 2,
  };
}

/**
 * Keeps a streamed scroll pane pinned to its bottom while the user is already there.
 *
 * A running tool call prints its result line by line and a thinking block streams its
 * reasoning; both must be followed without the user scrolling by hand. Scrolling up
 * releases the follow (they are reading what just went past), and only coming back to the
 * exact bottom picks it up again.
 *
 * `active` is off for panes that only ever show settled content: those open where they
 * were left instead of jumping to the end.
 */
function usePaneFollow(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || !active) return;
    const stick = () => {
      if (!following.current) return;
      node.scrollTop = node.scrollHeight;
    };
    stick();
    const resized = new ResizeObserver(stick);
    resized.observe(node);
    // New lines change `scrollHeight` without resizing the box, so this is what actually
    // hears about the stream. (The box itself is a fixed `max-height`.)
    const mutations = new MutationObserver(stick);
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      resized.disconnect();
      mutations.disconnect();
    };
  }, [active]);

  const onScroll = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    following.current = paneFollowsBottom(node.scrollHeight, node.clientHeight, node.scrollTop);
  }, []);

  return { ref, onScroll };
}

export function FadeScroll({
  className,
  children,
  follow,
}: {
  className: string;
  children: ReactNode;
  /** Follow the stream while it prints (a running tool call / thinking block). */
  follow?: boolean;
}) {
  const pane = usePaneFollow(Boolean(follow));
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const sync = () => {
    const node = pane.ref.current;
    if (!node) {
      setEdges({ top: false, bottom: false });
      return;
    }
    setEdges(edgesOf(node));
  };

  useEffect(() => {
    const node = pane.ref.current;
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
    // Re-arm on a new pane of content, the way this component always has.
  }, [children]);

  const onScroll = () => {
    pane.onScroll();
    sync();
  };

  return (
    <div className="cs-process">
      <div ref={pane.ref} className={className} onScroll={onScroll}>
        {children}
      </div>
      <div className={`cs-process-scrim cs-process-scrim-top${edges.top ? " is-on" : ""}`} />
      <div className={`cs-process-scrim cs-process-scrim-bottom${edges.bottom ? " is-on" : ""}`} />
    </div>
  );
}
