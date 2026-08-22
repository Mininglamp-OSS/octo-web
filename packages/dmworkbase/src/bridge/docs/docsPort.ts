// docs 能力端口（capability port）—— OSS host 与已闭源的 docs 模块之间的唯一契约。
//
// 背景：`#1363 feat: detach docs module from oss host` 之后 `packages/docs` 已从本仓库移除，
// 并由 `.github/workflows/oss-module-guard.yml` 主动禁止重新加回。因此 OSS 侧的任何包都
// **不得**直接调用 docs-backend 的 REST 端点（`POST /docs`、`POST /docs/:id/import/markdown`、
// `DELETE /docs/:id`）—— 那会在拆分之后重新长出一条硬耦合，且在没有部署 docs-backend 的
// OSS 形态下必然 404/503。
//
// 这里改用仓库既有的 EndpointManager（Service/Module.ts）做依赖倒置：
//   - OSS 侧（本文件）只定义**接口形状**和调用入口，零 REST、零 URL 拼装；
//   - 闭源 docs 模块在自己的 init() 里 `setMethod(EndpointID.docsConvertMarkdown, handler)`
//     注册实现，内部复用它已有的 createDoc / importMarkdown / deleteDoc。
// 同样的解耦手法在仓库里已有先例：clearChannelMessages、showConversation、emojiService。
//
// 集成方文档见 docs/integration/docs-convert-port.md。

import WKApp from "../../App";
import { EndpointID } from "../../Service/Const";

/** 调用方传给 docs 模块的入参。 */
export interface ConvertMarkdownToDocParams {
  /** 文档标题；实现方可自行清洗/截断，空串时由实现方决定缺省标题。 */
  title: string;
  /** 文档正文（Markdown）。实现方负责大小/编码校验。 */
  markdown: string;
}

/** docs 模块回给调用方的结果。 */
export interface ConvertMarkdownToDocResult {
  /** 新建文档的 id。 */
  docId: string;
  /**
   * 可直接跳转的文档链接。
   *
   * 实现方**必须**用 `buildDocLink({ docId })`（Utils/docLink）生成，不要自行拼装：
   * 那是 ordinary document link 的唯一真相源，emit `/d/:docId`。历史上的
   * `/docs?doc=<id>` 查询串形式已废弃 —— host 的 RouteManager 在 `pageshow`/`popstate`
   * 只 re-push `window.location.pathname`，会无条件丢掉 query，深链会被抹掉。
   */
  url: string;
}

export type ConvertMarkdownToDocHandler = (
  params: ConvertMarkdownToDocParams,
) => Promise<ConvertMarkdownToDocResult>;

/**
 * 端口未接线时抛出。调用方应把它与「实现方内部失败」区分开：
 * 前者说明当前形态压根没有 docs 能力（应该在 UI 上就不显示入口），
 * 后者才需要把 API 错误文案展示给用户。
 */
export class DocsCapabilityUnavailableError extends Error {
  constructor(message = "docs capability is not available in this deployment") {
    super(message);
    this.name = "DocsCapabilityUnavailableError";
  }
}

/**
 * docs「markdown 转在线文档」能力当前是否可用。
 *
 * 两个条件都要满足，缺一不可：
 *  1. `WKApp.remoteConfig.docsOn` —— 运维侧的 docs 模块总开关（appconfig `docs_on`，默认
 *     false）。关闭时 docs-backend 可能压根没部署，nginx 会直接 503 返回基建原始文案。
 *  2. 端口已被实现方注册 —— 纯 OSS bundle 里没有 docs 模块，没人 setMethod，
 *     即使 `docs_on` 被误开也不会渲染出一个必然失败的入口。
 *
 * 调用方应当用它来 gate UI（隐藏按钮），而不是先渲染再靠报错兜底。
 */
export function isDocsConvertAvailable(): boolean {
  if (!WKApp.remoteConfig?.docsOn) return false;
  return !!WKApp.endpointManager.get(EndpointID.docsConvertMarkdown);
}

/**
 * 调用 docs 模块把一段 Markdown 转成在线文档。
 *
 * 端口未注册（或 docsOn 关闭）时抛 `DocsCapabilityUnavailableError`；
 * 实现方内部的失败（网络/权限/超大正文等）原样透传，由调用方决定展示文案。
 * 创建成功但导入失败时的回滚（删除孤儿空文档）属于**实现方**职责 —— 它才知道
 * 哪些错误是确定性的 HTTP 拒绝、哪些只是超时（超时不代表服务端没落盘，
 * 贸然删除会丢用户内容）。
 */
export async function convertMarkdownToDoc(
  params: ConvertMarkdownToDocParams,
): Promise<ConvertMarkdownToDocResult> {
  const endpoint = WKApp.endpointManager.get(EndpointID.docsConvertMarkdown);
  if (!endpoint?.handler) {
    throw new DocsCapabilityUnavailableError();
  }
  return (await endpoint.handler(params)) as ConvertMarkdownToDocResult;
}
