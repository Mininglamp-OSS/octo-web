/** Shared pagination guards for channel and global search bridges. */
export const LOAD_MORE_SCROLL_THRESHOLD = 120;

type ScrollMetrics = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;

export function isNearChannelSearchScrollBottom(element: ScrollMetrics) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    LOAD_MORE_SCROLL_THRESHOLD
  );
}

export function shouldStopPaginationForCursor({
  hasMore,
  nextCursor,
  requestedCursor,
}: {
  hasMore: boolean;
  nextCursor?: string;
  requestedCursor?: string;
}) {
  return Boolean(
    requestedCursor &&
      hasMore &&
      (!nextCursor || nextCursor === requestedCursor)
  );
}

export function shouldPauseAutoPaginationForEmptyPage({
  hasMore,
  itemCount,
  nextCursor,
  requestedCursor,
}: {
  hasMore: boolean;
  itemCount: number;
  nextCursor?: string;
  requestedCursor?: string;
}) {
  return Boolean(
    requestedCursor &&
      hasMore &&
      nextCursor &&
      nextCursor !== requestedCursor &&
      itemCount === 0
  );
}

export const channelSearchPaginationTestUtils = {
  isNearChannelSearchScrollBottom,
  shouldPauseAutoPaginationForEmptyPage,
  shouldStopPaginationForCursor,
};
