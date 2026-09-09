import APIClient from "./APIClient";

export interface DocumentPreviewInput {
  docId: string;
  kind: "doc" | "board" | "sheet" | "html";
}

export type DocumentPreviewResponse =
  | { ok: true; body: unknown }
  | { ok: false; status?: number; code?: string };

export type DocumentPreviewTransport = (
  input: DocumentPreviewInput,
) => Promise<DocumentPreviewResponse>;

export class DocumentPreviewError extends Error {
  constructor(public readonly status?: number, public readonly code?: string) {
    super("Document preview request failed");
    this.name = "DocumentPreviewError";
  }
}

const endpoints: Record<DocumentPreviewInput["kind"], string> = {
  doc: "content",
  board: "scene",
  sheet: "sheet",
  html: "html-preview",
};

let hostTransport: DocumentPreviewTransport | undefined;

/** Installed only by an embedded host; ordinary Web keeps its existing HTTP path. */
export function installDocumentPreviewTransport(
  transport: DocumentPreviewTransport,
): () => void {
  hostTransport = transport;
  return () => {
    if (hostTransport === transport) hostTransport = undefined;
  };
}

export async function getDocumentPreviewBody(
  input: DocumentPreviewInput,
  spaceId: string,
): Promise<unknown> {
  if (hostTransport) {
    // Only identity and kind cross IPC. The host owns credentials and organization.
    const result = await hostTransport({ docId: input.docId, kind: input.kind });
    if (!result.ok) throw new DocumentPreviewError(result.status, result.code);
    return result.body;
  }

  const path = `docs/${encodeURIComponent(input.docId)}/${endpoints[input.kind]}`;
  const apiURL = APIClient.shared.config?.apiURL;
  // Desktop's IM prefix is /v1/, but Docs lives at /api/v1/docs/.
  // Web's relative /api/v1/ base must retain its dev/reverse proxy.
  const url = apiURL && /^https?:\/\//i.test(apiURL)
    ? `${new URL(apiURL).origin}/api/v1/${path}`
    : path;
  return APIClient.shared.get<unknown>(url, {
    headers: spaceId ? { "X-Space-Id": spaceId } : undefined,
    param: spaceId ? { sp: spaceId } : undefined,
  });
}
