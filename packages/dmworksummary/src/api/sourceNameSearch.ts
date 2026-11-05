import { NameSearchService } from "@octo/base";
import type {
  NameSearchKind,
  NameSearchPage,
  NameSearchQuery,
} from "@octo/base";

/** Captured runtime context, never the summary module's mutable global session. */
export type SummaryMemberNameQuery = Omit<
  NameSearchQuery,
  "entry" | "scope" | "contactType" | "includeArchived"
>;
export type SummarySourceNameQuery = Omit<
  NameSearchQuery,
  "entry" | "scope" | "channelId" | "channelType"
>;

/** Name-search path only. Empty-keyword browsing retains summaryApi's contract.
 * The server determines selectable candidates before matching and pagination.
 * Member context can be a group or a thread; threads inherit the parent roster.
 */
export function searchSummaryMembers(
  query: SummaryMemberNameQuery,
  signal?: AbortSignal
): Promise<NameSearchPage> {
  return NameSearchService.searchContacts(
    {
      ...query,
      entry: "name_selector",
      scope: "summary_member",
      contactType: "human",
    },
    signal
  );
}

/** Categories remain separate: people, groups and threads are not one score list.
 * Followed/recent restrictions may narrow the server result through allowedIds,
 * but must never be substituted for the server's source eligibility checks.
 */
export function searchSummarySources(
  kind: NameSearchKind,
  query: SummarySourceNameQuery,
  signal?: AbortSignal
): Promise<NameSearchPage> {
  const request: NameSearchQuery = {
    ...query,
    entry: "name_selector",
    scope: "summary_source",
    includeArchived: kind === "thread" && !!query.includeArchived,
  };
  return (
    kind === "contact"
      ? NameSearchService.searchContacts
      : kind === "group"
      ? NameSearchService.searchGroups
      : NameSearchService.searchThreads
  )(request, signal);
}
