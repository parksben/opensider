## 开发协作约定（重要）

- **先文档后代码**：每次新需求/补充先更新 docs/REQUIREMENTS.md 和 docs/TECH_DESIGN.md，再动代码。
- **发版一律在本地构建**：所有 release（六个平台二进制 + `extension.zip` + `SHA256SUMS`）都在本机打完包，再用 `gh release` 把产物推到 GitHub 仓库；不要依赖 GitHub Actions（账号被账单锁着，推 tag 上去只会失败）。完整步骤与坑见发版记录（本地构建命令、`--clobber` 覆盖、tag 与扩展 manifest 版本对齐）。
- **小步 commit**：每完成一个功能点立即 commit，不攒大 commit。
- **commit message 一律英文**：标题与描述都用英文（Conventional Commits 风格，如 `fix(banner): …`）。不要在 commit 里写中文，也不要直接粘贴中文界面文案——用英文描述它（例如写 `the New Chat placeholder`，而不是把中文字符放进去）。历史 commit 也已统一改写为英文。
- **commit 即 push**：每次 commit 完成后立即 `git push` 到 origin。
- **UI icon 用 lucide**：禁止 emoji 作为 UI 装饰，不引入其他 icon 库。
- 文档分工：REQUIREMENTS 记"做什么、为什么"，TECH_DESIGN 记"怎么做、为什么选这个方案"。使用者看 README.md，开发看 docs/DEVELOPMENT.md。
