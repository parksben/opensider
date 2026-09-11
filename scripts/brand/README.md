# scripts/brand —— banner 用的第三方矢量素材

这里存放五家 Agent 的**官方**矢量标记原文件。整份留存、不做裁剪，只给
`scripts/generate_banner.py` 生成 `docs/banner.svg` 时读取：脚本按 `fill`
认出需要的那几条 `<path>`，不改形状、不加特效；颜色按各家官方规范给——
单色标记跟主题前景色，Claude 橙、Codex 蓝紫渐变、Copilot 蓝色瓦片照官方原样。

| 文件 | 品牌 | 来源 | 用到的部分 |
|---|---|---|---|
| `claude-code.svg` | Claude Code（Anthropic） | Claude Code 官方文档站 `docs.claude.com` 的站点 logo（light 变体） | `fill="#D97757"` 的星标；同文件其余 path 是「Claude Code」字标 |
| `codex.svg` | Codex（OpenAI） | LobeHub icons 的 `codex-color.svg`（MIT 汇集的图标库，商标归 OpenAI）；从 npm 镜像取：`https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.0/icons/codex-color.svg` | 渐变填充（`url(#…)`）那条 path（云形 + 终端提示符）+ 它的 `<linearGradient>`；白色圆角底板（app 图标底色）不用 |
| `github-copilot.svg` | GitHub Copilot | GitHub 官方品牌包 `https://brand.github.com/GitHub_Logos.zip` 中的 `GitHub Logos/SVG/Copilot_Icon_White.svg` | 全部 3 条 path（护目镜本体 + 两只眼孔，`evenodd` 带镂空）；外层 `<g clip-path>` 不用 |
| `opencode.svg` | OpenCode | opencode 仓库 `packages/ui/src/assets/favicon/favicon-v3.svg` | 外框 + 内方块；深色底板 `<rect>` 不用 |
| `cursor.svg` | Cursor | cursor.com 的 `marketing-static/favicon.svg` | 立方体那条；圆角底板与半透明描边层不用 |

> Copilot 的彩色版官方只出现在 App 图标里（蓝色渐变底 + 白护目镜），单色 logo 包
> 只给黑白两版，品牌站的 Copilot 主题色也写明是「黑或白为主 + 少量绿色 / 紫色」
> 点缀。所以 banner 里用官方 512px App 图标（官方仓库 `github/CopilotForXcode`
> 的 `AppIcon`）实测出瓦片渐变 `#51AAE8 → #3165DA`，再叠上官方白护目镜。

这些素材的版权与商标归各品牌所有。放进仓库只用于说明 OpenSider 能连接哪些
本机 Agent CLI，**不表示这些品牌为本产品背书，也不代表存在合作关系**。使用或
替换前请自行确认各品牌的商标与素材使用条款。

更新素材：替换同名文件，重跑 `scripts/generate_banner.py`，然后肉眼核对
`docs/banner.svg`（尺寸表与 bbox 在生成脚本里，上游改了几何要同步改）。
