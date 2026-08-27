import { describe, expect, it, vi } from "vitest";

// wukongimjssdk 在测试环境只需常量与桩，避免拖入完整 SDK 副作用。
vi.mock("wukongimjssdk", () => ({
  __esModule: true,
  default: { shared: () => ({}) },
  Channel: class {},
  ChannelInfo: class {},
  ChannelTypePerson: 1,
  ChannelTypeGroup: 2,
}));

import { ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../../Service/Const";
import { shouldShowExternalBadge } from "../externalBadge";

const info = (isExternal?: number) =>
  ({ orgData: { is_external_group: isExternal } } as any);

describe("shouldShowExternalBadge", () => {
  it("外部群本身 → true", () => {
    expect(shouldShowExternalBadge(ChannelTypeGroup, info(1))).toBe(true);
  });

  it("独立群非外部 → false（原有行为不回归）", () => {
    expect(shouldShowExternalBadge(ChannelTypeGroup, info(0))).toBe(false);
    expect(shouldShowExternalBadge(ChannelTypeGroup, info())).toBe(false);
  });

  it("外部群 thread：父群 is_external_group === 1 → true", () => {
    expect(
      shouldShowExternalBadge(ChannelTypeCommunityTopic, info(), info(1))
    ).toBe(true);
  });

  it("内部群 thread：父群非外部 → false（避免误报）", () => {
    expect(
      shouldShowExternalBadge(ChannelTypeCommunityTopic, info(), info(0))
    ).toBe(false);
  });

  it("父群 channelInfo 未加载 → false（fail-close，不误报）", () => {
    expect(
      shouldShowExternalBadge(ChannelTypeCommunityTopic, info(), undefined)
    ).toBe(false);
  });

  it("thread 自身 is_external_group 不参与判定（只看父群）", () => {
    expect(
      shouldShowExternalBadge(ChannelTypeCommunityTopic, info(1), undefined)
    ).toBe(false);
  });
});
