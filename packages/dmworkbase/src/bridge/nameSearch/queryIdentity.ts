import type {
  NameSearchKind,
  NameSearchQuery,
} from "../../Service/NameSearchTypes";

/** Includes the login identity even though it is never sent as an authority. */
export function nameQueryIdentity(
  userId: string,
  kind: NameSearchKind,
  query: NameSearchQuery | null
): string {
  if (!userId || !query?.keyword.trim()) return "";
  return JSON.stringify([
    userId,
    kind,
    query.spaceId,
    query.keyword,
    query.entry,
    query.scope ?? "directory",
    query.contactType ?? "all",
    query.channelId ?? "",
    query.channelType ?? 0,
    query.includeArchived ?? false,
    query.pageSize ?? 50,
    query.allowedIds === undefined
      ? null
      : [...new Set(query.allowedIds)].sort(),
    query.allowedIdsComplete ?? true,
  ]);
}
