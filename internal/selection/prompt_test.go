package selection

import (
	"strings"
	"testing"
)

func TestTooLongCountsCharactersForCJKAndWordsForLatin(t *testing.T) {
	// 一个汉字 ≈ 一个英文单词：中文按字符 500，英文按单词 200。
	chinese := strings.Repeat("汉", MaxCJKChars)
	if TooLong(chinese) {
		t.Fatal("exactly MaxCJKChars characters must still be allowed")
	}
	if !TooLong(chinese + "字") {
		t.Fatal("one character over the CJK budget must be rejected")
	}

	english := func(count int) string {
		parts := make([]string, count)
		for index := range parts {
			parts[index] = "word"
		}
		return strings.Join(parts, " ")
	}
	if TooLong(english(MaxWords)) {
		t.Fatal("exactly MaxWords words must still be allowed")
	}
	if !TooLong(english(MaxWords + 1)) {
		t.Fatal("one word over the budget must be rejected")
	}
	// 短英文段落：按字符算只看长度的话很宽，按单词算才是真实长度。
	if TooLong("OpenSider is a browser extension that drives local agents from your browser.") {
		t.Fatal("a short English sentence must pass")
	}
}

func TestTooLongSharesTheBudgetWhenMixed(t *testing.T) {
	chinese := func(count int) string { return strings.Repeat("字", count) }
	english := func(count int) string {
		parts := make([]string, count)
		for index := range parts {
			parts[index] = "word"
		}
		return strings.Join(parts, " ")
	}
	// 一半中文额度 + 一半英文额度：刚好放行；中文用满再夹一个英文词就超了。
	if TooLong(chinese(MaxCJKChars/2) + " " + english(MaxWords/2)) {
		t.Fatal("half of each budget must still be allowed")
	}
	if !TooLong(chinese(MaxCJKChars) + " " + english(1)) {
		t.Fatal("an exhausted CJK budget leaves no room for words")
	}
}

func TestTooLongCountsRunesNotBytes(t *testing.T) {
	// 同样长度的文本，字节数与字符数差很多（汉字 3 字节、emoji 4 字节）——两边都按「字符」
	// 算才对，不该被字节数提前拒绕。
	emoji := strings.Repeat("🙂", MaxCJKChars)
	if TooLong(emoji) {
		t.Fatal("emoji are not CJK and carry no words: a long run of them must pass")
	}
	if TooLong("  短文本  ") {
		t.Fatal("short text must pass")
	}
}

func TestTooLongIgnoresSurroundingWhitespace(t *testing.T) {
	words := make([]string, MaxWords)
	for index := range words {
		words[index] = "a"
	}
	padded := strings.Repeat(" ", 50) + strings.Join(words, " ") + strings.Repeat("\n", 50)
	if TooLong(padded) {
		t.Fatal("surrounding whitespace must not count towards the budget")
	}
}

func TestIsMode(t *testing.T) {
	if !IsMode(ModeTranslate) || !IsMode(ModeSearch) {
		t.Fatal("translate and search are the two modes we support")
	}
	if IsMode("quote") || IsMode("") {
		t.Fatal("anything else must be rejected")
	}
}

func TestLanguageNameMapsCommonTags(t *testing.T) {
	cases := map[string]string{
		"zh-CN":      "Simplified Chinese",
		"zh-Hans":    "Simplified Chinese",
		"zh":         "Simplified Chinese",
		"zh-TW":      "Traditional Chinese",
		"zh-HK":      "Traditional Chinese",
		"zh_Hant":    "Traditional Chinese",
		"en":         "English",
		"en-US":      "English",
		"ja":         "Japanese",
		"ja-JP":      "Japanese",
		"ko-KR":      "Korean",
		"pt-BR":      "Brazilian Portuguese",
		"pt-PT":      "European Portuguese",
		"de-DE":      "German",
		"fr":         "French",
		"es-419":     "Latin American Spanish",
		"ru-RU":      "Russian",
		"ar":         "Arabic",
		"  hi-IN   ": "Hindi",
	}
	for tag, want := range cases {
		if got := LanguageName(tag); got != want {
			t.Fatalf("LanguageName(%q) = %q, want %q", tag, got, want)
		}
	}
}

func TestLanguageNameFallsBackToTheTag(t *testing.T) {
	// 表里没有的标签原样交给模型：不许猜成别的语言，也不许报错。
	if got := LanguageName("xx-YY"); got != "xx-YY" {
		t.Fatalf("unknown tags must pass through, got %q", got)
	}
	if got := LanguageName(""); got != "English" {
		t.Fatalf("empty tag defaults to English, got %q", got)
	}
	// 空标签会生成语法坏掉的提示词，所以给默认值；过长的串要截断。
	if got := LanguageName(strings.Repeat("a", 80)); len(got) > 32 {
		t.Fatalf("a bogus long tag must be truncated, got %d chars", len(got))
	}
	if strings.ContainsAny(LanguageName("en\nUS"), "\n") {
		t.Fatal("newlines must never survive into the prompt")
	}
}

func TestTranslatePromptCarriesTargetAndTextTwice(t *testing.T) {
	prompt := TranslatePrompt("Hello", "Simplified Chinese")
	// 目标语言要在两处出现：一处是要求，一处是「已是目标语言就原样返回」。
	if strings.Count(prompt, "Simplified Chinese") != 2 {
		t.Fatalf("target must appear twice, got: %s", prompt)
	}
	if !strings.HasSuffix(prompt, "\n\nHello") {
		t.Fatalf("the selected text must be the last thing in the prompt: %q", prompt)
	}
	// 「只输出译文」必须写死，否则小浮层里会出现前言、解释或包裹的引号。
	for _, want := range []string{"Output only the translation", "no quotes", "return it unchanged"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("translate prompt lost %q: %s", want, prompt)
		}
	}
}

func TestTranslatePromptDefaultsToEnglish(t *testing.T) {
	if !strings.Contains(TranslatePrompt("Hello", "   "), "into English") {
		t.Fatal("an empty target must fall back to English, not produce broken grammar")
	}
}

func TestSearchPromptAsksForMarkdownSourcesAndHonesty(t *testing.T) {
	prompt := SearchPrompt("opensider", "Simplified Chinese")
	for _, want := range []string{
		"Markdown only",
		"written in Simplified Chinese",
		"only the final answer",
		"no step-by-step narration",
		"Prefer encyclopedic sources",
		"in one batch",
		"parallel tool calls",
		"start writing as soon as the first results",
		"skip follow-up searches",
		"under \"Sources\"",
		"If you cannot search the web",
		"instead of guessing",
		"Query: opensider",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("search prompt lost %q: %s", want, prompt)
		}
	}
	if !strings.HasSuffix(prompt, "Query: opensider") {
		t.Fatalf("the query must be last: %q", prompt)
	}
}

func TestSearchPromptLanguageIsOptional(t *testing.T) {
	// 没有界面语言（旧扩展不带这个字段）就不加那句，保持原行为、不强行指定英语。
	prompt := SearchPrompt("opensider", "")
	if strings.Contains(prompt, "written in") {
		t.Fatalf("an unknown UI locale must not force a language: %s", prompt)
	}
	if !strings.Contains(prompt, "answer in Markdown only") {
		t.Fatalf("the rest of the prompt must survive: %s", prompt)
	}
}

func TestPromptForDispatchesOnMode(t *testing.T) {
	// 搜索：答案语言取**界面语言**，不带翻译那种目标语言。
	search := PromptFor(ModeSearch, "query", "Japanese", "zh")
	if !strings.Contains(search, "written in Simplified Chinese") {
		t.Fatalf("search must answer in the UI language: %s", search)
	}
	if strings.Contains(search, "Japanese") {
		t.Fatal("search must not carry the browser's language")
	}
	// 界面语言换了，搜索的答案语言跟着换；翻译反过来跟目标语言（浏览器语言）。
	if got := PromptFor(ModeSearch, "query", "Japanese", "en"); !strings.Contains(got, "written in English") {
		t.Fatalf("search must follow the UI locale: %s", got)
	}
	if got := PromptFor(ModeTranslate, "query", "Japanese", "zh"); !strings.Contains(got, "Japanese") {
		t.Fatalf("translate must carry the target language: %s", got)
	}
}
