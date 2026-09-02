package acp

import (
	"regexp"
	"strings"
)

// Cursor ACP sometimes finishes a successful session/prompt by tearing down its
// internal write stream. The CLI then emits RetriableError: WritableIterable is
// closed as an RPC error and/or a trailing agent_message_chunk. That is not a
// Host stdin close.
var (
	streamCloseLine = regexp.MustCompile(`(?i)^[ \t]*(?:error:[ \t]*)?retriableerror:[ \t]*writableiterable is closed\.?[ \t]*$`)
	streamCloseTail = regexp.MustCompile(`(?i)(?:\n[ \t]*)?(?:error:[ \t]*)?retriableerror:[ \t]*writableiterable is closed\.?[ \t]*$`)
	streamCloseHead = regexp.MustCompile(`(?i)^[ \t]*(?:error:[ \t]*)?retriableerror:[ \t]*writableiterable is closed\.?[ \t]*(?:\n+|$)`)
)

func IsBenignStreamClose(err error) bool {
	return err != nil && IsBenignStreamCloseText(err.Error())
}

func IsBenignStreamCloseText(text string) bool {
	return strings.Contains(text, "WritableIterable is closed")
}

func IsOnlyBenignStreamClose(text string) bool {
	if !IsBenignStreamCloseText(text) {
		return false
	}
	trimmed := strings.TrimSpace(text)
	if streamCloseLine.MatchString(trimmed) {
		return true
	}
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		return true
	}
	return strings.TrimSpace(StripBenignStreamClose(text)) == ""
}

func StripBenignStreamClose(text string) string {
	if !IsBenignStreamCloseText(text) {
		return text
	}
	next := text
	for {
		cleaned := streamCloseHead.ReplaceAllString(next, "")
		if cleaned == next {
			break
		}
		next = cleaned
	}
	for {
		cleaned := streamCloseTail.ReplaceAllString(next, "")
		if cleaned == next {
			break
		}
		next = cleaned
	}
	return strings.TrimRight(next, " \t\r\n")
}
