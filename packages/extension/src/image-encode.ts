import type { ScreenshotPayload } from "@shared";

const MAX_EDGE = 1280;
const MAX_BASE64 = 700_000;

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

export async function encodeBitmap(
  bitmap: ImageBitmap,
  source?: { sx: number; sy: number; sw: number; sh: number },
): Promise<ScreenshotPayload> {
  const sx = source?.sx ?? 0;
  const sy = source?.sy ?? 0;
  const sw = source?.sw ?? bitmap.width;
  const sh = source?.sh ?? bitmap.height;
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

export async function encodeImageBlob(blob: Blob): Promise<ScreenshotPayload> {
  const bitmap = await createImageBitmap(blob);
  try {
    return await encodeBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}
