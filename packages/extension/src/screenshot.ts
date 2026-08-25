import type { ClipRect, ScreenshotPayload } from "@shared";
import { encodeBitmap } from "./image-encode";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  try {
    return await encodeBitmap(bitmap, { sx, sy, sw, sh });
  } finally {
    bitmap.close();
  }
}
