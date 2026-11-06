/** S14 names only. Content/title search uses its own matching contract. */
export type NameSearchKind = "contact" | "group" | "thread";
export type ContactSearchType = "all" | "human" | "ai";
export interface NameSearchQuery {
  keyword: string;
  spaceId: string | null;
  entry: "global" | "address_book" | "name_selector";
  contactType?: ContactSearchType;
  /** Only scopes with a verified backend provider are exposed here. */
  scope?:
    | "directory"
    | "member"
    | "mention"
    | "forward"
    | "thread_filter"
    | "summary_member"
    | "summary_source";
  includeArchived?: boolean;
  channelId?: string;
  channelType?: 2 | 5;
  pageSize?: number;
  cursor?: string;
  /** Complete selectable subset from the entry's existing permission source.
   * Undefined means all; [] means none. It cannot expand R1/R2 or grant actions. */
  allowedIds?: readonly string[];
  allowedIdsComplete?: boolean;
}
export interface NameMatchRange {
  start: number;
  end: number;
}
export interface NameSearchItem {
  id: string;
  kind: NameSearchKind;
  contactType?: "human" | "ai";
  botKind?: "ordinary" | "platform_app" | "space_app";
  parentId?: string;
  archived?: boolean;
  originalName: string;
  remarkName: string;
  displayName: string;
  matches: { original: NameMatchRange[]; remark: NameMatchRange[] };
}
export interface NameSearchPage {
  items: NameSearchItem[];
  nextCursor: string;
  hasMore: boolean;
  complete: boolean;
  total: number | null;
  incompleteReasons: string[];
  rulesVersion: string;
  resultRevision: string;
}
