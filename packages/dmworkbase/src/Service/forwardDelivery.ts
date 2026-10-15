import WKSDK, { MediaMessageContent, Message, MessageContent, MessageStatus, MessageTask, TaskStatus } from "wukongimjssdk";
import type { SendackPacket, Task } from "wukongimjssdk";
import { isSuccessfulSendAck } from "../Utils/sendWaitResult";

/** Register before enqueueing: uploads and ACKs may complete before SDK.send resolves. */
export function observeForwardDelivery(content: MessageContent, isActive?: () => boolean) {
    const sdk = WKSDK.shared();
    let clientSeq: number | undefined;
    let settled = false;
    const earlyResults = new Map<number, Error | undefined>();
    let resolve!: (error: Error | undefined) => void;
    // Resolve with the outcome so early failures never create an unhandled rejection.
    const outcome = new Promise<Error | undefined>((done) => { resolve = done; });
    const uploadMs = content instanceof MediaMessageContent && content.file
        ? Math.max(120_000, content.file.size / (1024 * 1024) * 10_000)
        : 0;
    const timeout = setTimeout(() => finish(new Error("Forward delivery acknowledgement timed out")), uploadMs + 30_000);
    const scopeCheck = isActive ? setInterval(() => {
        if (!isActive()) finish(new Error("Forward context expired"));
    }, 250) : undefined;

    function finish(error?: Error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(scopeCheck);
        earlyResults.clear();
        // SDK notifies by iterating mutable arrays; removing synchronously skips the next listener.
        queueMicrotask(() => {
            sdk.chatManager.removeMessageStatusListener(onAck);
            sdk.taskManager.removeListener(onTask);
        });
        resolve(error);
    }

    function accept(seq: number, error?: Error) {
        if (settled) return;
        if (clientSeq === undefined) earlyResults.set(seq, error);
        else if (seq === clientSeq) finish(error);
    }

    function onAck(ack: SendackPacket) {
        accept(ack.clientSeq, isSuccessfulSendAck(ack)
            ? undefined : new Error(`Forward delivery rejected (${ack.reasonCode})`));
    }

    function onTask(task: Task) {
        if (task instanceof MessageTask && (task.status === TaskStatus.fail || task.status === TaskStatus.cancel)) {
            accept(task.message.clientSeq, new Error("Forward media upload failed or was cancelled"));
        }
    }

    sdk.chatManager.addMessageStatusListener(onAck);
    sdk.taskManager.addListener(onTask);
    return {
        async wait(message: Message): Promise<void> {
            clientSeq = message.clientSeq;
            if (!settled) {
                if (earlyResults.has(clientSeq)) finish(earlyResults.get(clientSeq));
                else if (message.status === MessageStatus.Normal) finish();
                else if (message.status === MessageStatus.Fail) finish(new Error("Forward delivery failed"));
                earlyResults.clear();
            }
            const error = await outcome;
            if (error) throw error;
        },
        dispose: () => finish(new Error("Forward delivery observation disposed")),
    };
}
