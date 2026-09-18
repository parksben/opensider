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
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

// 端点做成变量是为了测试能指向本地服务；运行时不要改。
var (
	apiLatest = "https://api.github.com/repos/parksben/opensider/releases/latest"
	// webLatest 是网页端入口，不受 API「未认证 60 次/小时」的限制：共享出口 IP 很容易把
	// API 配额打满（HTTP 403），这时退回它拿 302 里的 tag。代价是可能被 CDN 缓存到旧
	// tag，所以只当兜底、先试 API。
	webLatest = "https://github.com/parksben/opensider/releases/latest"
)

type Info struct {
	Tag       string `json:"tag"`
	CheckedAt string `json:"checkedAt"`
}

// TTL 一小时：GitHub 未认证 API 每小时只给 60 次，一小时最多问一次足够安静；
// 再长了会出现「刚发完新版，侧栏一天内都还说最新是旧的」。
const TTL = time.Hour

// Cached 返回仍在 TTL 内的缓存；没有、过期或读不动都返回 false。
func Cached() (Info, bool) {
	info, ok := CachedAny()
	if !ok {
		return Info{}, false
	}
	stamp, err := time.Parse(time.RFC3339, info.CheckedAt)
	if err != nil || time.Since(stamp) > TTL {
		return Info{}, false
	}
	return info, true
}

// CachedAny 是不过期版本：在线检查全失败时，陈旧但真实的 tag 也比「未知」有用
// （调用方会把它标记成 stale，手点检查仍如实报失败）。
func CachedAny() (Info, bool) {
	raw, err := os.ReadFile(paths.ReleaseCheckPath())
	if err != nil {
		return Info{}, false
	}
	var info Info
	if err := json.Unmarshal(raw, &info); err != nil || info.Tag == "" {
		return Info{}, false
	}
	return info, true
}

// Latest 拉最新 Release 的 tag 并写缓存：先用 API，被限流 / 不可达退回网页重定向；
// 都失败返回错误，调用方自己决定降级方式。
func Latest(timeout time.Duration) (Info, error) {
	info, apiErr := fetchViaAPI(timeout)
	if apiErr == nil {
		cacheWrite(info)
		return info, nil
	}
	info, webErr := fetchViaRedirect(timeout)
	if webErr == nil {
		cacheWrite(info)
		return info, nil
	}
	return Info{}, fmt.Errorf("github: api %v; web %v", apiErr, webErr)
}

func fetchViaAPI(timeout time.Duration) (Info, error) {
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
		return Info{}, fmt.Errorf("HTTP %s", resp.Status)
	}
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return Info{}, err
	}
	tag := strings.TrimSpace(payload.TagName)
	if tag == "" {
		return Info{}, errors.New("empty tag")
	}
	return newInfo(tag), nil
}

// fetchViaRedirect 走网页端的 /releases/latest：用不跟随重定向的客户端取 302 的
// Location（.../releases/tag/<tag>）。no-cache 请求头尽量避开 CDN 的旧指向。
func fetchViaRedirect(timeout time.Duration) (Info, error) {
	client := &http.Client{
		Timeout:       timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequest(http.MethodGet, webLatest, nil)
	if err != nil {
		return Info{}, err
	}
	req.Header.Set("User-Agent", "opensider-host")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return Info{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound && resp.StatusCode != http.StatusMovedPermanently &&
		resp.StatusCode != http.StatusTemporaryRedirect && resp.StatusCode != http.StatusPermanentRedirect {
		return Info{}, fmt.Errorf("HTTP %s", resp.Status)
	}
	tag, err := tagFromLocation(resp.Header.Get("Location"))
	if err != nil {
		return Info{}, err
	}
	return newInfo(tag), nil
}

// tagFromLocation 从 .../releases/tag/vX.Y.Z 里取 tag；形状不对就当失败，别把
// 登录页 / 错误页的地址当版本号。
func tagFromLocation(location string) (string, error) {
	parsed, err := url.Parse(location)
	if err != nil {
		return "", err
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for i := 0; i+1 < len(parts); i++ {
		if parts[i] == "tag" && parts[i+1] != "" {
			return parts[i+1], nil
		}
	}
	return "", fmt.Errorf("no tag in %q", location)
}

func newInfo(tag string) Info {
	return Info{Tag: tag, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
}

func cacheWrite(info Info) {
	if raw, err := json.MarshalIndent(info, "", "  "); err == nil {
		if err := os.MkdirAll(paths.SidebarHome(), 0o755); err == nil {
			_ = os.WriteFile(paths.ReleaseCheckPath(), append(raw, '\n'), 0o644)
		}
	}
}
