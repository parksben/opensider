// Package selection 是「划词工具条」背后那两件事的**纯逻辑**：翻译 / 搜索的提示词拼装、
// 浏览器语言标签到英文语言名的映射，以及选区长度额度。
//
// 这里不碰进程、管道、网络或扩展，所以能直接在表格数据上写单测；真正把提示词发出去的是
// internal/host 的隐藏通道（见 host/selection.go）。
//
// 提示词文案是产品文案的一部分，改之前先跟用户确认（仓库根的 AGENTS.md 有这条约定）。
package selection

import (
	"strings"
	"unicode"
)

// 选区长度**额度**：按语言分别算，不是一刀切的字符数。
//
//   - 中日韩文字（汉字 / 假名 / 谚文）按**字符**算，额度 500；
//   - 其它文字（英文这类以空格分词的语言）按**单词**算，额度 200；
//   - 混排按额度分摊：`汉字数/500 + 单词数/200 ≤ 1`。
//
// 一个汉字的信息量约等于一个英文单词：只数字符的话，同一道 200 的阀对中文是「刚好一段」、
// 对英文只有三四十个单词（用户报过这个偏差）。超过额度的选区**整条工具条都不出现**——
// 这个功能对超长选区直接不支持，不提示、不降级。
//
// 扩展侧先拦一道，Host 再拦一道：Host 不该相信任何一条消息（旧扩展、手工构造的都有）。
// 两侧口径必须一字不差，见 packages/extension/src/selection-limit.ts。
const (
	MaxCJKChars = 500
	MaxWords    = 200
)

// 隐藏通道支持的两件事。
const (
	ModeTranslate = "translate"
	ModeSearch    = "search"
)

// isCJK 报告这个字符是不是「一个字顶一个词」的文字。
func isCJK(r rune) bool {
	switch {
	case r >= 0x1100 && r <= 0x11FF: // 谚文字母
		return true
	case r == 0x3005: // 々
		return true
	case r >= 0x3040 && r <= 0x30FF: // 平假名 / 片假名
		return true
	case r >= 0x3400 && r <= 0x4DBF: // 汉字扩展 A
		return true
	case r >= 0x4E00 && r <= 0x9FFF: // 汉字
		return true
	case r >= 0xF900 && r <= 0xFAFF: // 兼容汉字
		return true
	case r >= 0xAC00 && r <= 0xD7AF: // 谚文音节
		return true
	}
	return false
}

// CountSelection 数出这段文本的「汉字数」与「单词数」（额度就按这两个数算）。
//
// 单词 = 以空白分隔、且至少含一个**非中日韩**的字母或数字的片段：中文没有空格，不排掉的
// 话整段中文会被当成一个词，白白吃掉英文那份额度。纯标点、纯 emoji 也不算词。
func CountSelection(text string) (cjk, words int) {
	for _, r := range text {
		if isCJK(r) {
			cjk++
		}
	}
	for _, token := range strings.Fields(text) {
		for _, r := range token {
			if !isCJK(r) && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
				words++
				break
			}
		}
	}
	return cjk, words
}

// TooLong 报告选中文本是否超出额度。
func TooLong(text string) bool {
	cjk, words := CountSelection(strings.TrimSpace(text))
	return cjk*MaxWords+words*MaxCJKChars > MaxCJKChars*MaxWords
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
// language 是**答案语言**（英文名，见 LanguageName），取**扩展界面语言**：中文界面的用户
// 不该拿到一屏英文结果（和翻译不一样，翻译跟的是浏览器语言）。为空（旧扩展没带这个字段）
// 就不加这句，保持原本的行为。
//
// 三条要写死的：
//   - 「只要结论」：结果层是个小浮层，过程叙述（"我先去搜一下…"）既拖时间又会被最终正文
//     刷掉；Host 那边另外按工具调用切了一刀做兼底。
//   - 「一次并发搜完」：一条一条搜会让用户等 N 个来回，而模型本来就支持一个回里多个
//     工具调用（CLI 会并发执行）。
//   - 「够了就停」：并发发出之后不必等齐、不必补搜、也不要逐页去读——结果层要的是快，
//     不是穷尽。
func SearchPrompt(text, language string) string {
	// 前缀（"Search the web for the query below"）是假引擎与文档都认的锚点，不要改。
	output := "answer in Markdown only"
	if language != "" {
		output += ", written in " + language
	}
	return "Search the web for the query below and " + output +
		" — only the final " +
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

// PromptFor 按模式拼提示词。target 只在翻译时用到（翻译取浏览器语言），uiLocale 只在搜索
// 时用到（结果按界面语言写）。
func PromptFor(mode, text, target, uiLocale string) string {
	if mode == ModeSearch {
		return SearchPrompt(text, LanguageName(uiLocale))
	}
	return TranslatePrompt(text, target)
}

// LanguageName 把 BCP-47 标签映射成英文语言名。
//
// 两个调用场景的语言来源不一样：翻译的目标语言取**浏览器语言**（内容脚本读
// `navigator.language`），搜索的答案语言取**扩展界面语言**——界面可以是中文而浏览器是
// 英文，译文该跟着浏览器走，而搜索结果该按用户看得懂的界面语言写。映射表只覆盖常见语言，
// 表里没有的原样把标签交给模型（它读得懂 `nb-NO` 这种），不硬猜、也不报错。
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
