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

export function blobUrlFromBase64Chunks(chunks: string[], mime: string): string {
  const bytes = bytesFromBase64Chunks(chunks);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return URL.createObjectURL(new Blob([copy], { type: mime || "application/octet-stream" }));
}
