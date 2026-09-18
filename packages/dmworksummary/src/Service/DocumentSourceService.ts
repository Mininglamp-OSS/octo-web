import { APIClient } from "@octo/base";
import type { DocSearchDocType, DocSearchItem } from "@octo/base";
import type { DocumentSelectorSource } from "../ui/DocumentSelector/types";

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
  ): Promise<unknown>;
}

const PAGE_SIZE = 50;
const SUPPORTED_DOC_TYPES: DocSearchDocType[] = ["doc", "html"];

const defaultTransport: DocumentSourceTransport = {
  list(source, param) {
    return APIClient.shared.get<unknown>(
      source === "recent" ? "docs/recent" : "docs",
      { param }
    );
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toUpdatedAtMillis(updatedAt: unknown): number | null {
  // Docs emits ISO strings. Accept plausible epoch-millis too, matching the
  // search service's guard; never guess units for seconds or numeric strings.
  const millis = typeof updatedAt === "number"
    ? updatedAt
    : typeof updatedAt === "string" && updatedAt.trim() && !Number.isFinite(Number(updatedAt))
      ? Date.parse(updatedAt)
      : NaN;
  return Number.isFinite(millis) && millis > 1e11 && millis < 1e14 ? millis : null;
}

function toDocSearchItem(item: unknown): DocSearchItem | null {
  if (!isRecord(item) || typeof item.docId !== "string" || !item.docId.trim()) return null;
  const docType = item.docType ?? "doc";
  if (docType !== "doc" && docType !== "html") return null;
  return {
    docId: item.docId,
    title: typeof item.title === "string" && item.title.trim() ? item.title : item.docId,
    docType,
    updatedAt: toUpdatedAtMillis(item.updatedAt),
    spaceId: typeof item.spaceId === "string" ? item.spaceId : undefined,
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
    if (!isRecord(response) || !Array.isArray(response.items)) {
      throw new Error("Invalid document list response");
    }
    const rawItems: unknown[] = response.items;
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
