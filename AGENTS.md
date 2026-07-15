# AGENTS.md — DMWork 项目工作约定

> 只写这个项目特有的约定。
> 通用工作习惯在 Agent 自身配置里。
> 技术规范在 **DEVELOPMENT.md**。

---

## 开始任务前

读 `DEVELOPMENT.md` — 按顶部"快速查阅"找对应章节，不需要全读。

在分配的 worktree 里工作，不要动主仓库目录。

涉及国际化、多语言或用户可见文案时，先读 `docs/i18n-agent-guide.md`，再运行相关校验。

涉及业务代码修改时，先确认模块归属和现有入口。不要因为历史目录里已有相似代码，就默认把新能力继续塞进 `Components/`、`Messages/` 或 `packages/dmwork*`。

新增业务能力应优先落在职责清晰的模块目录，并补充必要的 README、测试或 Story；确需修改共享组件、消息渲染或基础服务时，在最终说明里写明影响范围。

同一业务能力只保留一个用户可见入口。为了重构或复用新增底层实现时，不要同时暴露两套菜单、路由或按钮入口。

---

## 新建 UI 组件：建议先写 Story 再接业务

```
1. 建组件文件（index.tsx + index.css）
2. 写 Story（ComponentName.stories.tsx）
3. Storybook 里验证通过（light + dark 都看）
4. 再接入业务代码
```

顺序不能颠倒。建议新组件总是包含 Story，在 Storybook 里手动验证。

Story 写法见 DEVELOPMENT.md 章节四、六。

---

## 禁止事项

详细规范见 DEVELOPMENT.md 对应章节，以下为核心约束：

- **硬编码颜色/间距/圆角** → 章节二
- **`!important`** → 章节十三
- **直接覆盖 Semi class** → 章节十三
- **在组件里创建新颜色变量** → 章节十三
- **`@media (prefers-color-scheme: dark)`** → 章节十三

---

## UI/数据分离架构

本项目采用分层结构：

- `ui/` — UI 组件（新组件统一放这里，用 `pnpm gen:component` 生成）
- `bridge/` — 数据桥接层（types.ts + use*.ts）
- `Components/` / `Messages/` — 现有组件库
