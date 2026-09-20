/**
 * 划词选区的长度额度。
 *
 * 只管这一件事，所以它没有依赖（能直接单测），扩展侧（`selection-toolbar.ts`）与
 * Host（`internal/selection/prompt.go`）两侧的口径必须一字不差地对齐。
 *
 * 为什么不用「字符数」一刀切：一个汉字的信息量约等于一个英文单词，同样 200 的字符额度
 * 对中文是「刚好一段」，对英文只有三四十个单词（半句话），用户报过这个偏差。所以：
 *
 *   - 中日韩文字（汉字 / 假名 / 谚文）按**字符**算，额度 500；
 *   - 其它文字（英文这类以空格分词的语言）按**单词**算，额度 200；
 *   - 混排就各自按额度分摊：`汉字数/500 + 单词数/200 ≤ 1`。
 *
 * 纯中文正好 500 字、纯英文正好 200 词都放行；中文里夹几个英文词就各自占一点额度。
 */

export const MAX_CJK_CHARS = 500;
export const MAX_WORDS = 200;

/** 汉字（含扩展 A 与兼容区）、假名、谚文：这些文字一个字就是一个词的信息量。 */
const CJK_CHAR =
  /[\u1100-\u11ff\u3005\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
/** 一个 token 至少含一个「非中日韩」的字母或数字才算一个词（纯标点、纯 emoji 不算）。 */
const WORD_CHAR = /[\p{L}\p{Nd}]/u;

/** 数出这段文本的「汉字数」与「单词数」，两侧都用它。 */
export function countSelection(text: string): { cjk: number; words: number } {
  let cjk = 0;
  for (const char of text) {
    if (CJK_CHAR.test(char)) cjk += 1;
  }
  let words = 0;
  for (const token of text.split(/\s+/)) {
    for (const char of token) {
      // 中文没有空格，不排掉的话整段中文会被当成一个词，白白吃掉英文那份额度。
      if (!CJK_CHAR.test(char) && WORD_CHAR.test(char)) {
        words += 1;
        break;
      }
    }
  }
  return { cjk, words };
}

/** 超出额度就返回 true（整条工具条都不出现，不提示、不降级）。 */
export function overSelectionLimit(text: string): boolean {
  const { cjk, words } = countSelection(text.trim());
  return cjk * MAX_WORDS + words * MAX_CJK_CHARS > MAX_CJK_CHARS * MAX_WORDS;
}

/** 给日志/错误用的说明文案（Host 侧那条用中文，这里只给数字）。 */
export function describeSelectionLimit(): string {
  return `${MAX_CJK_CHARS} CJK characters or ${MAX_WORDS} words`;
}
