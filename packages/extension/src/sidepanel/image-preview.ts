export function isAttachedImagePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false;
  if (/^(https?|file|data|blob):/i.test(trimmed)) return false;
  return trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed);
}

export function bytesFromBase64Chunks(chunks: string[]): Uint8Array {
  const parts = chunks.map((chunk) => {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const PREVIEW_DRAG_THRESHOLD_PX = 4;

function hasClosest(target: EventTarget | null): target is Element {
  return !!target && typeof (target as Element).closest === "function";
}

export function isPreviewBackdropClose(target: EventTarget | null, dragged: boolean): boolean {
  if (dragged) return false;
  if (!hasClosest(target)) return false;
  if (target.closest("img, .cs-preview-image")) return false;
  if (target.closest("[data-preview-chrome]")) return false;
  return true;
}

export function previewPointerDragged(
  start: { x: number; y: number },
  x: number,
  y: number,
  threshold = PREVIEW_DRAG_THRESHOLD_PX,
): boolean {
  const dx = x - start.x;
  const dy = y - start.y;
  return dx * dx + dy * dy > threshold * threshold;
}

export function blobUrlFromBase64Chunks(chunks: string[], mime: string): string {
  const bytes = bytesFromBase64Chunks(chunks);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return URL.createObjectURL(new Blob([copy], { type: mime || "application/octet-stream" }));
}
