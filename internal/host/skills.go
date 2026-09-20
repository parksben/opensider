package host

import (
	"time"

	"github.com/parksben/opensider/internal/skills"
)

// skillCacheTTL 是 skill 列表的保鲜期：侧栏每打开一次探测菜单都会来问，缓存在保鲜期内就
// 直接回缓存，过期才真去扫。扫描是纯文件 IO（每个 SKILL.md 只读头部 8KiB，见
// internal/skills），本机几十个 skill 的耗时可忽略，所以保鲜期不需要很长。
const skillCacheTTL = 5 * time.Minute

// sendSkills 把 skill 列表推给侧栏；缓存为空时先扫一次。
//
// 这份列表与连接的 Agent 无关（是「本机全局装了哪些 skill」），所以不跟连接状态绑定，
// 也不持久化。
func (h *Host) sendSkills() {
	h.mu.Lock()
	items := h.skills
	h.mu.Unlock()
	if items == nil {
		items = skills.Discover()
		h.mu.Lock()
		h.skills = items
		h.skillsAt = time.Now()
		h.mu.Unlock()
	}
	h.send(map[string]any{"type": "skills", "items": items})
}

// refreshSkills 重扫并推送。用户刚装了新 skill 时走这一条。
func (h *Host) refreshSkills() {
	items := skills.Discover()
	h.mu.Lock()
	h.skills = items
	h.skillsAt = time.Now()
	h.mu.Unlock()
	h.send(map[string]any{"type": "skills", "items": items})
}

// handleSkillsRefresh 处理侧栏的刷新请求：过期才真扫，没过期就把缓存回过去。
func (h *Host) handleSkillsRefresh() {
	h.mu.Lock()
	stale := h.skills == nil || time.Since(h.skillsAt) > skillCacheTTL
	h.mu.Unlock()
	if stale {
		h.refreshSkills()
		return
	}
	h.sendSkills()
}
