import { WKApp } from "@octo/base";
import type { DocSearchDocType, DocSearchItem } from "@octo/base";
import type { DocumentSelectorSource } from "../ui/DocumentSelector/types";

interface DocsListItem {
  docId?: string;
  title?: string;
  docType?: string;
  updatedAt?: string | number | null;
  spaceId?: string;
}

interface DocsListResponse {
  total?: number;
  items?: DocsListItem[];
}

export interface ListDocumentsResult {
  items: DocSearchItem[];
  total: number;
}

export interface DocumentSourceTransport {
  list(
    source: DocumentSelectorSource,
    param: Record<string, unknown>
  ): Promise<DocsListResponse>;
}

const PAGE_SIZE = 50;
const SUPPORTED_DOC_TYPES: DocSearchDocType[] = ["doc", "html"];
const SUPPORTED_DOC_TYPE_SET = new Set<DocSearchDocType>(SUPPORTED_DOC_TYPES);

const defaultTransport: DocumentSourceTransport = {
  list(source, param) {
    return WKApp.apiClient.get<DocsListResponse>(
      source === "recent" ? "docs/recent" : "docs",
      { param }
    );
  },
};

function toUpdatedAtMillis(updatedAt: DocsListItem["updatedAt"]): number | null {
  if (typeof updatedAt === "number") {
    return Number.isFinite(updatedAt) ? updatedAt : null;
  }
  if (typeof updatedAt !== "string" || !updatedAt.trim()) return null;
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDocSearchItem(item: DocsListItem): DocSearchItem | null {
  if (!item.docId) return null;
  const docType = item.docType || "doc";
  if (!SUPPORTED_DOC_TYPE_SET.has(docType as DocSearchDocType)) return null;
  return {
    docId: item.docId,
    title: item.title || item.docId,
    docType: docType as DocSearchDocType,
    updatedAt: toUpdatedAtMillis(item.updatedAt),
    spaceId: item.spaceId,
  };
}

export class DocumentSourceService {
  constructor(
    private readonly transport: DocumentSourceTransport = defaultTransport
  ) {}

  async listDocuments(
    source: DocumentSelectorSource,
    keyword: string
  ): Promise<ListDocumentsResult> {
    const query = keyword.trim();
    const param =
      source === "recent"
        ? {
            pageSize: PAGE_SIZE,
            type: SUPPORTED_DOC_TYPES,
            ...(query ? { q: query } : {}),
          }
        : {
            owner: "me",
            page: 1,
            pageSize: PAGE_SIZE,
            sort: "updatedAt:desc",
            type: SUPPORTED_DOC_TYPES,
            ...(query ? { q: query } : {}),
          };
    const response = await this.transport.list(source, param);
    return {
      items: (response?.items ?? [])
        .map(toDocSearchItem)
        .filter(Boolean) as DocSearchItem[],
      total: response?.total ?? 0,
    };
  }
}

export default new DocumentSourceService();
