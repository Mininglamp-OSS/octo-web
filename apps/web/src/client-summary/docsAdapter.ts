/**
 * Client-summary docs 适配器。
 *
 * 仅在主进程 bootstrap 声明 capabilities.docsConversion === true 且 host
 * bridge 提供 convertMarkdown/openDocument 方法时注册 `docs.convertMarkdown`
 * 与 `docs.openDocument` 两个端口，并把调用代理到 bridge。host 主进程负责
 * 校验来源、作用域和 payload；这里不发起 Docs REST，也不 import 私有 Docs 源码。
 */

import { WKApp, EndpointID } from "@octo/base";
import type {
  ConvertMarkdownToDocResult,
  OpenDocumentParams,
} from "@octo/base";
import type { OctoBuddySummaryBridge } from "./hostBridge";

/** 校验 docId/url 为可信 apiOrigin 下规范的 `/d/:docId`，无 query/hash/userinfo。 */
function isValidDocUrl(
  docId: string,
  url: string,
  apiOrigin: string,
): boolean {
  if (typeof docId !== "string" || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== apiOrigin) return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  return /^[A-Za-z0-9_-]{1,128}$/.test(docId) && parsed.pathname === `/d/${docId}`;
}

/** 把 host 返回的 ok:false 错误重构成 convertDocErrorMessage 认识的形状。 */
function toPortError(
  error: {
    message: string;
    status?: number;
    code?: string;
    document?: { docId: string; url: string };
  },
  apiOrigin: string,
): Error {
  const wrapped = new Error(error.message) as Error & {
    response?: { status?: number; data: { error?: string } };
    document?: { docId: string; url: string };
  };
  if (typeof error.status === "number" || typeof error.code === "string") {
    wrapped.response = { status: error.status, data: { error: error.code } };
  }
  // 只保留通过安全校验的 document 链接；恶意 URL 不放行。
  if (error.document?.docId && error.document.url) {
    const { docId, url } = error.document;
    if (isValidDocUrl(docId, url, apiOrigin)) {
      wrapped.document = { docId, url };
    }
  }
  return wrapped;
}

/** Register the native conversion and navigation ports in the summary renderer only. */
export function installDocsAdapter(
  bridge: OctoBuddySummaryBridge,
  bootstrap: {
    capabilities?: { docsConversion?: boolean };
    session?: { apiOrigin?: string };
  },
): void {
  if (bootstrap.capabilities?.docsConversion !== true) return;
  if (typeof bridge.convertMarkdown !== "function") return;
  if (typeof bridge.openDocument !== "function") return;

  const apiOrigin = bootstrap.session?.apiOrigin;
  if (typeof apiOrigin !== "string" || !apiOrigin) return;
  try {
    const origin = new URL(apiOrigin);
    if (!["https:", "http:"].includes(origin.protocol) || origin.origin !== apiOrigin) return;
  } catch {
    return;
  }
  const identity = { uid: WKApp.loginInfo.uid ?? "", token: WKApp.loginInfo.token };
  const assertIdentity = () => {
    if ((WKApp.loginInfo.uid ?? "") !== identity.uid || WKApp.loginInfo.token !== identity.token) {
      throw new Error("document opener scope expired");
    }
  };

  WKApp.endpointManager.setMethod(EndpointID.docsConvertMarkdown, async ({
    title,
    markdown,
  }: {
    title: string;
    markdown: string;
  }): Promise<ConvertMarkdownToDocResult> => {
    assertIdentity();
    const spaceId = WKApp.shared.currentSpaceId;
    const uid = WKApp.loginInfo.uid ?? "";
    const token = WKApp.loginInfo.token;

    const response = await bridge.convertMarkdown!({ title, markdown }, spaceId);

    if (
      WKApp.shared.currentSpaceId !== spaceId ||
      (WKApp.loginInfo.uid ?? "") !== uid ||
      WKApp.loginInfo.token !== token
    ) {
      throw new Error("summary scope changed during docs conversion");
    }

    if (!response.ok) {
      throw toPortError(response.error, apiOrigin);
    }

    if (!isValidDocUrl(response.value.docId, response.value.url, apiOrigin)) {
      throw new Error("invalid document link from host");
    }

    return response.value;
  });

  WKApp.endpointManager.setMethod(EndpointID.docsOpenDocument, async (
    params: OpenDocumentParams,
    spaceId?: string,
  ): Promise<void> => {
    assertIdentity();
    if (!spaceId || spaceId !== WKApp.shared.currentSpaceId) {
      throw new Error("document opener scope expired");
    }
    if (!isValidDocUrl(params.docId, params.url, apiOrigin)) {
      throw new Error("invalid document link from host");
    }
    await bridge.openDocument!({ docId: params.docId }, spaceId);
  });
}
