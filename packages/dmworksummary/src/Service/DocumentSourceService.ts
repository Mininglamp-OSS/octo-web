import { APIClient } from "@octo/base";
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
  nextCursor?: string | null;
}

export interface DocumentListPage {
  cursor?: string;
  page?: number;
}

export interface ListDocumentsResult {
  items: DocSearchItem[];
  total: number | null;
  nextPage: DocumentListPage | null;
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
    return APIClient.shared.get<DocsListResponse>(
      source === "recent" ? "docs/recent" : "docs",
      { param }
    );
  },
};

function toUpdatedAtMillis(
  updatedAt: DocsListItem["updatedAt"]
): number | null {
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
    keyword: string,
    pagination: DocumentListPage = {}
  ): Promise<ListDocumentsResult> {
    const query = keyword.trim();
    const requestedPage = pagination.page;
    const page =
      typeof requestedPage === "number" &&
      Number.isSafeInteger(requestedPage) &&
      requestedPage > 0
        ? requestedPage
        : 1;
    const param =
      source === "recent"
        ? {
            pageSize: PAGE_SIZE,
            type: SUPPORTED_DOC_TYPES,
            ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
            ...(query ? { q: query } : {}),
          }
        : {
            owner: "me",
            page,
            pageSize: PAGE_SIZE,
            sort: "updatedAt:desc",
            type: SUPPORTED_DOC_TYPES,
            ...(query ? { q: query } : {}),
          };
    const response = await this.transport.list(source, param);
    const rawItems = response?.items ?? [];
    const total =
      typeof response?.total === "number" &&
      Number.isSafeInteger(response.total) &&
      response.total >= 0
        ? response.total
        : null;
    // Recent is keyset-paginated: total is never a continuation signal.
    // Mine is offset-paginated: advance by the server page size, NOT the
    // post-filter/deduplicated visible count. Unknown totals allow one more
    // request after a full raw page; an empty terminal page stops that fallback.
    const nextPage: DocumentListPage | null =
      source === "recent"
        ? typeof response?.nextCursor === "string" &&
          response.nextCursor.length > 0 &&
          response.nextCursor !== pagination.cursor
          ? { cursor: response.nextCursor }
          : null
        : (
            total !== null
              ? page * PAGE_SIZE < total
              : rawItems.length >= PAGE_SIZE
          )
        ? { page: page + 1 }
        : null;
    return {
      items: rawItems
        .map(toDocSearchItem)
        .filter((item): item is DocSearchItem => item !== null),
      total,
      nextPage,
    };
  }
}

export default new DocumentSourceService();
