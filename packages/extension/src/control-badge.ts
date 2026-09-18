/**
 * The status an under-control tab carries in its own title, so the user can find it even
 * while it is in the background — and the helper that hides it everywhere else.
 *
 * The page owns `document.title` and keeps rewriting it (SPAs on every route change), so
 * the mark is re-applied from a MutationObserver for as long as control lasts. Only the
 * one mark we added ourselves is ever stripped: a title that happened to start with a
 * bracket label before is left alone.
 *
 * The label follows the *browser's* UI language (the tab strip is browser chrome, not the
 * side panel). Everything OpenSider writes or shows — the banner, borrow cards, workspace
 * files, the mention menu — runs the title through `stripControlMark` first.
 */

/** Marks we may have written; `stripControlMark` knows all of them, whatever the locale. */
export const CONTROL_MARKS = ["[接管中] ", "[Agent] "] as const;

const DEFAULT_MARK = "[Agent] ";

/** The label for one UI language tag. */
export function controlMarkFor(uiLanguage: string): string {
  return /^zh([-_]|$)/i.test(uiLanguage.trim()) ? "[接管中] " : DEFAULT_MARK;
}

function browserMark(): string {
  try {
    const language =
      typeof chrome !== "undefined" && typeof chrome.i18n?.getUILanguage === "function"
        ? chrome.i18n.getUILanguage()
        : "";
    return controlMarkFor(language);
  } catch {
    return DEFAULT_MARK;
  }
}

/** Remove our status prefix (either locale) before showing or handing a title on. */
export function stripControlMark(title: string): string {
  for (const mark of CONTROL_MARKS) {
    if (title.startsWith(mark)) return title.slice(mark.length);
  }
  return title;
}

export type ControlMark = {
  set(on: boolean): boolean;
  read(): boolean;
};

export function createControlMark(doc: Document): ControlMark {
  const mark = browserMark();
  let controlled = false;
  let added = false;
  let observer: MutationObserver | undefined;

  function sync(): void {
    if (!controlled) return;
    if (doc.title.startsWith(mark)) return;
    doc.title = mark + doc.title;
    added = true;
  }

  function watch(on: boolean): void {
    if (on) {
      if (observer || typeof MutationObserver === "undefined") return;
      const target = doc.head ?? doc.documentElement;
      if (!target) return;
      observer = new MutationObserver(() => {
        if (!controlled) return;
        sync();
      });
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
        if (added && doc.title.startsWith(mark)) {
          doc.title = doc.title.slice(mark.length);
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
