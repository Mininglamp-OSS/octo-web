import { describe, expect, it } from "vitest";
import { isEffectivelyMuted } from "../Thread";

describe("isEffectivelyMuted", () => {
  it("keeps a Thread muted when its parent channel is muted", () => {
    expect(
      isEffectivelyMuted({
        isThread: true,
        channelInfo: { orgData: { thread: { mute: 0 } } },
        parentChannelInfo: { mute: 1 },
      })
    ).toBe(true);
  });

  it("uses the Thread mute setting when its parent channel is not muted", () => {
    expect(
      isEffectivelyMuted({
        isThread: true,
        channelInfo: { orgData: { thread: { mute: 1 } } },
        parentChannelInfo: { mute: 0 },
      })
    ).toBe(true);
    expect(
      isEffectivelyMuted({
        isThread: true,
        channelInfo: { orgData: { thread: { mute: 0 } } },
        parentChannelInfo: { mute: 0 },
      })
    ).toBe(false);
  });

  it("inherits the parent mute setting when the Thread has no setting", () => {
    expect(
      isEffectivelyMuted({
        isThread: true,
        channelInfo: { orgData: { thread: {} } },
        parentChannelInfo: { mute: 1 },
      })
    ).toBe(true);
    expect(
      isEffectivelyMuted({
        isThread: true,
        channelInfo: { orgData: { thread: {} } },
        parentChannelInfo: { mute: 0 },
      })
    ).toBe(false);
  });

  it("keeps the existing non-Thread channel behavior", () => {
    expect(
      isEffectivelyMuted({
        isThread: false,
        channelInfo: { mute: 1 },
      })
    ).toBe(true);
    expect(
      isEffectivelyMuted({
        isThread: false,
        channelInfo: { mute: 0 },
      })
    ).toBe(false);
  });
});
