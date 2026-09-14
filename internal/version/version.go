// Package version 保存这份二进制的版本号。
//
// 发布流水线用 -ldflags "-X github.com/parksben/opensider/internal/version.Version=vX.Y.Z"
// 注入 tag；仓库里默认 dev，表示这份二进制不是从 Release 装的（开发机 / 自行编译）。
//
// 口径：**`v` 只属于 git tag / release 标识**。产品里跟人见面的版本号一律不带它
// （`opensider version` 、`install` 输出、`hello` 里的版本、侧栏三行版本），因为扩展的
// manifest version 本身就只能是 `0.2.2` 这种形式，对照 chrome://extensions 时才不会
// 一会儿有 v 一会儿没 v。显示处一律用 Display()。
package version

import "strings"

// Version 是当前二进制的版本，形如 v0.2.0 或 dev。
var Version = "dev"

// IsDev 表示这不是发布流水线打出来的二进制。
func IsDev() bool {
	return Version == "" || Version == "dev"
}

// Display 是给人和界面看的版本号：去掉 tag 的 v 前缀（`v0.2.2` → `0.2.2`），
// `dev` / 空串原样返回。所有打印版本的地方都用它，别再直接打 Version。
func Display() string {
	return strings.TrimPrefix(Version, "v")
}
