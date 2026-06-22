import { describe, expect, it } from "vitest";
import {
  channelSearchPaginationTestUtils,
  LOAD_MORE_SCROLL_THRESHOLD,
} from "../pagination";

const { isNearChannelSearchScrollBottom, shouldStopPaginationForCursor } =
  channelSearchPaginationTestUtils;
const { shouldPauseAutoPaginationForEmptyPage } =
  channelSearchPaginationTestUtils;

function scrollMetrics({
  clientHeight = 400,
  scrollHeight = 1000,
  scrollTop,
}: {
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop: number;
}) {
  return { clientHeight, scrollHeight, scrollTop } as HTMLElement;
}

describe("channel search scroll pagination helpers", () => {
  it("triggers pagination when the content is inside the bottom threshold", () => {
    expect(
      isNearChannelSearchScrollBottom(
        scrollMetrics({
          scrollTop: 1000 - 400 - LOAD_MORE_SCROLL_THRESHOLD,
        })
      )
    ).toBe(true);
  });

  it("does not trigger pagination before the bottom threshold", () => {
    expect(
      isNearChannelSearchScrollBottom(
        scrollMetrics({
          scrollTop: 1000 - 400 - LOAD_MORE_SCROLL_THRESHOLD - 1,
        })
      )
    ).toBe(false);
  });

  it("stops pagination when the backend repeats the requested cursor", () => {
    expect(
      shouldStopPaginationForCursor({
        hasMore: true,
        nextCursor: "cursor-2",
        requestedCursor: "cursor-2",
      })
    ).toBe(true);
  });

  it("stops pagination when the backend has more but returns no next cursor", () => {
    expect(
      shouldStopPaginationForCursor({
        hasMore: true,
        requestedCursor: "cursor-2",
      })
    ).toBe(true);
  });

  it("continues pagination when the backend advances the cursor", () => {
    expect(
      shouldStopPaginationForCursor({
        hasMore: true,
        nextCursor: "cursor-3",
        requestedCursor: "cursor-2",
      })
    ).toBe(false);
  });

  it("pauses auto pagination when an empty page advances the cursor", () => {
    expect(
      shouldPauseAutoPaginationForEmptyPage({
        hasMore: true,
        itemCount: 0,
        nextCursor: "cursor-3",
        requestedCursor: "cursor-2",
      })
    ).toBe(true);
  });

  it("keeps auto pagination active when a page appends items", () => {
    expect(
      shouldPauseAutoPaginationForEmptyPage({
        hasMore: true,
        itemCount: 2,
        nextCursor: "cursor-3",
        requestedCursor: "cursor-2",
      })
    ).toBe(false);
  });

  it("does not pause the initial empty result page", () => {
    expect(
      shouldPauseAutoPaginationForEmptyPage({
        hasMore: true,
        itemCount: 0,
        nextCursor: "cursor-1",
      })
    ).toBe(false);
  });
});
