/**
 * The "●" an under-control tab carries in its own title, so the user can see which tab the
 * Agent really works in even while it is in the background.
 *
 * The page owns `document.title` and keeps rewriting it (SPAs on every route change), so
 * the mark is re-applied from a MutationObserver for as long as control lasts. Only the
 * one mark we added ourselves is ever stripped: a title that happened to start with "●"
 * before is left alone.
 */

export const CONTROL_MARK = "● ";

export type ControlMark = {
  set(on: boolean): boolean;
  read(): boolean;
};

export function createControlMark(doc: Document): ControlMark {
  let controlled = false;
  let added = false;
  let observer: MutationObserver | undefined;

  function sync(): void {
    if (!controlled) return;
    if (doc.title.startsWith(CONTROL_MARK)) return;
    doc.title = CONTROL_MARK + doc.title;
    added = true;
  }

  function watch(on: boolean): void {
    if (on) {
      if (observer || typeof MutationObserver === "undefined") return;
      observer = new MutationObserver(() => {
        if (!controlled) return;
        sync();
      });
      const target = doc.head ?? doc.documentElement;
      observer.observe(target, { subtree: true, childList: true, characterData: true });
      return;
    }
    observer?.disconnect();
    observer = undefined;
  }

  return {
    set(on: boolean): boolean {
      controlled = on;
      if (on) {
        sync();
        watch(true);
      } else {
        if (added && doc.title.startsWith(CONTROL_MARK)) {
          doc.title = doc.title.slice(CONTROL_MARK.length);
        }
        added = false;
        watch(false);
      }
      return true;
    },
    read(): boolean {
      return controlled;
    },
  };
}
