import BigNumber from "bignumber.js";
import WKSDK, { Packet, SendPacket, SendackPacket } from "wukongimjssdk";

// Local-only reason; never encoded on the wire or interpreted as server rejection.
export const SEND_OUTCOME_UNKNOWN = 256;
export const SEND_LOCAL_UNAVAILABLE = 257;
export const SEND_QUEUE_BUSY = 258;
export const SEND_CANCELED = 259;
const TRANSIENT_REASONS = new Set([10, 18, 22]); // forward failure, stale node, rate limit
const installations = new WeakMap<WKSDK, SendRecovery>();

type PendingSend = {
  originalSeq: number;
  packet: SendPacket;
  attempts: number;
  latestSeq: number;
  sequences: number[];
  expiresAt: number;
  nextAt: number;
};

export interface SendRecovery {
  reset(): void;
  cancel(): void;
  syncAccount(): void;
  dispose(): void;
}

export function connectWithSendRecovery(
  sdk: WKSDK,
  enabled: boolean,
  connect: () => void
): SendRecovery | undefined {
  const recovery = enabled ? installSendRecovery(sdk) : undefined;
  try {
    connect();
    recovery?.syncAccount();
    return recovery;
  } catch (error) {
    recovery?.dispose();
    throw error;
  }
}

/** Install once, before connecting. SDK batching/reconnect flush cannot own a
 * second retry loop. Only payload-ready packets enter this adapter. */
export function installSendRecovery(sdk: WKSDK): SendRecovery {
  const existing = installations.get(sdk);
  if (existing) {
    existing.syncAccount();
    return existing;
  }
  const chat = sdk.chatManager;
  const connection = sdk.connectManager;
  const original = {
    send: chat.sendSendPacket,
    wire: connection.sendPacket,
    packet: chat.onPacket,
    flush: chat.flushSendingQueue,
    remove: chat.deleteMessageFromSendingQueue,
    disconnect: connection.disconnect,
  };
  const pending = new Map<number, PendingSend>();
  const attempts = new Map<number, PendingSend>();
  const canceledPackets = new WeakSet<SendPacket>();
  const firstManagedSeq = chat.clientSeq + 1;
  let highWaterSeq = chat.clientSeq;
  let account = `${sdk.config.uid}\0${sdk.config.token}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let pendingBytes = 0;
  let epoch = 0;
  let lastPumpAt = Date.now();

  function remove(state: PendingSend) {
    if (pending.get(state.originalSeq) === state)
      pendingBytes -= state.packet.payload.byteLength;
    pending.delete(state.originalSeq);
    chat.sendingQueues.delete(state.originalSeq);
    state.sequences.forEach((seq) => attempts.delete(seq));
  }

  function notify(state: PendingSend, reasonCode: number, ack?: SendackPacket) {
    remove(state);
    const result = ack ?? new SendackPacket();
    result.clientSeq = state.originalSeq;
    result.reasonCode = reasonCode;
    if (!ack) {
      result.messageID = new BigNumber(
        0
      ) as unknown as SendackPacket["messageID"];
      result.messageSeq = 0;
    }
    // The SDK's existing listener path still owns UI reconciliation.
    void original.packet.call(chat, result);
  }

  function checkAccount() {
    const current = `${sdk.config.uid}\0${sdk.config.token}`;
    if (current !== account) {
      reset(true);
      account = current;
    }
  }

  function reset(notifyPending = false) {
    epoch++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (notifyPending) {
      for (const state of [...pending.values()]) notify(state, SEND_CANCELED);
    }
    pending.clear();
    pendingBytes = 0;
    attempts.clear();
    // Includes uploads still waiting for their task callback; a stale upload
    // completion must not send the previous account's packet after login.
    for (const packet of chat.sendingQueues.values()) {
      canceledPackets.add(packet);
    }
    chat.sendingQueues.clear();
    chat.sendPacketQueue.length = 0;
  }

  function arm() {
    if (timer !== undefined || disposed || !pending.size) return;
    timer = setTimeout(pump, 100);
  }

  function pump() {
    timer = undefined;
    checkAccount();
    const now = Date.now();
    const elapsed = Math.max(0, now - lastPumpAt);
    lastPumpAt = now;
    if (!connection.connected()) {
      for (const state of pending.values()) {
        if (state.expiresAt) state.expiresAt += elapsed;
      }
      arm();
      return;
    }
    let sent = 0;
    for (const state of pending.values()) {
      if (
        (state.expiresAt !== 0 && now >= state.expiresAt) ||
        (state.attempts >= 6 && now >= state.nextAt)
      ) {
        notify(
          state,
          state.attempts ? SEND_OUTCOME_UNKNOWN : SEND_LOCAL_UNAVAILABLE
        );
        continue;
      }
      if (now < state.nextAt || sent >= 20) continue;
      const replayable = !state.packet.noPersist && !!state.packet.clientMsgNo;
      if (state.attempts && !replayable) continue;
      const seq = state.attempts ? chat.getClientSeq() : state.originalSeq;
      if (seq > 0x7fffffff) {
        notify(
          state,
          state.attempts ? SEND_OUTCOME_UNKNOWN : SEND_LOCAL_UNAVAILABLE
        );
        continue;
      }
      const wire = Object.assign(new SendPacket(), state.packet, {
        clientSeq: seq,
        payload: state.packet.payload.slice(),
      });
      state.latestSeq = seq;
      state.sequences.push(seq);
      attempts.set(seq, state);
      highWaterSeq = Math.max(highWaterSeq, seq);
      state.attempts++;
      if (!state.expiresAt) state.expiresAt = now + 45000;
      state.nextAt = now + Math.min(2000 * 2 ** (state.attempts - 1), 8000);
      sent++;
      try {
        original.wire.call(connection, wire);
      } catch {
        // The write outcome may be ambiguous. The same bounded timer owns it.
      }
    }
    arm();
  }

  function schedule(packet: SendPacket) {
    checkAccount();
    if (pending.has(packet.clientSeq)) return;
    chat.sendingQueues.set(packet.clientSeq, packet);
    highWaterSeq = Math.max(highWaterSeq, packet.clientSeq);
    const state: PendingSend = {
      originalSeq: packet.clientSeq,
      packet,
      attempts: 0,
      latestSeq: packet.clientSeq,
      sequences: [],
      expiresAt: 0,
      nextAt: Date.now(),
    };
    if (
      pending.size >= 256 ||
      pendingBytes + packet.payload.byteLength > 8 * 1024 * 1024
    ) {
      // Notify after sendWithOptions has published its local echo.
      const expectedEpoch = epoch;
      queueMicrotask(() => {
        if (!disposed && epoch === expectedEpoch)
          notify(state, SEND_QUEUE_BUSY);
      });
      return;
    }
    state.packet = Object.assign(new SendPacket(), packet, {
      payload: packet.payload.slice(),
      setting: Object.assign(
        Object.create(Object.getPrototypeOf(packet.setting)),
        packet.setting
      ),
    });
    pending.set(packet.clientSeq, state);
    pendingBytes += state.packet.payload.byteLength;
    arm();
  }

  chat.sendSendPacket = schedule;
  connection.sendPacket = (packet: Packet) => {
    if (packet instanceof SendPacket) {
      // Includes completed media tasks. Pending uploads never reach this method.
      if (chat.sendingQueues.has(packet.clientSeq)) schedule(packet);
      else if (canceledPackets.has(packet)) return;
      else original.wire.call(connection, packet);
      return;
    }
    original.wire.call(connection, packet);
  };
  chat.flushSendingQueue = () => {
    checkAccount();
    // Do not walk SDK sendingQueues: that map also contains unfinished uploads.
    for (const state of pending.values()) {
      if (
        !state.attempts ||
        (!state.packet.noPersist && state.packet.clientMsgNo)
      ) {
        state.nextAt = Math.min(state.nextAt, Date.now() + 200);
      }
    }
    arm();
  };
  chat.onPacket = async (packet: Packet) => {
    checkAccount();
    if (!(packet instanceof SendackPacket))
      return original.packet.call(chat, packet);
    const state = attempts.get(packet.clientSeq);
    if (!state) {
      // SDK sequences never reset on reconnect/logout. Suppress late ACKs for
      // settled attempts without keeping an unbounded tombstone map.
      if (
        packet.clientSeq >= firstManagedSeq &&
        packet.clientSeq <= highWaterSeq
      )
        return;
      return original.packet.call(chat, packet);
    }
    if (packet.reasonCode === 1) {
      notify(state, 1, packet); // success from any attempt establishes the result
    } else if (packet.clientSeq === state.latestSeq) {
      if (
        TRANSIENT_REASONS.has(packet.reasonCode) &&
        !state.packet.noPersist &&
        state.packet.clientMsgNo
      ) {
        state.nextAt =
          Date.now() + Math.min(500 * 2 ** (state.attempts - 1), 4000);
        arm();
      } else {
        // A rejection of this attempt cannot disprove a commit by an earlier
        // attempt whose ACK was lost. Stop retrying without claiming absence.
        if (state.attempts > 1) notify(state, SEND_OUTCOME_UNKNOWN);
        else notify(state, packet.reasonCode, packet);
      }
    }
  };
  chat.deleteMessageFromSendingQueue = (seq: number) => {
    const state = pending.get(seq);
    if (state) remove(state);
    original.remove.call(chat, seq);
  };
  connection.disconnect = () => {
    reset(true);
    original.disconnect.call(connection);
  };

  const control: SendRecovery = {
    reset: () => reset(true),
    cancel: () => reset(true),
    syncAccount: checkAccount,
    dispose() {
      reset(true);
      disposed = true;
      chat.sendSendPacket = original.send;
      connection.sendPacket = original.wire;
      chat.onPacket = original.packet;
      chat.flushSendingQueue = original.flush;
      chat.deleteMessageFromSendingQueue = original.remove;
      connection.disconnect = original.disconnect;
      installations.delete(sdk);
    },
  };
  installations.set(sdk, control);
  return control;
}
