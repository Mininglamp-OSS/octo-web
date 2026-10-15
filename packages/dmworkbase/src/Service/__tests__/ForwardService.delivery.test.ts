import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, MediaMessageContent, MessageTask, MessageText, SendackPacket, SendPacket, TaskStatus } from "wukongimjssdk";
import { ForwardService } from "../ForwardService";
import { interpretForwardResult } from "../forwardResultToast";

vi.mock("../../Utils/groupDisband", () => ({ isConversationDisbanded: () => false }));
vi.mock("../../im-runtime/channelRuntime", () => ({ getImChannelInfo: () => undefined }));
vi.mock("../Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }));

// Use the actual SDK send(), upload task dispatch and ACK fan-out. Only the network is held.
const sdk = WKSDK.shared();
const target = new Channel("forward-test", 2);
class HeldUpload extends MessageTask { start() {} }
class FileContent extends MediaMessageContent {
    get contentType() { return 4; }
    encodeJSON() { return { name: "file.pdf", url: this.remoteUrl }; }
}
let uploads: HeldUpload[];
let packets: SendPacket[];
let autoAck: boolean;
let ackReason: (packet: SendPacket) => number;
let earlyUploadFailure: boolean;
let removeAck: ReturnType<typeof vi.spyOn>;
let removeTask: ReturnType<typeof vi.spyOn>;
const payload = (packet: SendPacket) => JSON.parse(new TextDecoder().decode(packet.payload));
const acknowledge = (packet: SendPacket, reasonCode = 1) => {
    const ack = new SendackPacket();
    ack.clientSeq = packet.clientSeq;
    ack.reasonCode = reasonCode;
    sdk.chatManager.notifyMessageStatusListeners(ack);
};
function media() {
    const content = new FileContent();
    content.file = new File(["bytes"], "file.pdf");
    // Previously sent local media retain both file and remoteUrl, and SDK still re-uploads them.
    content.remoteUrl = "https://test.invalid/uploaded.pdf";
    return content;
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
    vi.useFakeTimers();
    uploads = [];
    packets = [];
    autoAck = false;
    earlyUploadFailure = false;
    ackReason = () => 1;
    const capture = (packet: SendPacket) => {
        packets.push(packet);
        if (autoAck) acknowledge(packet, ackReason(packet));
    };
    vi.spyOn(sdk.chatManager, "sendSendPacket").mockImplementation(capture);
    vi.spyOn(sdk.connectManager, "sendPacket").mockImplementation(packet => {
        if (packet instanceof SendPacket) capture(packet);
    });
    vi.spyOn(sdk.config.provider, "messageUploadTask").mockImplementation(message => {
        const task = new HeldUpload(message);
        if (earlyUploadFailure) task.start = () => { task.status = TaskStatus.fail; task.update(); };
        uploads.push(task);
        return task;
    });
    removeAck = vi.spyOn(sdk.chatManager, "removeMessageStatusListener");
    removeTask = vi.spyOn(sdk.taskManager, "removeListener");
});

afterEach(() => {
    for (const task of uploads) sdk.taskManager.removeTask(task.id);
    sdk.chatManager.sendingQueues.clear();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe("forwarding with actual SDK delivery events", () => {
    it.each(["serial", "parallel"] as const)("waits for media upload and ACK before the comment (%s)", async messageMode => {
        const onSent = vi.fn();
        const result = ForwardService.send([target], media, { comment: "note", messageMode, onSent });
        await flush();
        expect(uploads).toHaveLength(1);
        expect(onSent).toHaveBeenCalledOnce(); // Local bubble must not wait for upload/ACK.
        expect(packets).toHaveLength(0);
        uploads[0].status = TaskStatus.success;
        uploads[0].update();
        await flush();
        expect(packets.map(payload)).toEqual([expect.objectContaining({ name: "file.pdf" })]);
        acknowledge(packets[0]);
        await flush();
        expect(packets.map(payload)).toEqual([
            expect.objectContaining({ name: "file.pdf" }), expect.objectContaining({ content: "note" }),
        ]);
        acknowledge(packets[1]);
        expect(await result).toMatchObject({ failedTargets: 0, messageAttempts: 1, failedMessages: 0 });
        await flush();
        expect(removeAck).toHaveBeenCalledTimes(2);
        expect(removeTask).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([TaskStatus.fail, TaskStatus.cancel])("skips the comment on upload failure/cancellation (%s)", async status => {
        const result = ForwardService.send([target], media, { comment: "note" });
        await flush();
        uploads[0].status = status;
        uploads[0].update();
        expect(await result).toMatchObject({ failedTargets: 1, failedMessages: 1 });
        expect(packets).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("catches upload failure before SDK.send has returned the message", async () => {
        earlyUploadFailure = true;
        const result = await ForwardService.send([target], media, { comment: "note" });
        expect(result.failedTargets).toBe(1);
        expect(packets).toHaveLength(0);
        expect(removeTask).toHaveBeenCalledOnce();
    });

    it.each([1, 11])("waits for every parallel original and skips comments if the last ACK fails (%s)", async reason => {
        const result = ForwardService.send([target], () => [new MessageText("first"), new MessageText("last")], {
            comment: "note", messageMode: "parallel",
        });
        await flush();
        expect(packets).toHaveLength(2);
        acknowledge(packets[0]);
        await flush();
        expect(packets).toHaveLength(2);
        acknowledge(packets[1], reason);
        await flush();
        if (reason === 1) {
            expect(payload(packets[2]).content).toBe("note");
            acknowledge(packets[2]);
        } else expect(packets).toHaveLength(2);
        expect((await result).failedMessages).toBe(reason === 1 ? 0 : 1);
    });

    it("handles synchronous ACKs and keeps comment rejection out of original counts", async () => {
        autoAck = true;
        ackReason = packet => payload(packet).content === "note" ? 11 : 1;
        const result = await ForwardService.send([target], () => new MessageText("original"), { comment: "note" });
        expect(result).toMatchObject({ targets: 1, failedTargets: 0, messageAttempts: 1, failedMessages: 0 });
        expect(result.commentFailures).toHaveLength(1);
        expect(interpretForwardResult(result, "targets").kind).toBe("success");
        expect(interpretForwardResult(result, "messages").kind).toBe("success");
        expect(removeAck).toHaveBeenCalledTimes(2);
    });

    it("releases listeners and skips comments when ACK times out", async () => {
        const result = ForwardService.send([target], () => new MessageText("original"), { comment: "note" });
        await flush();
        await vi.advanceTimersByTimeAsync(30_000);
        expect((await result).failedTargets).toBe(1);
        expect(packets).toHaveLength(1);
        acknowledge(packets[0]); // Late success cannot resurrect a completed operation.
        await flush();
        expect(packets).toHaveLength(1);
        expect(removeAck).toHaveBeenCalledOnce();
        expect(removeTask).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cleans up and aborts when the source expires during upload", async () => {
        let active = true;
        const result = ForwardService.send([target], media, { comment: "note", isActive: () => active });
        const rejection = expect(result).rejects.toThrow("Forward context expired");
        await flush();
        active = false;
        await vi.advanceTimersByTimeAsync(250);
        await rejection;
        expect(packets).toHaveLength(0);
        expect(removeTask).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves no observers when enqueueing throws", async () => {
        await ForwardService.send([target], () => new MessageText("original"), {
            comment: "note", sender: async () => { throw new Error("enqueue failed"); },
        });
        expect(removeAck).toHaveBeenCalledOnce();
        expect(removeTask).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("preserves enqueue-only completion when the comment is empty", async () => {
        const result = await ForwardService.send([target], media, { comment: "" });
        expect(result.failedMessages).toBe(0);
        expect(uploads).toHaveLength(1);
        expect(removeAck).not.toHaveBeenCalled();
    });
});
