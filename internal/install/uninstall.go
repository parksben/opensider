package install

import (
	"fmt"
	"os"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
)

// Uninstall 移除本机桥接：所有浏览器 / Profile 的 Native Messaging 清单、Windows
// 注册表项、以及 runtime 目录。
//
// purge 为真时连 ~/.opensider 一起删（工作区、会话历史、产物、日志全丢）。这一步
// 不可逆，调用方（用户自己的 AI Agent，按仓库里的 skill）必须先向用户确认再传 true。
// 浏览器里已经加载的扩展不在这里处理：那要用户自己去扩展页移除。
func Uninstall(purge bool) error {
	// 先写日志再删目录：purge 之后 ~/.opensider 已经不在，写日志会把它重新建出来。
	log.Log(fmt.Sprintf("uninstall purge=%v", purge))

	for _, path := range Unregister() {
		fmt.Printf("Removed %s\n", path)
	}
	runtimeDir := paths.RuntimeDir()
	if err := os.RemoveAll(runtimeDir); err != nil {
		return err
	}
	fmt.Printf("Removed %s\n", runtimeDir)

	home := paths.SidebarHome()
	if !purge {
		fmt.Printf("Kept %s (session history, workspace, outputs).\n", home)
		fmt.Println("Re-run with --purge to delete it as well.")
		return nil
	}
	if err := os.RemoveAll(home); err != nil {
		return err
	}
	fmt.Printf("Removed %s\n", home)
	return nil
}
