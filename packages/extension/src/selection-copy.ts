import type { Locale } from "./sidepanel/i18n";

/**
 * 划词工具条自己的文案表。
 *
 * 为什么不去用侧栏那份 `i18n.ts`：工具条住在网页里（内容脚本，不是 React），把整个面板的
 * i18n 拖进来不划算。所以这里只放**工具条自己**要用的字，而且只有按钮名与 aria 两项——
 * 其余文案（进行中 / 失败 / 标题 / 复制）都在结果层那个 iframe 页面里，那里直接用侧栏的
 * `i18n.ts`，一个字都不重复。
 *
 * 文案本身是产品文案，改之前先跟用户确认（仓库根 AGENTS.md）。
 */
export type SelectionCopy = {
  translate: string;
  search: string;
  quote: string;
  translateAria: string;
  searchAria: string;
  quoteAria: string;
};

const copy: Record<Locale, SelectionCopy> = {
  zh: {
    translate: "翻译",
    search: "搜索",
    quote: "引用",
    translateAria: "翻译选中文本",
    searchAria: "搜索选中文本",
    quoteAria: "引用到输入框",
  },
  en: {
    translate: "Translate",
    search: "Search",
    quote: "Quote",
    translateAria: "Translate selection",
    searchAria: "Search selection",
    quoteAria: "Quote into composer",
  },
};

export function selectionCopy(locale: Locale): SelectionCopy {
  return copy[locale] ?? copy.en;
}
