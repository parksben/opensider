/**
 * `ui.state` / `ui.state.set` 镜像状态的分片传输（Native Messaging 单帧上限 1MB）。
 * 状态超过 `STATE_SINGLE_BYTES` 时不再发整条消息，改发同类型消息的切片形态
 * `{ index, total, data }`；每片原始文本 256KB，JSON 转义后仍远低于单帧上限。
 *
 * 尺寸一律按 **UTF-8 字节**算：JS 的 `length` 是 UTF-16 码元数，中文一个码元三个字节、
 * emoji 四个——按字符数估算会把中文状态低估到三分之一，正是 2026-09-18 事故里
 * 让单帧顶穿上限的那类误差。
 *
 * 职责划分：发送侧用 `splitStateText` 把序列化好的整段 JSON 文本按字节预算切开
 * （切在码点边界上，绝不拆代理对）；接收侧用 `StateChunkSink` 按 index 归位、凑齐
 * total 片后才拼回整段文本（半截 JSON 永远不解析）。
 */

/** 整段 JSON 超过它就分片；留足信封与转义余量，单帧仍 <1MB。 */
export const STATE_SINGLE_BYTES = 700_000;
/** 每片原始文本的字节预算（256KB）。 */
export const STATE_CHUNK_BYTES = 256 * 1024;
/** 防御性上限：正常镜像不会有这么多片，超了按错误丢弃。 */
export const STATE_MAX_CHUNKS = 4096;

/** 文本的 UTF-8 字节数，逐码点计算，不产生编码副本。 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // 代理对（emoji 等）
        i += 1;
      } else {
        bytes += 3; // 孤立高代理：按 3 字节兜底，拼回来仍原样
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function splitStateText(text: string): string[] {
  if (utf8Length(text) <= STATE_SINGLE_BYTES) return [text];
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    let width = 1;
    let step = 1;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        width = 4;
        step = 2;
      } else {
        width = 3;
      }
    } else if (code >= 0x800) {
      width = 3;
    } else if (code >= 0x80) {
      width = 2;
    }
    if (bytes + width > STATE_CHUNK_BYTES && i > start) {
      parts.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += width;
    i += step;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/**
 * 接收侧重组成整段文本。分片按序到达（Native Messaging 是一条顺序流）：
 * 以 `index === 0` 开一轮新传输；重复片忽略，乱序片一律丢弃（宁缺勿错）。
 */
export class StateChunkSink {
  private total = 0;
  private parts: string[] = [];
  private received = 0;

  push(index: number, total: number, data: string): string | undefined {
    if (!Number.isInteger(total) || total <= 0 || total > STATE_MAX_CHUNKS) {
      this.clear();
      return undefined;
    }
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      this.clear();
      return undefined;
    }
    if (index === 0) {
      this.total = total;
      this.parts = new Array<string>(total).fill("");
      this.received = 0;
    } else if (this.total !== total) {
      // 没见到开头的片：这轮传输不可信，丢掉等下一轮。
      this.clear();
      return undefined;
    }
    if (this.parts[index]) return undefined;
    this.parts[index] = data;
    this.received += 1;
    if (this.received !== this.total) return undefined;
    const joined = this.parts.join("");
    this.clear();
    return joined;
  }

  private clear(): void {
    this.total = 0;
    this.parts = [];
    this.received = 0;
  }
}
