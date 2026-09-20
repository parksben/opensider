// Package selection 是「划词工具条」背后那两件事的**纯逻辑**：翻译 / 搜索的提示词拼装、
// 浏览器语言标签到英文语言名的映射，以及选区长度上限。
//
// 这里不碰进程、管道、网络或扩展，所以能直接在表格数据上写单测；真正把提示词发出去的是
// internal/host 的隐藏通道（见 host/selection.go）。
//
// 提示词文案是产品文案的一部分，改之前先跟用户确认（仓库根的 AGENTS.md 有这条约定）。
package selection

import (
	"strings"
	"unicode/utf8"
)

// MaxRunes 是选区长度上限（按 Unicode 码点算，不是 UTF-16 长度）：超过这个长度的选区
// **整条工具条都不出现**——这个功能对超长选区直接不支持，不提示、不降级。
//
// 500 是用户定的：像一段两行的英文说明（约 220 字符）这种很常见的划选得能用，
// 之前卡 200 就会让人以为工具坏了。
//
// 扩展侧先拦一道，Host 再拦一道：Host 不该相信任何一条消息（旧扩展、手工构造的都有）。
const MaxRunes = 500

// 隐藏通道支持的两件事。
const (
	ModeTranslate = "translate"
	ModeSearch    = "search"
)

// TooLong 报告选中文本是否超过上限。
func TooLong(text string) bool {
	return utf8.RuneCountInString(strings.TrimSpace(text)) > MaxRunes
}

// IsMode 报告这是不是我们认识的一种隐藏通道请求。
func IsMode(mode string) bool {
	return mode == ModeTranslate || mode == ModeSearch
}

// TranslatePrompt 拼翻译提示词。target 是目标语言的英文名（见 LanguageName）。
//
// 「只输出译文」这条要写死：翻译层是一个小浮层，任何前言、解释、包裹的引号都会直接显示
// 给用户看。
func TranslatePrompt(text, target string) string {
	if strings.TrimSpace(target) == "" {
		target = "English"
	}
	return "Translate the text below into " + target +
		". Output only the translation — no preamble, no notes, no quotes. If it is already in " +
		target + ", return it unchanged.\n\n" + text
}

// SearchPrompt 拼搜索提示词。结果要 Markdown（结果层直接渲染），要来源链接，要优先百科类
// 来源，而且要允许它说「我搜不了」——宁可它承认没有检索能力，也不要它编一份看起来很像的
// 搜索结果。
//
// 三条要写死的：
//   - 「只要结论」：结果层是个小浮层，过程叙述（"我先去搜一下…"）既拖时间又会被最终正文
//     刷掉；Host 那边另外按工具调用切了一刀做兼底。
//   - 「一次并发搜完」：一条一条搜会让用户等 N 个来回，而模型本来就支持一个回里多个
//     工具调用（CLI 会并发执行）。
//   - 「够了就停」：并发发出之后不必等齐、不必补搜、也不要逐页去读——结果层要的是快，
//     不是穷尽。
func SearchPrompt(text string) string {
	return "Search the web for the query below and answer in Markdown only — only the final " +
		"answer: no preamble, no notes about what you are about to do, no step-by-step " +
		"narration. Speed matters most: run every search you need in one batch (parallel tool " +
		"calls — not one query at a time), start writing as soon as the first results that come " +
		"back give you enough, and skip follow-up searches and opening individual pages unless " +
		"what you got is useless. Prefer encyclopedic sources (Wikipedia, Britannica, official " +
		"sites) and list the links you actually used under \"Sources\". Keep it short: a " +
		"summary, then the key facts. If you cannot search the web with your tools, say so in " +
		"one line instead of guessing — then give what you know from training data and label " +
		"it as such.\n\nQuery: " + text
}

// PromptFor 按模式拼提示词。target 只在翻译时用到。
func PromptFor(mode, text, target string) string {
	if mode == ModeSearch {
		return SearchPrompt(text)
	}
	return TranslatePrompt(text, target)
}

// LanguageName 把 BCP-47 标签映射成英文语言名。
//
// 目标语言取**浏览器语言**（内容脚本读 `navigator.language`），与扩展界面语言无关：界面
// 可以是中文而浏览器是英文，译文该跟着浏览器走。映射表只覆盖常见语言，表里没有的原样把
// 标签交给模型（它读得懂 `nb-NO` 这种），不硬猜、也不报错。
func LanguageName(tag string) string {
	cleaned := sanitizeTag(tag)
	if cleaned == "" {
		return "English"
	}
	normalized := strings.ToLower(strings.ReplaceAll(cleaned, "_", "-"))
	if name, ok := regionNames[normalized]; ok {
		return name
	}
	base := normalized
	if index := strings.IndexByte(normalized, '-'); index > 0 {
		base = normalized[:index]
	}
	if name, ok := baseNames[base]; ok {
		return name
	}
	return cleaned
}

// sanitizeTag 把语言标签洗成「只可能是语言标签」的样子：去掉控制字符（换行会把提示词
// 拆坏）、压掉首尾空白、按码点截断。洗不掉的怪值就地返回，不报错——翻译仍然该发出去。
func sanitizeTag(tag string) string {
	var builder strings.Builder
	for _, r := range tag {
		if r < 0x20 || r == 0x7f {
			continue
		}
		builder.WriteRune(r)
	}
	out := strings.TrimSpace(builder.String())
	if runes := []rune(out); len(runes) > 32 {
		out = string(runes[:32])
	}
	return out
}

// regionNames 是「地区决定叫法」的那几种（中文简繁、葡语巴西、英语英美）。
var regionNames = map[string]string{
	"zh-cn":   "Simplified Chinese",
	"zh-sg":   "Simplified Chinese",
	"zh-my":   "Simplified Chinese",
	"zh-hans": "Simplified Chinese",
	"zh-tw":   "Traditional Chinese",
	"zh-hk":   "Traditional Chinese",
	"zh-mo":   "Traditional Chinese",
	"zh-hant": "Traditional Chinese",
	"pt-br":   "Brazilian Portuguese",
	"pt-pt":   "European Portuguese",
	"en-us":   "English",
	"en-gb":   "English",
	"es-419":  "Latin American Spanish",
	"sr-latn": "Serbian",
}

// baseNames 覆盖浏览器界面语言的绝大多数情况（Chrome 支持的语言表）。
var baseNames = map[string]string{
	"af":  "Afrikaans",
	"am":  "Amharic",
	"ar":  "Arabic",
	"az":  "Azerbaijani",
	"be":  "Belarusian",
	"bg":  "Bulgarian",
	"bn":  "Bengali",
	"ca":  "Catalan",
	"cs":  "Czech",
	"cy":  "Welsh",
	"da":  "Danish",
	"de":  "German",
	"el":  "Greek",
	"en":  "English",
	"es":  "Spanish",
	"et":  "Estonian",
	"eu":  "Basque",
	"fa":  "Persian",
	"fi":  "Finnish",
	"fil": "Filipino",
	"fr":  "French",
	"ga":  "Irish",
	"gl":  "Galician",
	"gu":  "Gujarati",
	"ha":  "Hausa",
	"he":  "Hebrew",
	"hi":  "Hindi",
	"hr":  "Croatian",
	"hu":  "Hungarian",
	"hy":  "Armenian",
	"id":  "Indonesian",
	"ig":  "Igbo",
	"is":  "Icelandic",
	"it":  "Italian",
	"ja":  "Japanese",
	"ka":  "Georgian",
	"kk":  "Kazakh",
	"km":  "Khmer",
	"kn":  "Kannada",
	"ko":  "Korean",
	"lo":  "Lao",
	"lt":  "Lithuanian",
	"lv":  "Latvian",
	"mk":  "Macedonian",
	"ml":  "Malayalam",
	"mn":  "Mongolian",
	"mr":  "Marathi",
	"ms":  "Malay",
	"mt":  "Maltese",
	"my":  "Burmese",
	"nb":  "Norwegian",
	"ne":  "Nepali",
	"nl":  "Dutch",
	"no":  "Norwegian",
	"pa":  "Punjabi",
	"pl":  "Polish",
	"pt":  "Portuguese",
	"ro":  "Romanian",
	"ru":  "Russian",
	"si":  "Sinhala",
	"sk":  "Slovak",
	"sl":  "Slovenian",
	"so":  "Somali",
	"sq":  "Albanian",
	"sr":  "Serbian",
	"sv":  "Swedish",
	"sw":  "Swahili",
	"ta":  "Tamil",
	"te":  "Telugu",
	"th":  "Thai",
	"tl":  "Filipino",
	"tr":  "Turkish",
	"uk":  "Ukrainian",
	"ur":  "Urdu",
	"uz":  "Uzbek",
	"vi":  "Vietnamese",
	"yo":  "Yoruba",
	"zh":  "Simplified Chinese",
	"zu":  "Zulu",
}
