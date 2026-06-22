# 贡献 OCTO（简体中文）

感谢你有兴趣贡献 OCTO！🐙 我们欢迎任何规模的贡献。

## 开始之前

1. **Fork** 仓库，并从 `main` 创建你的分支
2. **安装依赖** — 参考仓库 README
3. **进行修改** — 遵循项目既有代码风格
4. **补充测试** — 修复 bug 或新增功能时请附带测试
5. **更新文档** — 行为变化请同步更新 README / docs
6. **提交 Pull Request** — 填写 PR 模板

## 研发流程

- 所有修改必须经过 Pull Request
- PR 必须通过 CI 才能合并（`Build` 与 `code-review` 为必需检查）
- 合并前需要 maintainer 的 approve；评审分派通过 [`.github/CODEOWNERS`](.github/CODEOWNERS) 自动完成
- 保持分支与 `main` 同步 —— 过旧的分支可能缺少必需的 CI 检查，合并前需要 rebase
- 使用 squash merge 并保持线性历史，让提交记录保持清爽

## 评审 SLA

我们希望每个 PR 都能尽快得到首次回应，让贡献保持低门槛：

- **首次评审在 3 个工作日内**完成（以 PR 创建、或从草稿转为正式的时间计）。
- 若 PR 需要修改，maintainer 会给出具体、可执行的反馈，而不是简单驳回。
- 若 PR 已被取代或超出范围，maintainer 会礼貌地说明原因并关闭。
- 若 3 个工作日内仍无 maintainer 回应，欢迎在评论区或 [Discussions](https://github.com/orgs/Mininglamp-OSS/discussions) 中 ping 一下 —— 这是被鼓励的，不是打扰。

Maintainer：不要让任何 PR 超过约 14 天仍未完成首次评审，按最旧优先的顺序处理。

## Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: add user presence API
fix: resolve message ordering race condition
docs: update README install steps
chore: bump dependency versions
```

## PR 描述

- 说明**改了什么**、**为什么改**
- 关联 Issue（如 `Fixes #123`）
- UI 变化请附截图
- **PR 描述请用英文** — 方便全球社区阅读历史

## 代码风格

- **Go**: `gofmt` + `golangci-lint`
- **TypeScript/JavaScript**: Prettier + ESLint（配置在仓库内）
- **Swift**: SwiftFormat
- **Kotlin**: ktlint / Android Studio 默认配置

## 报告 Bug

使用 GitHub Issue 的 **Bug Report** 模板。请包含：

- 期望行为 vs 实际行为
- 复现步骤
- 运行环境（操作系统、版本等）
- 日志 / 截图（如有）

## 功能建议

使用 GitHub Issue 的 **Feature Request** 模板。说明使用场景以及现有功能为何不够用。

## License

提交贡献即表示你同意将贡献在本项目的
[Apache License 2.0](LICENSE) 下发布。

## 有问题？

- 开 [GitHub Discussion](https://github.com/orgs/Mininglamp-OSS/discussions)
- 阅读 [文档站点](https://docs.octo.chat) _(建设中)_

感谢你一起让 OCTO 变得更好！🚀
