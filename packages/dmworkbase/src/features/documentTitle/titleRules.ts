export interface PageTitleContext {
  /** The page or content the user is currently visiting. */
  primaryTitle: string;
  /** Optional parent used by a full-screen Thread: parent > Thread. */
  parentTitle?: string;
  /** Optional localized top-level module title used by named content. */
  moduleTitle?: string;
}

export interface DocumentTitleInput {
  unreadConversationCount: number;
  context?: PageTitleContext;
  fallbackTitle?: string;
  brand?: string;
}

function cleanSegment(value?: string): string {
  return value?.trim() || "";
}

export function formatUnreadConversationPrefix(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  const normalized = Math.floor(count);
  return normalized > 99 ? "(99+) " : `(${normalized}) `;
}

export function buildDocumentTitle({
  unreadConversationCount,
  context,
  fallbackTitle,
  brand = "Octo",
}: DocumentTitleInput): string {
  const primaryTitle = cleanSegment(context?.primaryTitle);
  const parentTitle = cleanSegment(context?.parentTitle);
  const moduleTitle = cleanSegment(context?.moduleTitle);
  const fallback = cleanSegment(fallbackTitle);
  const cleanBrand = cleanSegment(brand) || "Octo";

  const pageTitle =
    parentTitle && primaryTitle
      ? `${parentTitle} > ${primaryTitle}`
      : primaryTitle;
  const body = [pageTitle || fallback, moduleTitle, cleanBrand]
    .filter(Boolean)
    .join(" - ");

  return `${formatUnreadConversationPrefix(unreadConversationCount)}${body}`;
}
