# scripts/brand —— banner 用的第三方矢量素材

这里存放四家 Agent 的**官方**矢量标记原文件。整份留存、不做裁剪，只给
`scripts/generate_banner.py` 生成 `docs/banner.svg` 时读取：脚本按 `fill`
认出需要的那几条 `<path>`，只替换填充色，不改形状、不加特效。

| 文件 | 品牌 | 来源 | 用到的部分 |
|---|---|---|---|
| `claude-code.svg` | Claude Code（Anthropic） | Claude Code 官方文档站 `docs.claude.com` 的站点 logo（light 变体） | `fill="#D97757"` 的星标；同文件其余 path 是「Claude Code」字标 |
| `codex.svg` | Codex（OpenAI） | 上游 ACP Registry 给的 icon：`https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg`（24×24 单条 path） | 唯一那条 path（OpenAI 结） |
| `github-copilot.svg` | GitHub Copilot | GitHub 官方 Octicons 的 `copilot-24`（MIT） | 头部轮廓 + 两只眼，全部 |
| `opencode.svg` | OpenCode | opencode 仓库 `packages/ui/src/assets/favicon/favicon-v3.svg` | 外框 + 内方块；深色底板 `<rect>` 不用 |
| `cursor.svg` | Cursor | cursor.com 的 `marketing-static/favicon.svg` | 立方体那条；圆角底板与半透明描边层不用 |

这些素材的版权与商标归各品牌所有。放进仓库只用于说明 OpenSider 能连接哪些
本机 Agent CLI，**不表示这些品牌为本产品背书，也不代表存在合作关系**。使用或
替换前请自行确认各品牌的商标与素材使用条款。

更新素材：替换同名文件，重跑 `scripts/generate_banner.py`，然后肉眼核对
`docs/banner.svg`（尺寸表与 bbox 在生成脚本里，上游改了几何要同步改）。
