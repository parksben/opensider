import type { ClipRect, ScreenshotPayload } from "@shared";

const MAX_EDGE = 1280;
const MAX_BASE64 = 700_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function encodeCanvas(canvas: OffscreenCanvas, quality: number): Promise<ScreenshotPayload> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return {
    imageBase64: await blobToBase64(blob),
    mime: "image/jpeg",
    width: canvas.width,
    height: canvas.height,
  };
}

export async function captureViewport(windowId: number, clip?: ClipRect): Promise<ScreenshotPayload> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 85 });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (clip) {
    const ratioX = clip.viewportWidth > 0 ? bitmap.width / clip.viewportWidth : clip.dpr || 1;
    const ratioY = clip.viewportHeight > 0 ? bitmap.height / clip.viewportHeight : clip.dpr || 1;
    sx = clamp(Math.round(clip.x * ratioX), 0, bitmap.width - 1);
    sy = clamp(Math.round(clip.y * ratioY), 0, bitmap.height - 1);
    sw = clamp(Math.round(clip.width * ratioX), 1, bitmap.width - sx);
    sh = clamp(Math.round(clip.height * ratioY), 1, bitmap.height - sy);
  }

  let outW = sw;
  let outH = sh;
  const edge = Math.max(outW, outH);
  if (edge > MAX_EDGE) {
    const factor = MAX_EDGE / edge;
    outW = Math.max(1, Math.round(outW * factor));
    outH = Math.max(1, Math.round(outH * factor));
  }

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("cannot create canvas context");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);

  let quality = 0.72;
  let payload = await encodeCanvas(canvas, quality);
  while (payload.imageBase64.length > MAX_BASE64 && quality > 0.4) {
    quality -= 0.1;
    payload = await encodeCanvas(canvas, quality);
  }
  if (payload.imageBase64.length > MAX_BASE64) {
    throw new Error("screenshot is too large after compression");
  }
  return payload;
}
