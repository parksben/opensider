/**
 * 把一张图片（blob:/data:/file 地址都行）放进系统剪贴板。
 *
 * 剪贴板只认位图，所以非 PNG 先画到 canvas 再导出；画不出来（例如某些 SVG）就原样
 * 按自己的类型写一次，还不行就把错误抛给调用方去提示。
 */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("canvas export failed");
  return png;
}

export async function writeImageToClipboard(src: string): Promise<void> {
  const blob = await (await fetch(src)).blob();
  const png = await asPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
