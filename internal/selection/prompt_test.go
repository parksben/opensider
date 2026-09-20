package selection

import (
	"strings"
	"testing"
)

func TestTooLongCountsRunesNotBytes(t *testing.T) {
	// 200 个汉字是 600 字节但只有 200 个字符——按码点算才对，中文用户不该被提前拒绝。
	chinese := strings.Repeat("汉", MaxRunes)
	if TooLong(chinese) {
		t.Fatal("exactly MaxRunes characters must still be allowed")
	}
	if !TooLong(chinese + "字") {
		t.Fatal("one character over the limit must be rejected")
	}
	// emoji 在 JS 里是 2 个 UTF-16 单元、在 Go 里是 1 个 rune；两边都按「字符」算。
	emoji := strings.Repeat("🙂", MaxRunes)
	if TooLong(emoji) {
		t.Fatal("emoji must be counted as characters, not UTF-16 units")
	}
	if TooLong("  短文本  ") {
		t.Fatal("short text must pass")
	}
}

func TestTooLongIgnoresSurroundingWhitespace(t *testing.T) {
	padded := strings.Repeat(" ", 50) + strings.Repeat("a", MaxRunes) + strings.Repeat("\n", 50)
	if TooLong(padded) {
		t.Fatal("surrounding whitespace must not count towards the limit")
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
	prompt := SearchPrompt("opensider")
	for _, want := range []string{
		"Markdown only",
		"\"Sources\" list",
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

func TestPromptForDispatchesOnMode(t *testing.T) {
	if got := PromptFor(ModeSearch, "query", "Japanese"); strings.Contains(got, "Japanese") {
		t.Fatal("search must not carry a target language")
	}
	if got := PromptFor(ModeTranslate, "query", "Japanese"); !strings.Contains(got, "Japanese") {
		t.Fatal("translate must carry the target language")
	}
}
