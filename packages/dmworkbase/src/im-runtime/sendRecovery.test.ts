import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BigNumber from "bignumber.js";
import WKSDK, {
  Channel,
  MessageText,
  SendPacket,
  SendackPacket,
  Setting,
} from "wukongimjssdk";
import {
  connectWithSendRecovery,
  installSendRecovery,
  SEND_CANCELED,
  SEND_QUEUE_BUSY,
  SEND_OUTCOME_UNKNOWN,
  type SendRecovery,
} from "./sendRecovery";

describe("bounded SDK send recovery", () => {
  let sdk: WKSDK;
  let control: SendRecovery;
  let wire: ReturnType<typeof vi.spyOn>;
  let status: ReturnType<typeof vi.spyOn>;
  let connected: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sdk = WKSDK.shared();
    sdk.config.uid = "sender";
    sdk.config.token = "test-session";
    sdk.chatManager.sendingQueues.clear();
    sdk.chatManager.sendPacketQueue.length = 0;
    connected = vi.spyOn(sdk.connectManager, "connected").mockReturnValue(true);
    wire = vi
      .spyOn(sdk.connectManager, "sendPacket")
      .mockImplementation(() => {});
    status = vi
      .spyOn(sdk.chatManager, "notifyMessageStatusListeners")
      .mockImplementation(() => {});
    control = installSendRecovery(sdk);
  });

  afterEach(() => {
    control.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function packet(noPersist = false) {
    const p = new SendPacket();
    p.clientSeq = sdk.chatManager.getClientSeq();
    p.clientMsgNo = `logical-${p.clientSeq}`;
    p.channelID = "room";
    p.channelType = 2;
    p.setting = new Setting();
    p.payload = new Uint8Array([1, 2, 3]);
    p.noPersist = noPersist;
    sdk.chatManager.sendingQueues.set(p.clientSeq, p);
    return p;
  }

  async function ack(seq: number, reason: number) {
    const p = new SendackPacket();
    p.clientSeq = seq;
    p.reasonCode = reason;
    p.messageSeq = 7;
    p.messageID = new BigNumber(123) as unknown as SendackPacket["messageID"];
    await sdk.chatManager.onPacket(p);
  }

  it("uses a stable logical message and a different sequence for each wire attempt", async () => {
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    p.payload[0] = 99;
    p.setting.topic = true;
    await vi.advanceTimersByTimeAsync(2200);
    expect(wire).toHaveBeenCalledTimes(2);
    const first = wire.mock.calls[0][0] as SendPacket;
    const second = wire.mock.calls[1][0] as SendPacket;
    expect(second.clientMsgNo).toBe(first.clientMsgNo);
    expect(second.clientSeq).not.toBe(first.clientSeq);
    expect(second.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(second.setting.topic).toBe(false);
    await ack(second.clientSeq, 1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0]).toMatchObject({
      clientSeq: p.clientSeq,
      messageSeq: 7,
      reasonCode: 1,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).toHaveBeenCalledTimes(2);
    expect(sdk.chatManager.sendingQueues.size).toBe(0);
  });

  it("ignores old negative ACKs and accepts success from an earlier attempt once", async () => {
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(2200);
    await ack(p.clientSeq, 11);
    expect(status).not.toHaveBeenCalled();
    await ack(p.clientSeq, 1);
    await ack((wire.mock.calls[1][0] as SendPacket).clientSeq, 11);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0].reasonCode).toBe(1);
  });

  it("stops on a permission rejection without disproving an earlier ambiguous send", async () => {
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(100);
    await ack(p.clientSeq, 18);
    expect(status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(wire).toHaveBeenCalledTimes(2);
    await ack((wire.mock.calls[1][0] as SendPacket).clientSeq, 11);
    expect(status.mock.calls[0][0].reasonCode).toBe(SEND_OUTCOME_UNKNOWN);
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("reports a definitive permission rejection on the first attempt", async () => {
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(100);
    await ack(p.clientSeq, 11);
    expect(status.mock.calls[0][0].reasonCode).toBe(11);
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("settles unknown after bounded attempts without claiming a storage failure", async () => {
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).toHaveBeenCalledTimes(6);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0].reasonCode).toBe(SEND_OUTCOME_UNKNOWN);
    expect(sdk.chatManager.sendingQueues.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replay non-persistent messages, including on reconnect", async () => {
    const p = packet(true);
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(100);
    sdk.chatManager.flushSendingQueue();
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0].reasonCode).toBe(SEND_OUTCOME_UNKNOWN);
  });

  it("does not transmit unfinished uploads during reconnect", async () => {
    const p = packet();
    sdk.chatManager.flushSendingQueue();
    await vi.advanceTimersByTimeAsync(5000);
    expect(wire).not.toHaveBeenCalled();
    // This is the SDK's successful upload task callback boundary.
    sdk.connectManager.sendPacket(p);
    await vi.advanceTimersByTimeAsync(100);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("waits for reconnect without counting disconnected ticks as send attempts", async () => {
    connected.mockReturnValue(false);
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(5000);
    expect(wire).not.toHaveBeenCalled();
    connected.mockReturnValue(true);
    sdk.chatManager.flushSendingQueue();
    await vi.advanceTimersByTimeAsync(300);
    expect(wire).toHaveBeenCalledTimes(1);
    expect((wire.mock.calls[0][0] as SendPacket).clientSeq).toBe(p.clientSeq);
  });

  it("clears ready packets and unfinished uploads on account replacement", async () => {
    const first = packet();
    sdk.chatManager.sendSendPacket(first);
    const upload = packet();
    await vi.advanceTimersByTimeAsync(100);
    sdk.config.uid = "other-account";
    await vi.advanceTimersByTimeAsync(100);
    expect(sdk.chatManager.sendingQueues.has(upload.clientSeq)).toBe(false);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0].reasonCode).toBe(SEND_CANCELED);
    await ack(first.clientSeq, 1);
    expect(status).toHaveBeenCalledTimes(1);
    const next = packet();
    sdk.chatManager.sendSendPacket(next);
    await vi.advanceTimersByTimeAsync(100);
    await ack(next.clientSeq, 1);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("clears ready sends and unfinished uploads on explicit disconnect", async () => {
    const ready = packet();
    const upload = packet();
    sdk.chatManager.sendSendPacket(ready);
    await vi.advanceTimersByTimeAsync(100);
    sdk.connectManager.disconnect();
    expect(sdk.chatManager.sendingQueues.size).toBe(0);
    sdk.connectManager.sendPacket(upload);
    sdk.chatManager.flushSendingQueue();
    await ack(ready.clientSeq, 1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0].reasonCode).toBe(SEND_CANCELED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports cancellation when an owner resets pending sends", async () => {
    const ready = packet();
    sdk.chatManager.sendSendPacket(ready);
    await vi.advanceTimersByTimeAsync(100);

    control.reset();

    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0]).toMatchObject({
      clientSeq: ready.clientSeq,
      reasonCode: SEND_CANCELED,
    });
    expect(sdk.chatManager.sendingQueues.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not consume the send lifetime while disconnected", async () => {
    connected.mockReturnValue(false);
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(60000);
    expect(wire).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    connected.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("preserves direct SDK sends that are outside the managed queue", () => {
    const p = packet();
    sdk.chatManager.sendingQueues.delete(p.clientSeq);
    sdk.connectManager.sendPacket(p);
    expect(wire).toHaveBeenCalledWith(p);
  });

  it("installs before connect and re-baselines the account afterward", () => {
    control.dispose();
    const order: string[] = [];
    const send = sdk.chatManager.sendSendPacket;
    control = connectWithSendRecovery(sdk, true, () => {
      order.push("connect");
      expect(sdk.chatManager.sendSendPacket).not.toBe(send);
      sdk.config.uid = "connected-account";
    })!;
    order.push("done");
    expect(order).toEqual(["connect", "done"]);
    const p = packet();
    sdk.chatManager.sendSendPacket(p);
    expect(sdk.chatManager.sendingQueues.has(p.clientSeq)).toBe(true);
  });

  it("fences old upload completion before starting a new account upload", async () => {
    const oldUpload = packet();
    sdk.config.uid = "other-account";
    sdk.config.token = "other-token";
    control.syncAccount();
    const newUpload = packet();
    sdk.connectManager.sendPacket(oldUpload);
    sdk.connectManager.sendPacket(newUpload);
    await vi.advanceTimersByTimeAsync(100);
    expect(wire).toHaveBeenCalledTimes(1);
    expect((wire.mock.calls[0][0] as SendPacket).clientMsgNo).toBe(
      newUpload.clientMsgNo
    );
  });

  it("publishes a single local echo through the actual SDK send method", async () => {
    const echo = vi
      .spyOn(sdk.chatManager, "notifyMessageListeners")
      .mockImplementation(() => {});
    const message = await sdk.chatManager.send(
      new MessageText("test"),
      new Channel("room", 2)
    );
    await vi.advanceTimersByTimeAsync(2200);
    expect(echo).toHaveBeenCalledTimes(1);
    expect((wire.mock.calls[0][0] as SendPacket).clientMsgNo).toBe(
      message.clientMsgNo
    );
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("installs once and bounds retained payload bytes", async () => {
    expect(installSendRecovery(sdk)).toBe(control);
    const p = packet();
    p.payload = new Uint8Array(9 * 1024 * 1024);
    sdk.chatManager.sendSendPacket(p);
    await vi.advanceTimersByTimeAsync(0);
    expect(wire).not.toHaveBeenCalled();
    expect(status.mock.calls[0][0].reasonCode).toBe(SEND_QUEUE_BUSY);
    expect(sdk.chatManager.sendingQueues.size).toBe(0);
  });
});
