import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// -----------------------------------------------------------------------------
// PR #554 RC blocker #1: content-tab clicks used to crash because
// `handleLocate` forwarded a camelCase ChannelSearchItem into
// `props.onClick`, which was consumed by `handleGlobalSearchClick` reading
// snake-case (`item.channel.channel_id`, `item.payload.url`) → TypeError.
//
// The fix routes content-tab navigation through `handleLocate` alone (calls
// `WKApp.endpoints.showConversation` directly) and closes the modal via a
// new `hideModal` prop, WITHOUT invoking `props.onClick` with the camelCase
// item. Legacy contacts / group / TabAll / TabFile paths still use the old
// snake-case `onClick` dispatch.
//
// This file locks in that contract at two levels:
//   §A behavioral: mirror handleLocate's contract with mocks and verify
//       showConversation + hideModal fire while onClick does NOT.
//   §B source-level regression guard: the production `handleLocate` in
//       GlobalSearch/index.tsx must not contain a `props.onClick(` call, and
//       must call `hideModal`.
// -----------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  showConversation: vi.fn(),
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
}));

// -----------------------------------------------------------------------------
// §A behavioral: mirror handleLocate against a shared props+mocks bag.
// -----------------------------------------------------------------------------

import { Channel } from "wukongimjssdk";
import { canLocateChannelSearchItem } from "../../ChannelSearch/locate";
import type { ChannelSearchItem } from "../../ChannelSearch/types";

// Mirror of GlobalSearch#handleLocate. If the production method diverges
// from this shape, the §B source-guard test below fails.
function simulateHandleLocate(
  item: ChannelSearchItem,
  props: {
    onClick?: (item: any, type: string) => void;
    hideModal?: () => void;
  }
) {
  if (!canLocateChannelSearchItem(item)) return;
  if (!item.channelId || typeof item.channelType !== "number") return;
  try {
    const channel = new Channel(item.channelId, item.channelType);
    mockState.showConversation(channel, {
      initLocateMessageSeq: item.messageSeq,
    });
  } catch {
    /* swallow — mirrors production which console.warns */
  }
  props.hideModal?.();
}

function baseItem(overrides: Partial<ChannelSearchItem> = {}): ChannelSearchItem {
  return {
    id: "m1",
    messageId: "m1",
    messageSeq: 42,
    channelId: "group-a",
    channelType: 2,
    senderUid: "u1",
    timestamp: 1_720_000_000,
    kind: "text",
    text: "hello",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleLocate — click routing (§A behavior)", () => {
  it("message hit: calls showConversation + hideModal, does NOT call onClick", () => {
    const onClick = vi.fn();
    const hideModal = vi.fn();
    simulateHandleLocate(baseItem(), { onClick, hideModal });

    expect(mockState.showConversation).toHaveBeenCalledTimes(1);
    const [ch, opts] = mockState.showConversation.mock.calls[0];
    expect(ch.channelID).toBe("group-a");
    expect(ch.channelType).toBe(2);
    expect(opts?.initLocateMessageSeq).toBe(42);
    expect(hideModal).toHaveBeenCalledTimes(1);
    // The core of the crash fix: legacy snake-case consumer must not receive
    // the camelCase content-tab item.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("thread hit (channelType=5, composite id): forwards opaquely", () => {
    const composite = "g-abc____thr-01";
    const onClick = vi.fn();
    const hideModal = vi.fn();
    simulateHandleLocate(
      baseItem({ channelId: composite, channelType: 5, messageSeq: 77 }),
      { onClick, hideModal }
    );

    expect(mockState.showConversation).toHaveBeenCalledTimes(1);
    const [ch] = mockState.showConversation.mock.calls[0];
    // No "____" split, no channelType coercion to 2.
    expect(ch.channelID).toBe(composite);
    expect(ch.channelType).toBe(5);
    expect(hideModal).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("file hit: uses same locate path (kind='file', channelId/channelType present)", () => {
    const onClick = vi.fn();
    const hideModal = vi.fn();
    simulateHandleLocate(
      baseItem({
        id: "f1",
        messageId: "f1",
        messageSeq: 7,
        kind: "file",
        file: { name: "spec.pdf", size: 1234, url: "/f/spec.pdf" },
      }),
      { onClick, hideModal }
    );

    expect(mockState.showConversation).toHaveBeenCalledTimes(1);
    expect(hideModal).toHaveBeenCalledTimes(1);
    // File items would crash handleGlobalSearchClick (reads item.payload.url);
    // fix keeps them off that path.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("no-op when messageSeq is missing (canLocate=false)", () => {
    const hideModal = vi.fn();
    simulateHandleLocate(baseItem({ messageSeq: 0 }), { hideModal });
    expect(mockState.showConversation).not.toHaveBeenCalled();
    expect(hideModal).not.toHaveBeenCalled();
  });

  it("no-op when channelId or channelType is missing", () => {
    const hideModal = vi.fn();
    simulateHandleLocate(baseItem({ channelId: undefined }), { hideModal });
    simulateHandleLocate(
      baseItem({ channelType: undefined as unknown as number }),
      { hideModal }
    );
    expect(mockState.showConversation).not.toHaveBeenCalled();
    expect(hideModal).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// §B source-level guard: production handleLocate must not push the camelCase
// item into the legacy `props.onClick` consumer, and must invoke `hideModal`.
// This is coarse — a rename could false-positive — but it's exactly the
// mistake the RC introduced and re-introducing it would silently pass the
// §A test above.
// -----------------------------------------------------------------------------
describe("handleLocate — source-level regression guard (§B)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "index.tsx"),
    "utf8"
  );

  it("does not forward camelCase item to props.onClick inside handleLocate", () => {
    const match = src.match(/handleLocate\s*=\s*\(item[\s\S]*?\n\s{4}\}/);
    expect(match, "handleLocate block should exist in GlobalSearch/index.tsx").toBeTruthy();
    const body = match![0];
    expect(
      /this\.props\.onClick\?\.\(item/.test(body),
      "handleLocate must not push camelCase item into legacy onClick consumer"
    ).toBe(false);
  });

  it("invokes props.hideModal so the enclosing modal can dismiss", () => {
    const match = src.match(/handleLocate\s*=\s*\(item[\s\S]*?\n\s{4}\}/);
    expect(match).toBeTruthy();
    const body = match![0];
    expect(
      /this\.props\.hideModal\?\.\(\)/.test(body),
      "handleLocate must invoke hideModal() to close the search modal"
    ).toBe(true);
  });
});
