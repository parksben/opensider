/**
 * 版本号比较，只为「要不要提示用户更新」服务。
 *
 * 只认纯数字段（`v0.2.1` / `0.2` 都行）。`dev`、空串、预发布后缀等一律视为
 * 「不可比」：开发版通常比 release 新，报「有新版本」只会误导用户。
 */
function parse(value: string | undefined): number[] | undefined {
  const text = (value ?? "").trim().replace(/^v/i, "");
  if (!text || !/^\d+(\.\d+)*$/.test(text)) return undefined;
  return text.split(".").map((part) => Number(part));
}

/** 两个版本比较：a 更新返回 1，b 更新返回 -1，相等或不可比返回 0。 */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** latest 是否比 current 新；任一侧不可比时返回 false。 */
export function isNewer(latest: string | undefined, current: string | undefined): boolean {
  return compareVersions(latest, current) > 0;
}
