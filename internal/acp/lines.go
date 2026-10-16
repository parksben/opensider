package acp

import (
	"bufio"
	"io"
	"strconv"
)

// readLines 逐行读 Agent 的 stdout，行长不设上限。读到 EOF / 出错才返回。
func readLines(r io.Reader, onLine func([]byte)) {
	br := bufio.NewReaderSize(r, 64*1024)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			onLine(line)
		}
		if err != nil {
			return
		}
	}
}

// maxUpdateString 是单个字符串字段转发给侧栏前允许的最大字节数。
//
// Native Messaging 单帧上限 1MB，侧栏写镜像前也会把工具输出截到 8KB；而 Agent 读图片时
// 会把整张图的 base64 原样放进 tool_call_update（OpenCode 同时放在 content[].data 和
// rawOutput.attachments[].url，单条近 10MB）。不截的话这条更新会在发送侧被整条丢掉。
const maxUpdateString = 64 * 1024

// keepUpdatePrefix 是超长字符串截断后保留的前缀长度。
const keepUpdatePrefix = 8 * 1024

// slimUpdate 原地截断 update 里的超长字符串。
func slimUpdate(v any) {
	switch node := v.(type) {
	case map[string]any:
		for k, child := range node {
			if s, ok := child.(string); ok {
				node[k] = slimString(s)
				continue
			}
			slimUpdate(child)
		}
	case []any:
		for i, child := range node {
			if s, ok := child.(string); ok {
				node[i] = slimString(s)
				continue
			}
			slimUpdate(child)
		}
	}
}

func slimString(s string) string {
	if len(s) <= maxUpdateString {
		return s
	}
	cut := keepUpdatePrefix
	// 别把多字节 UTF-8 字符切成两半。
	for cut > 0 && s[cut]&0xC0 == 0x80 {
		cut--
	}
	return s[:cut] + "…[truncated " + strconv.Itoa(len(s)-cut) + " bytes]"
}
