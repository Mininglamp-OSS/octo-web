# docs 能力端口：markdown 转在线文档

> 面向 **docs 模块（已闭源仓库）** 的对接说明。
> OSS 侧（octo-web）已完成，等待 docs 侧注册实现。

## 背景

`#1363 feat: detach docs module from oss host` 之后，`packages/docs` 已从 octo-web 移除，
并由 `.github/workflows/oss-module-guard.yml` 禁止重新加回。

因此 OSS 侧的包**不得**直接调用 docs-backend 的 REST 端点
（`POST /docs`、`POST /docs/:docId/import/markdown`、`DELETE /docs/:docId`）：

- 在没有部署 docs-backend 的 OSS 形态下，这些调用必然 404 / 503；
- 即使后端可达，OSS bundle 里也没有注册 docs 路由，跳过去会落到 fallback 页，
  文档变成从 UI 无法访问的孤儿。

智能总结详情页的「转为在线文档」需要这个能力，所以改用仓库既有的 `EndpointManager`
做依赖倒置。同样的手法在仓库里已有先例：`clearChannelMessages`、`showConversation`、
`emojiService`。

## OSS 侧已完成的部分

| 文件 | 内容 |
|---|---|
| `packages/dmworkbase/src/bridge/docs/docsPort.ts` | 端口定义：类型、`isDocsConvertAvailable()`、`convertMarkdownToDoc()` |
| `packages/dmworkbase/src/Service/Const.ts` | `EndpointID.docsConvertMarkdown = "docs.convertMarkdown"` |
| `packages/dmworkbase/src/index.tsx` | 从包的 public index 导出上述符号 |
| `packages/dmworkbase/src/__tests__/docsPort.test.ts` | 端口契约测试（8 例） |

调用方（`packages/dmworksummary`）已经：

- 用 `isDocsConvertAvailable()` gate 按钮渲染 —— 端口没接线时按钮根本不出现；
- 通过 `convertMarkdownToDoc()` 调用，**自身零 REST**。

## docs 侧需要做的

在 docs 模块的 `init()` 里注册一个 handler，大约 15 行：

```ts
import WKApp from "@octo/base/src/App";
import { EndpointID } from "@octo/base/src/Service/Const";
import { buildDocLink } from "@octo/base";

WKApp.endpointManager.setMethod(
  EndpointID.docsConvertMarkdown,
  async ({ title, markdown }) => {
    // 下面三个函数都是 docs 侧现成的，不需要新写逻辑
    const { docId } = await createDoc(title);
    try {
      await importMarkdown(docId, markdown);
    } catch (err) {
      // 回滚：只在**确定性的 HTTP 拒绝**时删除孤儿空文档。
      // 超时 / 网络错误不要删 —— 服务端可能已经原子应用了导入，删掉会丢用户内容。
      if ((err as { response?: unknown })?.response) {
        await deleteDoc(docId).catch(() => {});
      }
      throw err;
    }
    return { docId, url: buildDocLink({ docId }) };
  },
);
```

## 契约

### 入参

```ts
interface ConvertMarkdownToDocParams {
  title: string;    // 文档标题；实现方可自行清洗/截断，空串时由实现方决定缺省标题
  markdown: string; // 文档正文；实现方负责大小/编码校验
}
```

### 返回

```ts
interface ConvertMarkdownToDocResult {
  docId: string;
  url: string;
}
```

**`url` 必须用 `buildDocLink({ docId })` 生成**（`packages/dmworkbase/src/Utils/docLink.ts`）。

理由：那是 ordinary document link 的唯一真相源，emit `/d/:docId`。历史上的
`/docs?doc=<id>` 查询串形式已废弃 —— host 的 RouteManager 在 `pageshow` / `popstate`
只 re-push `window.location.pathname`，会无条件丢掉 query，深链会被抹掉。
`docLink.test.ts` 里有 `expect(link).not.toContain('/docs?')` 的断言钉死这一点。

### 错误约定

| 情况 | 期望行为 |
|---|---|
| 创建文档失败 | 直接抛出，OSS 侧会用 `extractErrorMsg` 取 `response.data.msg` 展示 |
| 导入失败（确定性 HTTP 错误，有 `err.response`） | 删除已创建的空文档，再抛出 |
| 导入失败（超时 / 网络错误，无 `err.response`） | **不要删**，直接抛出 |
| 端口未注册 | OSS 侧抛 `DocsCapabilityUnavailableError`；正常路径不会走到（UI 已 gate） |

回滚判据放在实现方，是因为只有它知道自己的超时配置和后端的原子性语义。
OSS 侧不做任何补偿调用，契约测试里钉死了这一点。

### 可用性判定

```ts
function isDocsConvertAvailable(): boolean {
  return !!WKApp.remoteConfig?.docsOn
    && !!WKApp.endpointManager.get(EndpointID.docsConvertMarkdown);
}
```

两个条件都要满足：

1. `WKApp.remoteConfig.docsOn` —— 运维侧的 docs 模块总开关（appconfig `docs_on`，默认 `false`）；
2. 端口已被注册 —— 纯 OSS bundle 里没有 docs 模块，即使 `docs_on` 被误开也不会渲染出必然失败的入口。

所以 docs 侧上线后，还需要运维把 `docs_on` 打开，按钮才会出现。

## 验证

OSS 侧：

```bash
cd packages/dmworkbase && npx vitest run src/__tests__/docsPort.test.ts
cd packages/dmworksummary && npx vitest run src/components/__tests__/SummaryResultActions.test.tsx
cd packages/dmworksummary && npx vitest run src/api/__tests__/summaryApi.test.ts
```

docs 侧接好后，端到端验证路径：总结详情页 → 结果下方「转为在线文档」→
新标签页打开 `/d/<docId>` → 文档正文与总结一致。
