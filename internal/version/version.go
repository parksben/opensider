// Package version 保存这份二进制的版本号。
//
// 发布流水线用 -ldflags "-X github.com/parksben/opensider/internal/version.Version=vX.Y.Z"
// 注入 tag；仓库里默认 dev，表示这份二进制不是从 Release 装的（开发机 / 自行编译）。
package version

import "strings"

// Version 是当前二进制的版本，形如 v0.2.0 或 dev。
var Version = "dev"

// IsDev 表示这不是发布流水线打出来的二进制。
func IsDev() bool {
	return Version == "" || Version == "dev"
}

// Plain 去掉前缀 v，方便和扩展 manifest.json 的 version 比较。
func Plain() string {
	return strings.TrimPrefix(Version, "v")
}
