// Package skills 发现本机全局安装的 Skill（每个 skill 是一个含 SKILL.md 的目录）并解析
// 它的元数据，供侧栏的「斜杠探测菜单」列出来。
//
// 只嗅探**全局已装**的目录，做法是纯文件 IO：读每个 SKILL.md 的头部（8KiB 上限）解析
// frontmatter，不起子进程、不跑任何 CLI 的 list 命令。项目级 skill、以及那些必须跑命令
// 才能问出来的 skill 不在范围内——那类探测成本高，会拖慢侧栏的实时交互。
package skills

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/parksben/opensider/internal/paths"
)

// Source 是 skill 的来路，用于列表项右侧的小标签与左侧的 lucide 图标。
type Source string

const (
	SourceClaude        Source = "claude"
	SourceCursor        Source = "cursor"
	SourceAgents        Source = "agents"
	SourceCodex         Source = "codex"
	SourceStepClaw      Source = "stepclaw"
	SourceCursorBuiltin Source = "cursor_builtin"
)

// maxHead 是每个 SKILL.md 最多读多少字节：frontmatter 一定在最前面，正文（可能几千行）
// 不读。
const maxHead = 8 << 10

// Skill 是列表里的一项。Alias 只用于展示与搜索，芯片与发给 Agent 的一律用 Name。
type Skill struct {
	Name        string `json:"name"`
	Alias       string `json:"alias"`
	Source      Source `json:"source"`
	Path        string `json:"path"` // SKILL.md 的绝对路径
	Description string `json:"description"`
}

// Root 是一个被嗅探的目录。
type Root struct {
	Source Source
	Dir    string
}

// Roots 按**去重优先级**排列：同一个 skill 装在多个目录时，靠前的来源胜出——用户自己装的
// 那份比 CLI 自带的那份更该被选中。
func Roots() []Root {
	home := paths.Home()
	if home == "" {
		return nil
	}
	return []Root{
		{Source: SourceClaude, Dir: filepath.Join(home, ".claude", "skills")},
		{Source: SourceCursor, Dir: filepath.Join(home, ".cursor", "skills")},
		{Source: SourceAgents, Dir: filepath.Join(home, ".agents", "skills")},
		{Source: SourceCodex, Dir: filepath.Join(home, ".codex", "skills")},
		{Source: SourceStepClaw, Dir: filepath.Join(home, ".stepclaw", "skills")},
		{Source: SourceCursorBuiltin, Dir: filepath.Join(home, ".cursor", "skills-cursor")},
	}
}

// Discover 扫全部根目录，返回去重并按名称排好序的列表。返回的切片永远非 nil，好让线格式
// 里是 `[]` 而不是 `null`。
func Discover() []Skill {
	return DiscoverIn(Roots())
}

// DiscoverIn 是 Discover 的可测形态：测试喂临时目录，不碰真实 HOME。
func DiscoverIn(roots []Root) []Skill {
	out := []Skill{}
	seen := map[string]bool{}
	for _, root := range roots {
		entries, err := os.ReadDir(root.Dir)
		if err != nil {
			continue // 没装这个 CLI，目录不存在是常态，不是错误
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			dir := filepath.Join(root.Dir, entry.Name())
			meta, ok := readSkill(filepath.Join(dir, "SKILL.md"))
			if !ok {
				continue // 没有 SKILL.md、或读不出 frontmatter，就不是一个 skill
			}
			name := meta.name
			if name == "" {
				name = entry.Name() // frontmatter 没写 name，用目录名兜底
			}
			if name == "" {
				continue
			}
			key := strings.ToLower(name)
			if seen[key] {
				continue // 同名只留一条：先扫到的来源优先级更高
			}
			seen[key] = true
			alias := meta.display
			if alias == "" {
				alias = name
			}
			out = append(out, Skill{
				Name:        name,
				Alias:       alias,
				Source:      root.Source,
				Path:        filepath.Join(dir, "SKILL.md"),
				Description: meta.description,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		left, right := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if left != right {
			return left < right
		}
		return out[i].Source < out[j].Source // 同名不同来源时（已被去重，这里只保确定性）
	})
	return out
}

type frontmatter struct {
	name        string
	display     string
	description string
}

// readSkill 读一个 SKILL.md 的 frontmatter。ok=false 表示这目录不是一个 skill（文件不存在、
// 没有 frontmatter 或读不出来），调用方应跳过。
func readSkill(path string) (frontmatter, bool) {
	file, err := os.Open(path)
	if err != nil {
		return frontmatter{}, false
	}
	defer file.Close()
	head, readErr := io.ReadAll(io.LimitReader(file, maxHead))
	if len(head) == 0 {
		return frontmatter{}, false
	}
	if readErr != nil && len(head) < 8 {
		return frontmatter{}, false
	}
	text := strings.ReplaceAll(string(head), "\r\n", "\n")
	text = strings.TrimPrefix(text, "\ufeff")
	if !strings.HasPrefix(text, "---\n") {
		return frontmatter{}, false
	}
	block := text[len("---\n"):]
	end := strings.Index(block, "\n---")
	if end < 0 {
		return frontmatter{}, false // frontmatter 没闭合（或超出头部读取上限），不猜
	}
	fields := scalarFields(block[:end])
	return frontmatter{
		name:        unquote(fields["name"]),
		display:     unquote(fields["display_name"]),
		description: unquote(fields["description"]),
	}, true
}

var keyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]*$`)

// scalarFields 解析 frontmatter 里的顶层标量字段。缩进行算上一个 key 的延续（不单独成字段），
// 支持 `>-` / `|` 折叠与块标量，也支持带引号的值。
func scalarFields(block string) map[string]string {
	out := map[string]string{}
	lines := strings.Split(block, "\n")
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if line == "" || line[0] == ' ' || line[0] == '\t' {
			continue
		}
		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:colon])
		raw := strings.TrimSpace(line[colon+1:])
		if !keyRe.MatchString(key) {
			continue
		}
		if strings.HasPrefix(raw, ">") || strings.HasPrefix(raw, "|") {
			folded := raw[0] == '>'
			var parts []string
			for i+1 < len(lines) {
				next := lines[i+1]
				if strings.TrimSpace(next) == "" {
					i++ // 块里的空行：吃掉，但不代表块结束
					continue
				}
				if next[0] != ' ' && next[0] != '\t' {
					break // 顶到下一个顶层 key，块结束
				}
				i++
				parts = append(parts, strings.TrimSpace(next))
			}
			joiner := " "
			if !folded {
				joiner = "\n" // `|` 是逐行保留，详情面板要按原样读
			}
			out[key] = strings.Join(parts, joiner)
			continue
		}
		out[key] = raw
	}
	return out
}

// unquote 去掉 frontmatter 常见的引号包裹。
func unquote(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	return strings.TrimSpace(value)
}
