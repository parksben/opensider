package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSkill(t *testing.T, root, dir, body string) {
	t.Helper()
	full := filepath.Join(root, dir)
	if err := os.MkdirAll(full, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(full, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func find(t *testing.T, list []Skill, name string) Skill {
	t.Helper()
	for _, item := range list {
		if item.Name == name {
			return item
		}
	}
	t.Fatalf("%s missing from %#v", name, list)
	return Skill{}
}

func TestDiscoverInReadsNameAliasSourceAndDescription(t *testing.T) {
	claude := t.TempDir()
	writeSkill(t, claude, "coding-plan", `---
name: coding-plan
description: User's universal coding workflow — applies to all projects.
---

# Coding Plan
`)
	writeSkill(t, claude, "openclawmp", `---
name: openclawmp
display_name: 水产市场
description: >-
  Browse and install things from the market,
  reading each entry first.
slug: openclawmp
---
`)
	list := DiscoverIn([]Root{{Source: SourceClaude, Dir: claude}})
	if len(list) != 2 {
		t.Fatalf("got %d skills: %#v", len(list), list)
	}

	plan := find(t, list, "coding-plan")
	if plan.Alias != "coding-plan" {
		t.Fatalf("alias should fall back to name: %#v", plan)
	}
	if plan.Source != SourceClaude {
		t.Fatalf("source: %#v", plan)
	}
	if plan.Path != filepath.Join(claude, "coding-plan", "SKILL.md") {
		t.Fatalf("path: %q", plan.Path)
	}
	if plan.Description != "User's universal coding workflow — applies to all projects." {
		t.Fatalf("description: %q", plan.Description)
	}

	market := find(t, list, "openclawmp")
	if market.Alias != "水产市场" {
		t.Fatalf("display_name should win as the alias: %#v", market)
	}
	if market.Description != "Browse and install things from the market, reading each entry first." {
		t.Fatalf("folded description: %q", market.Description)
	}
}

func TestDiscoverInKeepsOnlyTheHighestPrioritySource(t *testing.T) {
	claude, cursor, builtin := t.TempDir(), t.TempDir(), t.TempDir()
	for _, root := range []string{claude, cursor, builtin} {
		writeSkill(t, root, "cli-model-alias-mapper", "---\nname: cli-model-alias-mapper\n---\n")
	}
	list := DiscoverIn([]Root{
		{Source: SourceClaude, Dir: claude},
		{Source: SourceCursor, Dir: cursor},
		{Source: SourceCursorBuiltin, Dir: builtin},
	})
	if len(list) != 1 {
		t.Fatalf("same name should collapse to one row: %#v", list)
	}
	if list[0].Source != SourceClaude {
		t.Fatalf("claude should win: %#v", list[0])
	}
}

func TestDiscoverInFallsBackToDirectoryName(t *testing.T) {
	root := t.TempDir()
	writeSkill(t, root, "frontend-design", "---\ndescription: Design things.\n---\n")
	list := DiscoverIn([]Root{{Source: SourceAgents, Dir: root}})
	if len(list) != 1 || list[0].Name != "frontend-design" || list[0].Alias != "frontend-design" {
		t.Fatalf("got %#v", list)
	}
}

func TestDiscoverInSkipsEntriesThatAreNotSkills(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "no-skill-file"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeSkill(t, root, "no-frontmatter", "# Just prose\n")
	if err := os.WriteFile(filepath.Join(root, "loose-file.md"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "never-installed")
	list := DiscoverIn([]Root{{Source: SourceCodex, Dir: root}, {Source: SourceCodex, Dir: missing}})
	if len(list) != 0 {
		t.Fatalf("nothing should be listed: %#v", list)
	}
	if list == nil {
		t.Fatal("empty result must be an empty slice so the wire format is [] not null")
	}
}

func TestDiscoverInSortsByLowercasedName(t *testing.T) {
	root := t.TempDir()
	writeSkill(t, root, "zeta", "---\nname: Zeta\n---\n")
	writeSkill(t, root, "alpha", "---\nname: alpha\n---\n")
	writeSkill(t, root, "Beta", "---\nname: Beta\n---\n")
	list := DiscoverIn([]Root{{Source: SourceClaude, Dir: root}})
	got := []string{list[0].Name, list[1].Name, list[2].Name}
	want := []string{"alpha", "Beta", "Zeta"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order %v, want %v", got, want)
		}
	}
}

func TestScalarFieldsKeepsLiteralBlocksAndDropsIndentedKeys(t *testing.T) {
	fields := scalarFields(strings.Join([]string{
		"name: canvas",
		"description: |",
		"  First line",
		"  Second line",
		"tags:",
		"  - one",
		"  - two",
		"homepage: \"https://example.com/x\"",
	}, "\n"))
	if fields["description"] != "First line\nSecond line" {
		t.Fatalf("literal block: %q", fields["description"])
	}
	if _, ok := fields["- one"]; ok {
		t.Fatalf("indented list items must not become fields: %#v", fields)
	}
	if fields["homepage"] != `"https://example.com/x"` {
		t.Fatalf("unquoted at parse time: %q", fields["homepage"])
	}
}

func TestReadSkillStopsAtTheHeaderLimit(t *testing.T) {
	root := t.TempDir()
	// frontmatter 没闭合（正文塞满头部读取上限）时宁可不列，也不瞎猜。
	writeSkill(t, root, "huge", "---\nname: huge\n"+strings.Repeat("x", maxHead)+"\n")
	list := DiscoverIn([]Root{{Source: SourceClaude, Dir: root}})
	if len(list) != 0 {
		t.Fatalf("unterminated frontmatter must be skipped: %#v", list)
	}
}
