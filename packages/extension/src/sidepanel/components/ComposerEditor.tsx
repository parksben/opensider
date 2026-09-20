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

/** True for the `/name` chips: only those count as the draft's leading skill prefix. */
function isSkillChip(node: Node | null): boolean {
  return (
    node instanceof HTMLElement &&
    node.classList.contains(CHIP_WRAP) &&
    (node.dataset.token ?? "").startsWith("«/skill:")
  );
}

/**
 * 空白文本节点：吃掉触发用的 `/` 之后会原地留下一个空节点，前导芯片之间也会夹着空格。
 * 算插入位置时两者都要当它们不存在，否则新芯片会被插到最前面，顺序就反了。
 */
function isBlankTextNode(node: Node | null): boolean {
  return node !== null && node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "";
}

function scrollCaret(editor: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const box = editor.getBoundingClientRect();
  if (rect.bottom > box.bottom) editor.scrollTop += rect.bottom - box.bottom + 4;
  else if (rect.top < box.top) editor.scrollTop -= box.top - rect.top + 4;
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
    const range = restoreRange();
    if (!editor || !range) return;
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
      range.deleteContents();
      const needLeft = !isPadSpace(charBeforeRange(range, editor));
      const needRight = !isPadSpace(charAfterRange(range, editor));
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
      saveRange();
      emit();
    },
    insertSkill: (mention) => {
      const editor = editorRef.current;
      if (!editor) return;
      // 先把触发用的 `/` 与搜索词吃掉（芯片取代它）——光标可能早就不在那儿了，所以取不到
      // 就跳过，不硬猜。
      const range = restoreRange();
      if (range && editor.contains(range.startContainer)) {
        consumeSlashBeforeCaret(range);
        range.deleteContents();
      }
      editor.focus();
      const token = serializeMention(mention);
      const existing = [...editor.querySelectorAll<HTMLElement>(`.${CHIP_WRAP}`)].find(
        (wrap) => wrap.dataset.token === token,
      );
      if (existing) {
        // 同一个 skill 选两次只留一个：光标落到已有芯片后面就行。
        lastRangeRef.current = placeCaretAfterChip(existing);
        emit();
        return;
      }
      // 插到「正文最前面」＝已插入的前导 skill 芯片之后、其它内容之前；多次选择按选择
      // 顺序在最左侧挨个累积（chip a → chip b），而不是反着插到绝对最前。
      // 前导区里会混着空文本节点（吃掉触发用的 `/` 之后留下的）与芯片之间的空白，算位
      // 置时要跳过它们，否则新芯片会被插到最前面，顺序就反了。
      let lastChip: Node | null = null;
      let node: Node | null = editor.firstChild;
      while (node && (isSkillChip(node) || isBlankTextNode(node))) {
        if (isSkillChip(node)) lastChip = node;
        node = node.nextSibling;
      }
      const at = lastChip ? lastChip.nextSibling : editor.firstChild;
      const wrap = createChipWrap(mention);
      const fragment = document.createDocumentFragment();
      // 紧跟在别的芯片后面插入时补一个空格；插在开头则不补（草稿不以空格起头）。
      if (lastChip) fragment.appendChild(document.createTextNode(" "));
      fragment.appendChild(wrap);
      // 插入点后面是正文（且不是空白）时补一个空格，免得芯片和文字粘在一起。
      if (at && !isBlankTextNode(at) && !isPadSpace(firstCharOfNode(at))) {
        fragment.appendChild(document.createTextNode(" "));
      }
      editor.insertBefore(fragment, at);
      mountChip(wrap, mention);
      lastRangeRef.current = placeCaretAfterChip(wrap);
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
        const rects = saved.getClientRects();
        const rect = rects.item(rects.length - 1) ?? saved.getBoundingClientRect();
        if (rect.top || rect.left || rect.height || rect.width) return rect;
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
      onKeyUp={saveRange}
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
        saveRange();
      }}
      onPaste={onPaste}
      onCopy={onCopyOrCut}
      onCut={onCopyOrCut}
      onBlur={saveRange}
    />
  );
});
