import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  atMenuLock,
  blockEnterEvent,
  isEnterKey,
  shouldBlockSubmit,
} from "../at-menu-lock";
import { consumeAtBeforeCaret, readAtQuery } from "../at-query";
import { consumeSlashBeforeCaret, readSlashQuery } from "../slash-query";
import {
  coversWholeEditor,
} from "../composer-clipboard";
import {
  parseMentionSegments,
  parseMentionToken,
  serializeMention,
  type MentionChip,
  type SkillMention,
} from "../mentions";
import { MentionChip as MentionChipView } from "./MentionChip";

export const CHIP_WRAP = "cs-mention-wrap";

export type ComposerHandle = {
  focus: () => void;
  insertAtStart: (text: string) => void;
  insertMention: (mention: MentionChip) => void;
  /**
   * 插入一枚芯片，但**不抢焦点**：聚焦时插到光标处，没聚焦时追加到正文末尾。划词工具条的
   * 「引用」用它——用户可能还在网页上看，focus() 会把注意力硬拽回侧栏。
   */
  appendMention: (mention: MentionChip) => void;
  /** 插到正文最前面（skill 芯片的前缀只有落在最前才会被 CLI 当 skill 调用）。 */
  insertSkill: (mention: SkillMention) => void;
  moveCaretToEnd: () => void;
  getSerialized: () => string;
  getCaretRect: () => DOMRect | undefined;
  getAtQuery: () => string | null;
  getSlashQuery: () => string | null;
};

function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const images = (files: File[]) => files.filter((file) => file.type.startsWith("image/"));
  const fromFiles = images(Array.from(data.files));
  if (fromFiles.length > 0) return fromFiles;
  return images(
    Array.from(data.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null),
  );
}

function serializeEditor(editor: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\u200b/g, "");
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.classList.contains(CHIP_WRAP)) {
        out += node.dataset.token ?? "";
        return;
      }
      if (node.tagName === "BR") {
        out += "\n";
        return;
      }
      if ((node.tagName === "DIV" || node.tagName === "P") && node !== editor && out.length > 0 && !out.endsWith("\n")) {
        out += "\n";
      }
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(editor);
  return out;
}

function isEditorEmpty(serialized: string): boolean {
  return serialized.replace(/\u200b/g, "").trim().length === 0;
}

function placeCaretAtStart(editor: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(editor, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function resetEmptyEditor(editor: HTMLElement): void {
  editor.innerHTML = "";
  editor.dataset.empty = "true";
  placeCaretAtStart(editor);
}

function createChipWrap(mention: MentionChip): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = CHIP_WRAP;
  wrap.contentEditable = "false";
  wrap.dataset.token = serializeMention(mention);
  return wrap;
}

function isPadSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\u00a0";
}

function lastCharOfNode(node: Node | null): string | undefined {
  if (!node) return undefined;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] !== "\u200b") return text[i];
    }
    return undefined;
  }
  if (node instanceof HTMLElement && node.classList.contains(CHIP_WRAP)) return "\0";
  if (node.nodeName === "BR") return "\n";
  for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
    const ch = lastCharOfNode(node.childNodes[i] ?? null);
    if (ch !== undefined) return ch;
  }
  return undefined;
}

function firstCharOfNode(node: Node | null): string | undefined {
  if (!node) return undefined;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "\u200b") return text[i];
    }
    return undefined;
  }
  if (node instanceof HTMLElement && node.classList.contains(CHIP_WRAP)) return "\0";
  if (node.nodeName === "BR") return "\n";
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const ch = firstCharOfNode(node.childNodes[i] ?? null);
    if (ch !== undefined) return ch;
  }
  return undefined;
}

function charBeforeRange(range: Range, editor: HTMLElement): string | undefined {
  const container = range.startContainer;
  const offset = range.startOffset;
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent ?? "";
    for (let i = offset - 1; i >= 0; i -= 1) {
      if (text[i] !== "\u200b") return text[i];
    }
    let node: Node | null = container;
    while (node && node !== editor) {
      const prev = node.previousSibling;
      if (prev) return lastCharOfNode(prev);
      node = node.parentNode;
    }
    return undefined;
  }
  if (offset > 0) return lastCharOfNode(container.childNodes[offset - 1] ?? null);
  let node: Node | null = container;
  while (node && node !== editor) {
    const prev = node.previousSibling;
    if (prev) return lastCharOfNode(prev);
    node = node.parentNode;
  }
  return undefined;
}

function charAfterRange(range: Range, editor: HTMLElement): string | undefined {
  const container = range.startContainer;
  const offset = range.startOffset;
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent ?? "";
    for (let i = offset; i < text.length; i += 1) {
      if (text[i] !== "\u200b") return text[i];
    }
    let node: Node | null = container;
    while (node && node !== editor) {
      const next = node.nextSibling;
      if (next) return firstCharOfNode(next);
      node = node.parentNode;
    }
    return undefined;
  }
  if (offset < container.childNodes.length) return firstCharOfNode(container.childNodes[offset] ?? null);
  let node: Node | null = container;
  while (node && node !== editor) {
    const next = node.nextSibling;
    if (next) return firstCharOfNode(next);
    node = node.parentNode;
  }
  return undefined;
}

function placeCaret(node: Node, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 用户此刻的光标/选区是否就在编辑器里（"聚焦在输入框" 的判据）。 */
function liveRangeInEditor(editor: HTMLElement): Range | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  return editor.contains(range.startContainer) ? range.cloneRange() : undefined;
}

/** 正文末尾的空范围（未聚焦时插入芯片用）。 */
function endRange(editor: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

function placeCaretAfterChip(wrap: HTMLElement): Range {
  const range = document.createRange();
  const next = wrap.nextSibling;
  if (next?.nodeType === Node.TEXT_NODE) {
    range.setStart(next, Math.min(1, next.textContent?.length ?? 0));
  } else {
    range.setStartAfter(wrap);
  }
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function chipWrapFromEvent(target: EventTarget | null, editor: HTMLElement | null): HTMLElement | null {
  if (!(target instanceof Element) || !editor) return null;
  const wrap = target.closest(`.${CHIP_WRAP}`);
  return wrap instanceof HTMLElement && editor.contains(wrap) ? wrap : null;
}

/**
 * 光标所在位置的屏幕矩形。
 *
 * 折叠的 Range 在几种常见情形下会给出全 0 的矩形：刚敲回车产生的空行、停在元素
 * 边界（两个芯片之间）、以及内容末尾。而这几种恰好就是最需要滚动的时刻。
 *
 * 退路是「借相邻内容量一次」，不是往 DOM 里插标记：这个测量跑在 selectionchange
 * 上，每次移动光标都会触发，而 insertNode 会拆分文本节点、动到用户正在编辑的树。
 */
function caretRect(range: Range): DOMRect | undefined {
  const rects = range.getClientRects();
  const direct = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
  if (direct.height > 0 || direct.width > 0) return direct;

  const container = range.startContainer;
  const offset = range.startOffset;

  // 文本节点里：往前借一个字符，取它的右边缘当光标位置。
  if (container.nodeType === Node.TEXT_NODE && offset > 0) {
    const probe = range.cloneRange();
    probe.setStart(container, offset - 1);
    probe.setEnd(container, offset);
    const rect = probe.getBoundingClientRect();
    if (rect.height > 0) return new DOMRect(rect.right, rect.top, 0, rect.height);
  }

  // 元素边界上（空行、芯片之间）：用光标前后那个子节点的矩形。
  const element = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  const children = element?.childNodes;
  if (children && children.length > 0) {
    const neighbour = children[Math.min(offset, children.length - 1)];
    const box =
      neighbour.nodeType === Node.ELEMENT_NODE
        ? (neighbour as Element).getBoundingClientRect()
        : (() => {
            const probe = document.createRange();
            probe.selectNodeContents(neighbour);
            return probe.getBoundingClientRect();
          })();
    if (box.height > 0) return box;
  }

  // 最后退到编辑器里那一行的容器本身。
  const fallback = element?.getBoundingClientRect();
  return fallback && fallback.height > 0 ? fallback : undefined;
}

/**
 * Keep the caret inside the composer's own scroller.
 *
 * A collapsed caret often has no box, and a multi-line paste's line boxes are
 * frequently not laid out until the next frame — a rect taken in the same turn
 * still sits on the old line and looks "already visible", so the scroller never
 * moves. Drop a probe on the caret, scroll to that, and measure again after layout.
 */
function scrollCaret(editor: HTMLElement): void {
  const token = String(Number(editor.dataset.scrollToken ?? "0") + 1);
  editor.dataset.scrollToken = token;
  const run = () => {
    if (!editor.isConnected || editor.dataset.scrollToken !== token) return;
    revealCaret(editor);
  };
  run();
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

function nudgeScroll(editor: HTMLElement, rect: DOMRect): void {
  const box = editor.getBoundingClientRect();
  const slack = 4;
  if (rect.bottom > box.bottom - 1) editor.scrollTop += rect.bottom - box.bottom + slack;
  else if (rect.top < box.top + 1) editor.scrollTop -= box.top - rect.top + slack;
}

function revealCaret(editor: HTMLElement): void {
  // An active IME composition owns its text node: dropping a probe into it (and
  // merging the halves back) aborts the composition. Leave it alone.
  if (editor.dataset.composing === "true") return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  // A live, non-empty selection belongs to the user — double/triple-click,
  // Shift+Arrow, or a drag. Measure it, but never insert a probe or collapse it
  // back to a caret.
  if (!range.collapsed) {
    const rect = caretRect(range);
    if (rect) nudgeScroll(editor, rect);
    return;
  }

  const marker = document.createElement("span");
  marker.setAttribute("data-caret-probe", "");
  marker.textContent = "\u200b";
  marker.style.display = "inline-block";
  marker.style.width = "0";
  const probe = range.cloneRange();
  probe.collapse(true);
  const container = probe.startContainer;
  const offset = probe.startOffset;
  probe.insertNode(marker);

  const slack = 4;
  const line = marker.offsetHeight || parseFloat(getComputedStyle(editor).lineHeight) || 20;
  const top = topWithin(marker, editor);
  if (top != null) {
    // Absolute, not a delta: a paste can land many lines below the fold, and a
    // second measurement must replace the scroll position rather than add to it.
    const bottom = top + line;
    const viewBottom = editor.scrollTop + editor.clientHeight;
    if (bottom > viewBottom - slack) editor.scrollTop = bottom - editor.clientHeight + slack;
    else if (top < editor.scrollTop + slack) editor.scrollTop = Math.max(0, top - slack);
  } else {
    const rect = marker.getBoundingClientRect();
    const box = editor.getBoundingClientRect();
    const rectTop = rect.height > 0 ? rect.top : box.top;
    const rectBottom = rect.height > 0 ? rect.bottom : rectTop + line;
    if (rectBottom > box.bottom - 1) editor.scrollTop += rectBottom - box.bottom + slack;
    else if (rectTop < box.top + 1) editor.scrollTop -= box.top - rectTop + slack;
  }

  const parent = marker.parentNode;
  const next = marker.nextSibling;
  marker.remove();
  restoreCaret(selection, container, offset, parent, next);
}

/** Distance from the top of `editor`'s content to `node`, or null if it isn't inside. */
function topWithin(node: HTMLElement, editor: HTMLElement): number | null {
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== editor) {
    top += current.offsetTop;
    const parent = current.offsetParent as HTMLElement | null;
    if (!parent) return null;
    current = parent;
  }
  return current === editor ? top : null;
}

function restoreCaret(
  selection: Selection,
  container: Node,
  offset: number,
  parent: Node | null,
  next: Node | null,
): void {
  const place = (node: Node, index: number) => {
    const restored = document.createRange();
    const max = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").length : node.childNodes.length;
    restored.setStart(node, Math.min(Math.max(index, 0), max));
    restored.collapse(true);
    selection.removeAllRanges();
    selection.addRange(restored);
  };
  if (container.nodeType === Node.TEXT_NODE && container.parentNode) {
    const right = container.nextSibling;
    if (right && right.nodeType === Node.TEXT_NODE) {
      const caret = Math.min(offset, (container.textContent ?? "").length);
      container.textContent = (container.textContent ?? "") + (right.textContent ?? "");
      right.parentNode?.removeChild(right);
      place(container, caret);
      return;
    }
    place(container, offset);
    return;
  }
  if (next && parent?.contains(next)) {
    const restored = document.createRange();
    restored.setStartBefore(next);
    restored.collapse(true);
    selection.removeAllRanges();
    selection.addRange(restored);
    return;
  }
  if (parent) place(parent, parent.childNodes.length);
}

export const ComposerEditor = forwardRef<
  ComposerHandle,
  {
    value: string;
    placeholder: string;
    menuOpen?: boolean;
    /** The `/` skill probe menu is open (see SlashMenu): it takes the same key gate as `@`. */
    slashMenuOpen?: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onPasteImages: (files: File[]) => void;
    /** Called on copy/cut only when the selection covers the whole composer. */
    onComposerClipboardCarry?: () => void;
    /** The plain text a paste is about to insert (before it lands in the editor). */
    onComposerPastedText?: (text: string) => void;
    onAtTyped?: () => void;
    onAtQueryChange?: (query: string | null) => void;
    onSlashTyped?: () => void;
    onSlashQueryChange?: (query: string | null) => void;
  }
>(function ComposerEditor(
  {
    value,
    placeholder,
    menuOpen,
    slashMenuOpen,
    onChange,
    onSubmit,
    onPasteImages,
    onComposerClipboardCarry,
    onComposerPastedText,
    onAtTyped,
    onAtQueryChange,
    onSlashTyped,
    onSlashQueryChange,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const rootsRef = useRef(new Map<HTMLElement, Root>());
  const lastRangeRef = useRef<Range | null>(null);
  const valueRef = useRef(value);
  const menuOpenRef = useRef(menuOpen);
  const slashMenuOpenRef = useRef(slashMenuOpen);
  const onAtQueryChangeRef = useRef(onAtQueryChange);
  const onSlashQueryChangeRef = useRef(onSlashQueryChange);
  valueRef.current = value;
  menuOpenRef.current = menuOpen;
  slashMenuOpenRef.current = slashMenuOpen;
  onAtQueryChangeRef.current = onAtQueryChange;
  onSlashQueryChangeRef.current = onSlashQueryChange;

  /** Either menu owns the keyboard: Enter must insert instead of sending while one is open. */
  const anyMenuOpen = () => Boolean(menuOpenRef.current) || Boolean(slashMenuOpenRef.current);

  const readQueryFromEditor = (reader: (range: Range) => string | null): string | null => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    return reader(range);
  };

  const readAtQueryFromEditor = () => readQueryFromEditor(readAtQuery);
  const readSlashQueryFromEditor = () => readQueryFromEditor(readSlashQuery);

  const syncAtQuery = () => {
    if (slashMenuOpenRef.current) {
      onSlashQueryChangeRef.current?.(readSlashQueryFromEditor());
      return;
    }
    if (!menuOpenRef.current) return;
    onAtQueryChangeRef.current?.(readAtQueryFromEditor());
  };

  const mountChip = (wrap: HTMLSpanElement, mention: MentionChip) => {
    let root = rootsRef.current.get(wrap);
    if (!root) {
      root = createRoot(wrap);
      rootsRef.current.set(wrap, root);
    }
    flushSync(() => {
      root.render(<MentionChipView mention={mention} />);
    });
  };

  /**
   * 在给定位置插一枚芯片：两边按需补空格（免得和相邻文字或芯片粘在一起），后面跟一个零宽
   * 空格好让光标能停在它后面。`insertMention` 与 `appendMention` 共用这一处。
   */
  const insertChipAtRange = (target: HTMLElement, mention: MentionChip, range: Range) => {
    range.deleteContents();
    const needLeft = !isPadSpace(charBeforeRange(range, target));
    const needRight = !isPadSpace(charAfterRange(range, target));
    const wrap = createChipWrap(mention);
    const zwsp = document.createTextNode("\u200b");
    const fragment = document.createDocumentFragment();
    if (needLeft) fragment.appendChild(document.createTextNode(" "));
    fragment.appendChild(wrap);
    if (needRight) fragment.appendChild(document.createTextNode(" "));
    fragment.appendChild(zwsp);
    range.insertNode(fragment);
    mountChip(wrap, parseMentionToken(wrap.dataset.token ?? "") ?? mention);
    placeCaret(zwsp, 1);
  };

  const unmountDetached = () => {
    const editor = editorRef.current;
    for (const [wrap, root] of [...rootsRef.current.entries()]) {
      if (editor?.contains(wrap)) continue;
      queueMicrotask(() => root.unmount());
      rootsRef.current.delete(wrap);
    }
  };

  const emit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    unmountDetached();
    const next = serializeEditor(editor);
    const normalized = isEditorEmpty(next) ? "" : next;
    if (!normalized) {
      resetEmptyEditor(editor);
      lastRangeRef.current = (() => {
        const range = document.createRange();
        range.setStart(editor, 0);
        range.collapse(true);
        return range;
      })();
      if (valueRef.current) onChange("");
      return;
    }
    editor.dataset.empty = "false";
    if (normalized !== valueRef.current) onChange(normalized);
    scrollCaret(editor);
    syncAtQuery();
  };

  const saveRange = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    lastRangeRef.current = range.cloneRange();
    syncAtQuery();
  };

  /**
   * 方向键 / 点击移动光标后把它滚进视野。刻意不放进 `saveRange`：`scrollCaret` 的探针会
   * 重设选区，而 `saveRange` 挂在 `selectionchange` 上，两者互相触发就是一条每秒几千次的
   * 死循环（存下来的 live Range 也会在探针拆分/合并文本节点时漂到 0，粘贴因此总落在最前）。
   * 只有用户事件（keyup / mouseup / input）驱动滚动，自有选区变化不再触发滚动。
   */
  const saveRangeAndScroll = () => {
    saveRange();
    const editor = editorRef.current;
    if (editor) scrollCaret(editor);
  };

  const restoreRange = (): Range | undefined => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return undefined;
    const saved = lastRangeRef.current;
    if (saved && editor.contains(saved.startContainer) && editor.contains(saved.endContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved);
      return saved;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  };

  const hydrate = (next: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const root of rootsRef.current.values()) {
      queueMicrotask(() => root.unmount());
    }
    rootsRef.current.clear();
    editor.innerHTML = "";
    const segments = parseMentionSegments(next);
    if (segments.length === 0) {
      resetEmptyEditor(editor);
      return;
    }
    for (const segment of segments) {
      if (segment.type === "text") {
        const lines = segment.text.split("\n");
        lines.forEach((line, index) => {
          if (line) editor.appendChild(document.createTextNode(line));
          if (index < lines.length - 1) editor.appendChild(document.createElement("br"));
        });
        continue;
      }
      const wrap = createChipWrap(segment.mention);
      editor.appendChild(wrap);
      editor.appendChild(document.createTextNode("\u200b"));
      mountChip(wrap, segment.mention);
    }
    editor.dataset.empty = isEditorEmpty(next) ? "true" : "false";
  };

  const insertSerialized = (raw: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    // 用此刻真实的光标，而不是存下来的 lastRangeRef：探针会拆分/合并文本节点，让它漂到行首，
    // 粘贴就会插到最前面。编辑器持有光标时以它为准，否则退回存储位置（程序化插入）。
    const range = liveRangeInEditor(editor) ?? restoreRange();
    if (!range) return;
    range.deleteContents();
    const segments = parseMentionSegments(raw);
    const nodes: Node[] = [];
    for (const segment of segments) {
      if (segment.type === "text") {
        const lines = segment.text.split("\n");
        lines.forEach((line, index) => {
          if (line) nodes.push(document.createTextNode(line));
          if (index < lines.length - 1) nodes.push(document.createElement("br"));
        });
        continue;
      }
      const wrap = createChipWrap(segment.mention);
      nodes.push(wrap);
      nodes.push(document.createTextNode("\u200b"));
      mountChip(wrap, segment.mention);
    }
    const fragment = document.createDocumentFragment();
    for (const node of nodes) fragment.appendChild(node);
    const last = nodes[nodes.length - 1];
    range.insertNode(fragment);
    if (last) {
      const next = document.createRange();
      next.setStartAfter(last);
      next.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(next);
      lastRangeRef.current = next.cloneRange();
    }
    emit();
  };

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertAtStart: (text) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      lastRangeRef.current = range.cloneRange();
      document.execCommand("insertText", false, text);
      saveRange();
      emit();
    },
    insertMention: (mention) => {
      const editor = editorRef.current;
      const range = restoreRange();
      if (!editor || !range) return;
      consumeAtBeforeCaret(range);
      insertChipAtRange(editor, mention, range);
      saveRange();
      emit();
    },
    appendMention: (mention) => {
      const editor = editorRef.current;
      if (!editor) return;
      // 聚焦时插到光标处；没聚焦时追加到正文末尾。全程不调 focus()：用户可能还在网页上看，
      // 把焦点硬拽回侧栏是打扰。
      insertChipAtRange(editor, mention, liveRangeInEditor(editor) ?? endRange(editor));
      saveRange();
      emit();
    },
    insertSkill: (mention) => {
      const editor = editorRef.current;
      if (!editor) return;
      // 编辑器还持有光标时就插在光标处；否则回到存下来的位置（工具栏 / 钮打开菜单时）。
      const range = liveRangeInEditor(editor) ?? restoreRange();
      if (!range) return;
      consumeSlashBeforeCaret(range);
      insertChipAtRange(editor, mention, range);
      saveRange();
      emit();
    },
    moveCaretToEnd: () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      lastRangeRef.current = range.cloneRange();
      scrollCaret(editor);
    },
    getSerialized: () => (editorRef.current ? serializeEditor(editorRef.current) : ""),
    getCaretRect: () => {
      const saved = lastRangeRef.current;
      if (saved) {
        const rect = caretRect(saved);
        if (rect && (rect.top || rect.left || rect.height || rect.width)) return rect;
      }
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        const rect = rects.item(rects.length - 1) ?? range.getBoundingClientRect();
        if (rect.top || rect.left || rect.height || rect.width) return rect;
      }
      return editorRef.current?.getBoundingClientRect();
    },
    getAtQuery: () => readAtQueryFromEditor(),
    getSlashQuery: () => readSlashQueryFromEditor(),
  }));

  useLayoutEffect(() => {
    if (menuOpen || slashMenuOpen) syncAtQuery();
  }, [menuOpen, slashMenuOpen]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (serializeEditor(editor) === value) {
      editor.dataset.empty = isEditorEmpty(value) ? "true" : "false";
      return;
    }
    hydrate(value);
  }, [value]);

  useEffect(() => {
    const onSelection = () => saveRange();
    document.addEventListener("selectionchange", onSelection);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      for (const root of rootsRef.current.values()) {
        queueMicrotask(() => root.unmount());
      }
      rootsRef.current.clear();
    };
  }, []);

  // Mark the editor while an IME composition is in flight so `revealCaret` stops
  // mutating the DOM under it. Backed by a dataset flag (not state) so the
  // selectionchange handler reads it without a re-render.
  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    const onStart = () => {
      node.dataset.composing = "true";
    };
    const onEnd = () => {
      delete node.dataset.composing;
    };
    node.addEventListener("compositionstart", onStart);
    node.addEventListener("compositionend", onEnd);
    return () => {
      node.removeEventListener("compositionstart", onStart);
      node.removeEventListener("compositionend", onEnd);
    };
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onKeyDownCapture = (event: globalThis.KeyboardEvent) => {
      if (!isEnterKey(event)) return;
      if (!shouldBlockSubmit() && !anyMenuOpen()) return;
      blockEnterEvent(event);
      if (!event.repeat) atMenuLock.confirm?.(event);
    };
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") return;
      if (!shouldBlockSubmit() && !anyMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    editor.addEventListener("keydown", onKeyDownCapture, true);
    editor.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      editor.removeEventListener("keydown", onKeyDownCapture, true);
      editor.removeEventListener("beforeinput", onBeforeInput, true);
    };
  }, []);

  const requestSubmit = () => {
    if (shouldBlockSubmit() || anyMenuOpen()) return;
    onSubmit();
  };

  const menuKeysActive = () => shouldBlockSubmit() || anyMenuOpen();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (menuKeysActive() && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (isEnterKey(event.nativeEvent)) atMenuLock.confirm?.(event.nativeEvent);
      return;
    }
    if (isEnterKey(event.nativeEvent)) {
      event.preventDefault();
      requestSubmit();
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      emit();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      const editor = editorRef.current;
      if (editor && isEditorEmpty(serializeEditor(editor))) {
        event.preventDefault();
        resetEmptyEditor(editor);
        lastRangeRef.current = document.createRange();
        lastRangeRef.current.setStart(editor, 0);
        lastRangeRef.current.collapse(true);
        if (valueRef.current) onChange("");
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const images = clipboardImages(event.clipboardData);
    const text = event.clipboardData.getData("text/plain");
    if (images.length === 0 && !text) return;
    event.preventDefault();
    event.stopPropagation();
    if (text) {
      onComposerPastedText?.(text);
      insertSerialized(text);
    }
    if (images.length > 0) onPasteImages(images);
  };

  /**
   * Only a selection that covers the whole composer carries the attachment bar along; the
   * browser still does whatever copy/cut normally does with the text itself.
   */
  const onCopyOrCut = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!coversWholeEditor(window.getSelection(), editor)) return;
    onComposerClipboardCarry?.();
  };

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      contentEditable
      data-placeholder={placeholder}
      data-empty="true"
      className="cs-composer-input w-full bg-transparent px-1 text-[13.5px] outline-none"
      onInput={(event) => {
        const input = event.nativeEvent as InputEvent;
        emit();
        if (input.inputType?.startsWith("insert") && input.data === "@") onAtTyped?.();
        // 只有「行首或空白后」的斜杠才算触发，不然 `/usr/local` 这种路径也会弹菜单。
        if (input.inputType?.startsWith("insert") && input.data === "/" && readSlashQueryFromEditor() !== null) {
          // 菜单的搜索框马上会抢走焦点，先把此刻的光标存下来，选中 skill 时才知道往哪儿插。
          saveRange();
          onSlashTyped?.();
        }
      }}
      onKeyDown={onKeyDown}
      onBeforeInput={(event) => {
        const input = event.nativeEvent;
        if (input.inputType !== "insertParagraph" && input.inputType !== "insertLineBreak") return;
        if (!shouldBlockSubmit() && !anyMenuOpen()) return;
        event.preventDefault();
      }}
      onKeyUp={saveRangeAndScroll}
      onMouseDown={(event) => {
        const wrap = chipWrapFromEvent(event.target, editorRef.current);
        if (!wrap) return;
        event.preventDefault();
        editorRef.current?.focus();
        lastRangeRef.current = placeCaretAfterChip(wrap);
      }}
      onSelectStart={(event) => {
        if (chipWrapFromEvent(event.target, editorRef.current)) event.preventDefault();
      }}
      onMouseUp={(event) => {
        const wrap = chipWrapFromEvent(event.target, editorRef.current);
        if (wrap) {
          lastRangeRef.current = placeCaretAfterChip(wrap);
          return;
        }
        saveRangeAndScroll();
      }}
      onPaste={onPaste}
      onCopy={onCopyOrCut}
      onCut={onCopyOrCut}
      onBlur={saveRange}
    />
  );
});
