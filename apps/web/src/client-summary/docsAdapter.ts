/**
 * Client-summary docs 适配器。
 *
 * 资料库查询和文档转换都由 host bridge 提供。host 主进程负责校验来源、
 * 作用域、认证和 REST 路由；这里不发起 Docs REST，也不 import 私有 Docs 源码。
 */

import { WKApp, EndpointID, normalizeDocsOrigin, validateDocsDocumentLink } from "@octo/base";
import type {
  ConvertMarkdownToDocResult,
} from "@octo/base";
import type { OctoBuddySummaryBridge } from "./hostBridge";
import { installDocumentSourceTransport } from "@dmwork/summary/src/Service/DocumentSourceService";

let activeListTransportDispose: (() => void) | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Both rejected promises and resolved failures pass the same boundary. */
function toPortError(value: unknown, apiOrigin: string): Error {
  const error = asRecord(value);
  const response = asRecord(error.response);
  const status = typeof error.status === "number" ? error.status : response.status;
  const code = typeof error.code === "string" ? error.code : asRecord(response.data).error;
  const wrapped = new Error(typeof error.message === "string" ? error.message : "document conversion failed") as Error & {
    response?: { status?: number; data: { error?: string } };
    document?: { docId: string; url: string };
  };
  if (typeof status === "number" || typeof code === "string") {
    wrapped.response = {
      status: typeof status === "number" ? status : undefined,
      data: { error: typeof code === "string" ? code : undefined },
    };
  }
  const document = validateDocsDocumentLink(error.document, apiOrigin);
  if (document) wrapped.document = document;
  return wrapped;
}

/** Register the native conversion and navigation ports in the summary renderer only. */
export function installDocsAdapter(
  bridge: OctoBuddySummaryBridge,
  bootstrap: {
    capabilities?: { docsConversion?: boolean; docsList?: boolean };
    session?: { apiOrigin?: string };
  },
): () => void {
  activeListTransportDispose?.();
  activeListTransportDispose = undefined;
  let listTransportDispose: (() => void) | undefined;
  const dispose = (): void => {
    if (activeListTransportDispose !== listTransportDispose) return;
    listTransportDispose?.();
    activeListTransportDispose = undefined;
  };

  const capability = bootstrap.capabilities?.docsConversion;
  const listCapability = bootstrap.capabilities?.docsList;
  if (
    listCapability !== undefined &&
    listCapability !== true &&
    listCapability !== false
  ) {
    console.warn("[client-summary] docs adapter not installed: invalid capability flag");
  } else if (listCapability === true) {
    if (typeof bridge.listDocuments !== "function") {
      console.warn("[client-summary] docs adapter not installed: missing bridge methods");
    } else {
      listTransportDispose = installDocumentSourceTransport({
        list: (input) => bridge.listDocuments!(input),
      });
      activeListTransportDispose = listTransportDispose;
    }
  }
  if (capability !== true) {
    if (capability !== undefined && capability !== false) {
      console.warn("[client-summary] docs adapter not installed: invalid capability flag");
    }
    return dispose;
  }
  if (typeof bridge.convertMarkdown !== "function" || typeof bridge.openDocument !== "function") {
    console.warn("[client-summary] docs adapter not installed: missing bridge methods");
    return dispose;
  }

  const apiOrigin = normalizeDocsOrigin(bootstrap.session?.apiOrigin);
  if (!apiOrigin) {
    console.warn("[client-summary] docs adapter not installed: invalid API origin");
    return dispose;
  }
  // applySession runs once per renderer. Account/token changes must recreate it;
  // do not silently adopt a refreshed identity for an already captured opener.
  const identity = { uid: WKApp.loginInfo.uid ?? "", token: WKApp.loginInfo.token };
  const assertIdentity = () => {
    if ((WKApp.loginInfo.uid ?? "") !== identity.uid || WKApp.loginInfo.token !== identity.token) {
      throw new Error("document opener scope expired");
    }
  };

  WKApp.endpointManager.setMethod(EndpointID.docsConvertMarkdown, async (
    value: unknown,
  ): Promise<ConvertMarkdownToDocResult> => {
    assertIdentity();
    const { title, markdown } = asRecord(value);
    if (typeof title !== "string" || typeof markdown !== "string") {
      throw new Error("invalid document conversion input");
    }
    const spaceId = WKApp.shared.currentSpaceId;
    const uid = WKApp.loginInfo.uid ?? "";
    const token = WKApp.loginInfo.token;
    const assertCurrent = () => {
      if (
        WKApp.shared.currentSpaceId !== spaceId ||
        (WKApp.loginInfo.uid ?? "") !== uid ||
        WKApp.loginInfo.token !== token
      ) {
        throw toPortError({
          message: "summary scope changed during docs conversion",
          code: "create_unconfirmed",
        }, apiOrigin);
      }
    };
    let response: unknown;
    try {
      response = await bridge.convertMarkdown!({ title, markdown }, spaceId);
    } catch (error) {
      assertCurrent();
      throw toPortError(error, apiOrigin);
    }
    assertCurrent();

    const envelope = asRecord(response);
    if (envelope.ok === false) {
      throw toPortError(envelope.error, apiOrigin);
    }

    const document = validateDocsDocumentLink(envelope.value, apiOrigin);
    if (envelope.ok !== true || !document) {
      throw toPortError({
        message: "invalid document link from host",
        code: "create_unconfirmed",
      }, apiOrigin);
    }

    return document;
  });

  WKApp.endpointManager.setMethod(EndpointID.docsOpenDocument, async (
    params: unknown,
    spaceId?: string,
  ): Promise<void> => {
    assertIdentity();
    if (!spaceId || spaceId !== WKApp.shared.currentSpaceId) {
      throw new Error("document opener scope expired");
    }
    const document = validateDocsDocumentLink(params, apiOrigin);
    if (!document) {
      throw new Error("invalid document link from host");
    }
    await bridge.openDocument!({ docId: document.docId }, spaceId);
  });
  return dispose;
}
