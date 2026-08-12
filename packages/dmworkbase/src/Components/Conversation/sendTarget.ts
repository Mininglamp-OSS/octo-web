/**
 * Reply / edit target capture for the send path (octo-web#1280).
 *
 * `Conversation.onSend` used to read `vm.currentReplyMessage` /
 * `vm.currentHandlerType` at the moment it ran. Once sends are queued that read
 * can happen seconds later, after the user picked another reply target or
 * switched to "edit message" — a queued send could then reply to the wrong
 * message or, worse, overwrite an unrelated one via `editMessage`.
 *
 * The target is therefore taken out of the view model synchronously when the
 * composer consumes its compose (which also hides the reply/edit banner, so the
 * UI stops inviting a change that can no longer apply), travels with that
 * compose, and is put back if the send never got enqueued so a retry still
 * edits/replies to the original message.
 */

/** The reply/edit slice of the conversation view model. */
export interface SendTargetHost<M> {
  getReplyMessage: () => M | undefined;
  setReplyMessage: (message: M | undefined) => void;
  getHandlerType: () => number;
  setHandlerType: (handlerType: number) => void;
}

export interface CapturedSendTarget<M> {
  /** The reply/edit target as it was when the user pressed send. */
  replyMessage?: M;
  /** 2 = edit an existing message, otherwise reply. Mirrors vm.currentHandlerType. */
  handlerType: number;
  /** Put the captured target back (used when the send was not enqueued). */
  restore: () => void;
}

export interface RecoveredSendTarget<M> {
  replyMessage?: M;
  handlerType: number;
}

/**
 * Read and clear the reply/edit target.
 *
 * `restore()` is deliberately conservative: if the user already selected a new
 * reply/edit target while the send was in flight, the newer selection wins and
 * the captured one is dropped — restoring would silently retarget the user's
 * current intent, which is the class of bug this whole capture exists to avoid.
 */
export function captureSendTarget<M>(
  host: SendTargetHost<M>,
): CapturedSendTarget<M> {
  const replyMessage = host.getReplyMessage();
  const handlerType = host.getHandlerType();

  if (replyMessage) {
    host.setReplyMessage(undefined);
  }

  let restored = false;
  return {
    replyMessage,
    handlerType,
    restore: () => {
      if (restored) return;
      restored = true;
      if (!replyMessage) return;
      if (host.getReplyMessage()) return; // newer selection wins
      host.setReplyMessage(replyMessage);
      host.setHandlerType(handlerType);
    },
  };
}

/** Restore an abandoned target only when no newer reply/edit selection exists. */
export function restoreSendTargetIfVacant<M>(
  host: SendTargetHost<M>,
  target: RecoveredSendTarget<M>,
): boolean {
  if (!target.replyMessage || host.getReplyMessage()) return false;
  host.setReplyMessage(target.replyMessage);
  host.setHandlerType(target.handlerType);
  return true;
}
