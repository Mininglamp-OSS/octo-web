import type { Message } from "wukongimjssdk";

const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

interface SentEntry {
  key: string;
  content: string;
  updatedAt: number;
}

type Stage =
  | "user_message_sending"
  | "user_message_sent"
  | "card_action_submitting"
  | "completed";

export interface ActionMessageSenderOptions {
  operationKey: string;
  content: string;
  sendMessage: () => Promise<Message>;
  submitAction: () => Promise<unknown>;
  onStage?: (stage: Stage) => void;
}

export interface ActionMessageSenderResult {
  message?: Message;
  reusedMessage: boolean;
}

const memoryEntries = new Map<string, SentEntry>();
const inFlightSends = new Map<string, Promise<Message>>();

function findEntry(key: string, content: string): SentEntry | undefined {
  const now = Date.now();
  for (const [entryKey, entry] of memoryEntries) {
    if (now - entry.updatedAt >= ENTRY_TTL_MS) {
      memoryEntries.delete(entryKey);
    }
  }
  const entry = memoryEntries.get(key);
  return entry?.content === content ? entry : undefined;
}

function writeEntry(entry: SentEntry): void {
  memoryEntries.set(entry.key, entry);
}

/** Send a durable user message once, then run the card action. */
export async function sendActionWithCurrentUserMessage(
  options: ActionMessageSenderOptions
): Promise<ActionMessageSenderResult> {
  let entry = findEntry(options.operationKey, options.content);
  let message: Message | undefined;
  let reusedMessage = false;

  if (entry) {
    reusedMessage = true;
  } else {
    options.onStage?.("user_message_sending");
    const sendKey = `${options.operationKey}\u0000${options.content}`;
    let sendPromise = inFlightSends.get(sendKey);
    if (!sendPromise) {
      sendPromise = options.sendMessage();
      inFlightSends.set(sendKey, sendPromise);
    }
    try {
      message = await sendPromise;
    } finally {
      if (inFlightSends.get(sendKey) === sendPromise)
        inFlightSends.delete(sendKey);
    }
    entry = {
      key: options.operationKey,
      content: options.content,
      updatedAt: Date.now(),
    };
    writeEntry(entry);
    options.onStage?.("user_message_sent");
  }

  options.onStage?.("card_action_submitting");
  await options.submitAction();
  writeEntry({ ...entry, updatedAt: Date.now() });
  options.onStage?.("completed");
  return { message, reusedMessage };
}
