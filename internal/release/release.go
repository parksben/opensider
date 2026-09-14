// Package release 查 GitHub 上最新 Release 的 tag 并缓存到本机。
//
// 侧栏拿它和本地版本比较，决定要不要提示用户更新；更新动作不在这里做——那由
// 用户自己的 AI Agent 按仓库里的 skill 执行（见 docs/TECH_DESIGN.md）。
package release

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

const (
	apiLatest = "https://api.github.com/repos/parksben/opensider/releases/latest"
	// TTL 一小时：GitHub 未认证 API 每小时只给 60 次，一小时最多问一次足够安静；
	// 再长了会出现「刚发完新版，侧栏一天内都还说最新是旧的」。
	TTL = time.Hour
)

type Info struct {
	Tag       string `json:"tag"`
	CheckedAt string `json:"checkedAt"`
}

// Cached 返回仍在 TTL 内的缓存；没有、过期或读不动都返回 false。
func Cached() (Info, bool) {
	raw, err := os.ReadFile(paths.ReleaseCheckPath())
	if err != nil {
		return Info{}, false
	}
	var info Info
	if err := json.Unmarshal(raw, &info); err != nil || info.Tag == "" {
		return Info{}, false
	}
	stamp, err := time.Parse(time.RFC3339, info.CheckedAt)
	if err != nil || time.Since(stamp) > TTL {
		return Info{}, false
	}
	return info, true
}

// Latest 拉最新 Release 的 tag 并写缓存。失败返回错误，调用方自己决定降级方式。
func Latest(timeout time.Duration) (Info, error) {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest(http.MethodGet, apiLatest, nil)
	if err != nil {
		return Info{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "opensider-host")
	resp, err := client.Do(req)
	if err != nil {
		return Info{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Info{}, fmt.Errorf("github api: HTTP %s", resp.Status)
	}
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return Info{}, err
	}
	tag := strings.TrimSpace(payload.TagName)
	if tag == "" {
		return Info{}, errors.New("github api: empty tag")
	}
	info := Info{Tag: tag, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	if raw, err := json.MarshalIndent(info, "", "  "); err == nil {
		if err := os.MkdirAll(paths.SidebarHome(), 0o755); err == nil {
			_ = os.WriteFile(paths.ReleaseCheckPath(), append(raw, '\n'), 0o644)
		}
	}
	return info, nil
}
