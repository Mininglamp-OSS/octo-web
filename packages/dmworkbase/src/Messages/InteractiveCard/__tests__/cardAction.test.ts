// cardAction：no-data 提交请求体 + 响应/错误分类。mock WKApp 避免加载重型 App。

import { describe, expect, it, vi, beforeEach } from "vitest";

const { postMock, uuidMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  uuidMock: vi.fn(() => "uuid-test"),
}));

vi.mock("../../../App", () => ({
  default: {
    shared: { generateUUID: uuidMock },
    apiClient: { post: postMock },
  },
}));

// person=1，与真实 ChannelTypePerson 一致（避免测试拉起重型 SDK）。
vi.mock("wukongimjssdk", () => ({
  ChannelTypePerson: 1,
}));

import {
  submitCardAction,
  isRetryableCardActionError,
  resolveCardActionChannelId,
} from "../cardAction";

const params = {
  messageId: "m1",
  channelId: "c1",
  channelType: 2,
  actionId: "approve",
  inputs: { note: "hi" },
};

beforeEach(() => {
  postMock.mockReset();
});

describe("submitCardAction — 请求体（D11 no-data）", () => {
  it("路径正确、字段齐、带 client_token，且绝不含 data", async () => {
    postMock.mockResolvedValue({ accepted: true, replay: false });
    const res = await submitCardAction(params);
    expect(postMock).toHaveBeenCalledTimes(1);
    const [path, body] = postMock.mock.calls[0];
    expect(path).toBe("message/card/action");
    expect(body).not.toHaveProperty("data");
    expect(body).toEqual({
      message_id: "m1",
      channel_id: "c1",
      channel_type: 2,
      action_id: "approve",
      inputs: { note: "hi" },
      client_token: "uuid-test",
    });
    expect(res).toEqual({ accepted: true, replay: false });
  });

  it("replay 视为成功", async () => {
    postMock.mockResolvedValue({ accepted: true, replay: true });
    expect((await submitCardAction(params)).replay).toBe(true);
  });

  it("缺字段保守视为已受理", async () => {
    postMock.mockResolvedValue({});
    expect((await submitCardAction(params)).accepted).toBe(true);
  });
});

describe("resolveCardActionChannelId — person DM 对端塌缩兜底", () => {
  const SELF = "self-uid";

  it("person DM channelID 塌缩为 self → 回退到 fromUID（对端 bot）", () => {
    expect(
      resolveCardActionChannelId({
        channelType: 1,
        channelID: SELF,
        fromUID: "notification",
        selfUID: SELF,
      })
    ).toBe("notification");
  });

  it("person DM channelID 已是对端 → 原样返回（既有路径不变）", () => {
    expect(
      resolveCardActionChannelId({
        channelType: 1,
        channelID: "peer-uid",
        fromUID: "peer-uid",
        selfUID: SELF,
      })
    ).toBe("peer-uid");
  });

  it("group（channelType=2）任意 channelID → 原样返回（既有路径不变）", () => {
    expect(
      resolveCardActionChannelId({
        channelType: 2,
        channelID: SELF,
        fromUID: "notification",
        selfUID: SELF,
      })
    ).toBe(SELF);
  });

  it("防御：channelID===self 但 fromUID 缺失 → 保留 channelID，不崩", () => {
    expect(
      resolveCardActionChannelId({
        channelType: 1,
        channelID: SELF,
        fromUID: undefined,
        selfUID: SELF,
      })
    ).toBe(SELF);
  });

  it("防御：selfUID 缺失 → 保留 channelID（无法判定塌缩）", () => {
    expect(
      resolveCardActionChannelId({
        channelType: 1,
        channelID: "peer-uid",
        fromUID: "notification",
        selfUID: undefined,
      })
    ).toBe("peer-uid");
  });
});

describe("isRetryableCardActionError — 409/5xx 可重试；400/403 终态", () => {
  it("409 进行中 → 可重试", () => {
    expect(isRetryableCardActionError({ status: 409 })).toBe(true);
  });
  it("5xx → 可重试", () => {
    expect(isRetryableCardActionError({ status: 500 })).toBe(true);
    expect(isRetryableCardActionError({ status: 503 })).toBe(true);
  });
  it("400/403 → 不重试", () => {
    expect(isRetryableCardActionError({ status: 400 })).toBe(false);
    expect(isRetryableCardActionError({ status: 403 })).toBe(false);
  });
  it("无 status → 不重试", () => {
    expect(isRetryableCardActionError(null)).toBe(false);
    expect(isRetryableCardActionError({})).toBe(false);
  });
});
