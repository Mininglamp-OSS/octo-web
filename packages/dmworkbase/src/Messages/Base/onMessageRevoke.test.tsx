// @vitest-environment jsdom
//
// 五审 blocker(Jerry-Xin):气泡撤回入口 onMessageRevoke 原为同步、未 await
// conversationProvider.revokeMessage 即补点 —— 撤回被 reject 时仍记 phantom success,
// 且悬空 promise 未处理。修复:改 async,await 成功后才 trackMessageRevoked,失败 Toast 且不补点。
// 本用例直接在 prototype 上以最小 this 调 onMessageRevoke,覆盖 resolve / reject 两路 + 先后次序。
import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const trackMessageRevoked = vi.fn(() => { order.push("track"); });
vi.mock("../../Service/trackMessage", () => ({
  trackMessageRevoked: (...a: unknown[]) => (trackMessageRevoked as any)(...a),
}));

const toastError = vi.fn();
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: (...a: unknown[]) => (toastError as any)(...a) },
  Popconfirm: () => null,
}));

// MessageBase 顶层 import 了 ../../App(WKApp 单例),构造函数会读 WKApp.conversationProvider;
// 但本测试直接调 prototype.onMessageRevoke 并注入 this,不走构造函数,给个空壳即可。
vi.mock("../../App", () => ({ default: { conversationProvider: {} } }));

import MessageBase from "./index";

function makeInst(revokeImpl: () => Promise<void>) {
  return {
    props: { message: { message: { clientSeq: 42, channel: { channelType: 2 } } } },
    conversationProvider: { revokeMessage: vi.fn(revokeImpl) },
  } as any;
}

describe("MessageBase.onMessageRevoke — await-then-track(五审 blocker)", () => {
  beforeEach(() => {
    order.length = 0;
    trackMessageRevoked.mockClear();
    toastError.mockClear();
  });

  it("撤回成功后才补点 message_revoked(带富属性)", async () => {
    const inst = makeInst(() => Promise.resolve());
    await MessageBase.prototype.onMessageRevoke.call(inst);

    expect(inst.conversationProvider.revokeMessage).toHaveBeenCalledTimes(1);
    expect(trackMessageRevoked).toHaveBeenCalledTimes(1);
    expect(trackMessageRevoked).toHaveBeenCalledWith(42, 2);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("撤回被 reject 时不补点(无 phantom success),改 Toast 提示", async () => {
    const inst = makeInst(() => Promise.reject({ msg: "boom" }));
    await MessageBase.prototype.onMessageRevoke.call(inst);

    expect(trackMessageRevoked).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("boom");
  });

  it("补点严格发生在 revoke promise 兑现之后(次序)", async () => {
    let resolveRevoke!: () => void;
    const inst = makeInst(
      () => new Promise<void>((r) => { resolveRevoke = () => { order.push("revoke"); r(); }; }),
    );

    const p = MessageBase.prototype.onMessageRevoke.call(inst);
    // revoke 尚未兑现:绝不能提前补点
    await Promise.resolve();
    expect(trackMessageRevoked).not.toHaveBeenCalled();

    resolveRevoke();
    await p;

    expect(trackMessageRevoked).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["revoke", "track"]);
  });
});
