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
  parseMentionSegments,
  parseMentionToken,
  serializeMention,
  type MentionChip,
} from "../mentions";
import { MentionChip as MentionChipView } from "./MentionChip";

export const CHIP_WRAP = "cs-mention-wrap";

export type ComposerHandle = {
  focus: () => void;
  insertAtStart: (text: string) => void;
  insertMention: (mention: MentionChip) => void;
  moveCaretToEnd: () => void;
  getSerialized: () => string;
  getCaretRect: () => DOMRect | undefined;
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

function consumeAtBeforeCaret(range: Range): void {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent ?? "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const at = before.lastIndexOf("@");
  if (at < 0) return;
  if (before.slice(at + 1).trim() !== "") return;
  range.setStart(node, at);
  range.deleteContents();
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
    onChange: (value: string) => void;
    onSubmit: () => void;
    onPasteImages: (files: File[]) => void;
    onAtTyped?: () => void;
  }
>(function ComposerEditor({ value, placeholder, menuOpen, onChange, onSubmit, onPasteImages, onAtTyped }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const rootsRef = useRef(new Map<HTMLElement, Root>());
  const lastRangeRef = useRef<Range | null>(null);
  const valueRef = useRef(value);
  const menuOpenRef = useRef(menuOpen);
  valueRef.current = value;
  menuOpenRef.current = menuOpen;

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
  };

  const saveRange = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    lastRangeRef.current = range.cloneRange();
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
      const wrap = createChipWrap(mention);
      const zwsp = document.createTextNode("\u200b");
      range.insertNode(zwsp);
      range.insertNode(wrap);
      mountChip(wrap, parseMentionToken(wrap.dataset.token ?? "") ?? mention);
      placeCaret(zwsp, 1);
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
  }));

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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (menuOpenRef.current && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter", "Escape"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
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
    if (text) insertSerialized(text);
    if (images.length > 0) onPasteImages(images);
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
      }}
      onKeyDown={onKeyDown}
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
      onBlur={saveRange}
    />
  );
});
