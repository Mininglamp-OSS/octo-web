import APIClient from "./APIClient";
import { mergeNameMatchRanges } from "../Utils/nameMatchRanges";
import type {
  NameMatchRange,
  NameSearchItem,
  NameSearchKind,
  NameSearchPage,
  NameSearchQuery,
} from "./NameSearchTypes";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid name search response");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid name search text");
  return value;
}
// Defensive wire limits exceed the current 100/128-character database fields.
// They bound malformed responses without limiting legitimate result pagination.
const MAX_NAME_CODEPOINTS = 4096;
function nameText(value: unknown): string {
  const raw = text(value);
  if (
    raw.length > MAX_NAME_CODEPOINTS * 2 ||
    Array.from(raw).length > MAX_NAME_CODEPOINTS
  )
    throw new Error("Name search field exceeds wire limit");
  return raw;
}
function ranges(value: unknown, raw: string): NameMatchRange[] {
  if (!Array.isArray(value)) throw new Error("Invalid name match ranges");
  const length = Array.from(raw).length;
  if (value.length > length) throw new Error("Excessive name match ranges");
  const validated = value.map((entry) => {
    const r = object(entry);
    if (
      !Number.isInteger(r.start) ||
      !Number.isInteger(r.end) ||
      (r.start as number) < 0 ||
      (r.end as number) <= (r.start as number) ||
      (r.end as number) > length
    )
      throw new Error("Invalid name match range");
    return { start: r.start as number, end: r.end as number };
  });
  return mergeNameMatchRanges(validated, length);
}

export function parseNameSearchPage(
  value: unknown,
  kind: NameSearchKind
): NameSearchPage {
  const page = object(value);
  if (
    !Array.isArray(page.items) ||
    page.items.length > 100 ||
    typeof page.complete !== "boolean" ||
    typeof page.has_more !== "boolean"
  )
    throw new Error("Invalid name search page");
  if (page.rules_version !== "s14-v1")
    throw new Error("Unsupported name search rules");
  if (
    page.complete
      ? !Number.isInteger(page.total) ||
        (page.total as number) < page.items.length
      : page.total !== null
  )
    throw new Error("Invalid name search coverage");
  const seen = new Set<string>();
  const items = page.items.map((entry): NameSearchItem => {
    const item = object(entry);
    const id = text(item.id);
    if (!id || seen.has(id) || item.kind !== kind)
      throw new Error("Invalid name search identity");
    seen.add(id);
    if (
      kind === "contact" &&
      item.contact_type !== "human" &&
      item.contact_type !== "ai"
    )
      throw new Error("Unconfirmed contact type");
    if (
      kind !== "contact" &&
      (item.contact_type !== undefined || item.bot_kind !== undefined)
    )
      throw new Error("Contact metadata on a non-contact result");
    if (
      kind === "thread" &&
      (typeof item.parent_id !== "string" ||
        !item.parent_id ||
        (item.archived !== undefined && typeof item.archived !== "boolean"))
    )
      throw new Error("Invalid thread context");
    const originalName = nameText(item.original_name),
      remarkName = nameText(item.remark_name);
    const displayName = text(item.display_name);
    if (displayName !== (remarkName.trim() ? remarkName : originalName))
      throw new Error("Invalid name search display name");
    const hits = object(item.matches);
    const bot = item.bot_kind;
    if (
      bot !== undefined &&
      bot !== "ordinary" &&
      bot !== "platform_app" &&
      bot !== "space_app"
    )
      throw new Error("Invalid Bot type");
    return {
      id,
      kind,
      contactType: item.contact_type as NameSearchItem["contactType"],
      botKind: bot as NameSearchItem["botKind"],
      ...(kind === "thread"
        ? {
            parentId: text(item.parent_id),
            archived:
              item.archived === undefined ? false : (item.archived as boolean),
          }
        : {}),
      originalName,
      remarkName,
      displayName,
      matches: {
        original: ranges(hits.original, originalName),
        remark: ranges(hits.remark, remarkName),
      },
    };
  });
  if (
    !Array.isArray(page.incomplete_reasons) ||
    !page.incomplete_reasons.every((v) => typeof v === "string")
  )
    throw new Error("Invalid name search coverage reasons");
  const nextCursor = text(page.next_cursor);
  if (page.has_more !== !!nextCursor)
    throw new Error("Invalid name search pagination");
  return {
    items,
    nextCursor,
    hasMore: page.has_more,
    complete: page.complete,
    total: page.total as number | null,
    incompleteReasons: page.incomplete_reasons as string[],
    rulesVersion: text(page.rules_version),
    resultRevision: text(page.result_revision),
  };
}

export function validateNameSearchQuery(
  query: NameSearchQuery,
  kind: NameSearchKind = "contact"
): void {
  if (!query || typeof query !== "object")
    throw new Error("Invalid name search query");
  const limit = query.entry === "global" ? 64 : 100;
  if (
    typeof query.keyword !== "string" ||
    !query.keyword.trim() ||
    Array.from(query.keyword).length > limit
  )
    throw new Error("Invalid name search keyword");
  if (!["global", "address_book", "name_selector"].includes(query.entry))
    throw new Error("Invalid name search entry");
  if (
    query.spaceId !== null &&
    (typeof query.spaceId !== "string" || !query.spaceId.trim())
  )
    throw new Error("Use null for a name search without Space");
  if (query.channelId !== undefined && typeof query.channelId !== "string")
    throw new Error("Invalid name search channel");
  if (
    query.channelType !== undefined &&
    query.channelType !== 2 &&
    query.channelType !== 5
  )
    throw new Error("Invalid name search channel type");
  for (const flag of [query.allowedIdsComplete, query.includeArchived])
    if (flag !== undefined && typeof flag !== "boolean")
      throw new Error("Invalid name search flag");
  if (
    query.allowedIds !== undefined &&
    (!Array.isArray(query.allowedIds) ||
      !query.allowedIds.every((id) => typeof id === "string" && !!id))
  )
    throw new Error("Invalid selectable name IDs");
  if (query.allowedIds === undefined && query.allowedIdsComplete === false)
    throw new Error(
      "Incomplete eligibility requires an explicit candidate set"
    );
  if (
    query.pageSize !== undefined &&
    (!Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100)
  )
    throw new Error("Invalid name search page size");
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== "string" ||
      new TextEncoder().encode(query.cursor).length > 1024)
  )
    throw new Error("Invalid name search cursor");
  if (
    query.contactType !== undefined &&
    !["all", "human", "ai"].includes(query.contactType)
  )
    throw new Error("Invalid name search contact type");
  if (
    kind !== "contact" &&
    query.contactType !== undefined &&
    query.contactType !== "all"
  )
    throw new Error("Contact filter on non-contact search");
  const scope = query.scope ?? "directory";
  switch (scope) {
    case "directory":
      if (kind === "thread")
        throw new Error("Threads require a selection scope");
      break;
    case "member":
    case "mention":
      if (kind !== "contact" || !query.channelId || query.channelType !== 2)
        throw new Error("Member search requires group context");
      break;
    case "forward":
      if (kind !== "thread") throw new Error("Invalid forward search kind");
      break;
    case "thread_filter":
      if (kind !== "thread" || !query.channelId || query.channelType !== 2)
        throw new Error("Thread filter requires group context");
      break;
    case "summary_member":
      if (
        kind !== "contact" ||
        (query.channelId && query.channelType !== 2 && query.channelType !== 5)
      )
        throw new Error("Invalid summary member context");
      break;
    case "summary_source":
      break;
    default:
      throw new Error("Unsupported name search scope");
  }
  if (
    query.channelId &&
    !["member", "mention", "thread_filter", "summary_member"].includes(scope)
  )
    throw new Error("Unexpected name search channel context");
  if (!query.channelId && query.channelType !== undefined)
    throw new Error("Missing name search channel");
  if (
    query.includeArchived &&
    scope !== "thread_filter" &&
    !(scope === "summary_source" && kind === "thread")
  )
    throw new Error("Invalid archived search context");
}

async function search(
  kind: NameSearchKind,
  query: NameSearchQuery,
  signal?: AbortSignal
): Promise<NameSearchPage> {
  validateNameSearchQuery(query, kind);
  const body = {
    keyword: query.keyword,
    space_id: query.spaceId,
    entry: query.entry,
    contact_type: query.contactType ?? "all",
    scope: query.scope ?? "directory",
    channel_id: query.channelId,
    channel_type: query.channelType,
    page_size: query.pageSize ?? 50,
    cursor: query.cursor ?? "",
    allowed_ids: query.allowedIds,
    allowed_ids_complete: query.allowedIdsComplete,
    include_archived: query.includeArchived,
  };
  try {
    const value: unknown = await APIClient.shared.post(
      kind === "contact"
        ? "search/contacts"
        : kind === "group"
        ? "search/groups"
        : "search/threads",
      body,
      {
        signal,
        suppressSpaceId: true,
        headers: query.spaceId === null ? {} : { "X-Space-Id": query.spaceId },
      }
    );
    return parseNameSearchPage(value, kind);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw error;
  }
}

export function isNameSearchQueryChanged(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "err.server.search.query_changed"
  );
}

export function isNameSearchPermissionLost(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown };
  return (
    value.code === "err.server.search.name_forbidden" ||
    value.status === 401 ||
    value.status === 403
  );
}

const NameSearchService = {
  searchThreads: (query: NameSearchQuery, signal?: AbortSignal) =>
    search("thread", query, signal),
  searchContacts: (query: NameSearchQuery, signal?: AbortSignal) =>
    search("contact", query, signal),
  searchGroups: (query: NameSearchQuery, signal?: AbortSignal) =>
    search("group", query, signal),
};
export default NameSearchService;
