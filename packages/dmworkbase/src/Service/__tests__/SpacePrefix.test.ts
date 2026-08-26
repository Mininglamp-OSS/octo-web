import { describe, expect, it } from "vitest";
import {
  hasSpacePrefix,
  imDriveTransferSourceKey,
  isDriveTransferSupportedChannel,
  normaliseImDriveChannelID,
  stripSpacePrefix,
} from "../SpacePrefix";

const spaceId = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const prefixed = `s${spaceId}_alice`;

describe("SpacePrefix helpers", () => {
  it("recognizes only the exact Space prefix format", () => {
    expect(hasSpacePrefix(prefixed)).toBe(true);
    expect(hasSpacePrefix("alice")).toBe(false);
    expect(hasSpacePrefix(`s${spaceId}alice`)).toBe(false);
    expect(hasSpacePrefix(`s${spaceId.slice(1)}_alice`)).toBe(false);
    expect(hasSpacePrefix(`s${spaceId}g_alice`)).toBe(false);
  });

  it("strips a valid prefix and leaves other IDs unchanged", () => {
    expect(stripSpacePrefix(prefixed)).toBe("alice");
    expect(stripSpacePrefix("alice")).toBe("alice");
    expect(stripSpacePrefix(`s${spaceId}_alice_extra`)).toBe("alice_extra");
  });

  it("normalizes only Person channel IDs and preserves an empty remainder", () => {
    expect(normaliseImDriveChannelID(1, prefixed)).toBe("alice");
    expect(normaliseImDriveChannelID(2, prefixed)).toBe(prefixed);
    expect(normaliseImDriveChannelID(1, `s${spaceId}_`)).toBe(`s${spaceId}_`);
    expect(normaliseImDriveChannelID(1, "alice")).toBe("alice");
  });

  it("allows only Person, Group, and CommunityTopic drive transfers", () => {
    expect([1, 2, 5].map(isDriveTransferSupportedChannel)).toEqual([true, true, true]);
    expect([0, 3, 4, 6].map(isDriveTransferSupportedChannel)).toEqual([false, false, false, false]);
  });

  it("builds a source key from the normalized channel ID", () => {
    expect(imDriveTransferSourceKey(1, prefixed, "msg-1")).toBe("1#alice#msg-1");
    expect(imDriveTransferSourceKey(2, prefixed, "msg-2")).toBe(`2#${prefixed}#msg-2`);
  });
});
