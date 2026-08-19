# 文档 AI 速览 · 接入端口（`@dmwork/summary/preview`）

给文档模块（`octo-enterprise-modules` 里的编辑器）用的**一行接入**能力。速览的全部逻辑
（触发按钮、流式面板、加载/流式/失败/空 四态、Markdown 渲染、i18n、调后端）都封装在
`@dmwork/summary` 内部，宿主**不需要**了解 summary 服务、SSE 或状态处理。

## 接入方式（文档模块侧）

在文档标题栏渲染一个组件即可：

```tsx
import { DocumentPreviewEntry } from '@dmwork/summary/preview'

// 文档页标题栏右侧
<DocumentPreviewEntry docId={docId} spaceId={currentSpaceId} />
```

就这样。点击按钮会弹出右侧速览面板并开始流式生成；关闭即丢弃（不落库、不进列表）。

## Props

| prop | 必填 | 说明 |
|---|---|---|
| `docId` | ✅ | 要速览的文档 id |
| `spaceId` | | 当前空间；缺省回退 `WKApp.shared.currentSpaceId` |
| `version` | | 指定版本；缺省取最新 |
| `onAskBot(docId)` | | 「问 Bot 追问」出口回调；只在速览完成后显示。不传则不显示该按钮 |
| `className` | | 默认触发按钮的额外 class |
| `renderTrigger(open, active)` | | 自定义触发器（用宿主自己的标题栏按钮），返回你的节点、内部调用 `open()` 打开面板 |

### 用宿主自己的按钮（可选）

```tsx
<DocumentPreviewEntry
  docId={docId}
  spaceId={space}
  renderTrigger={(open, active) => (
    <MyHeaderButton active={active} onClick={open}>✨ 速览</MyHeaderButton>
  )}
/>
```

## 依赖前提

- 宿主构建能解析 `@dmwork/summary`（enterprise module 与 octo-web 一起构建，通常已满足）。
- 后端需部署 `POST /summary/api/v1/summaries/document/preview`（octo-smart-summary）
  且配好 `DOCUMENT_SOURCE_API_URL`。
- i18n 自带并**自注册** `summaryPreview` 命名空间，无需宿主注册。
- 该端口**不依赖** SummaryModule 是否加载，可独立使用。
