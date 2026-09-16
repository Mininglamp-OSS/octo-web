import WKSDK, { type Conversation } from "wukongimjssdk";
import { captureCurrentImConversationSyncContext } from "./conversationSyncContext";

export interface ImConversationSyncResult {
  conversations: Conversation[];
  isCurrent: () => boolean;
  commit: (conversations?: Conversation[]) => boolean;
}

interface SyncRequest {
  isCurrent: () => boolean;
  promise?: Promise<ImConversationSyncResult | undefined>;
}
const requests = new WeakMap<WKSDK, SyncRequest>();

export function syncCurrentImConversations(
  options: { reuseCurrent?: boolean; canCommit?: () => boolean; deferCommit?: boolean } = {},
): Promise<ImConversationSyncResult | undefined> {
  const sdk = WKSDK.shared();
  const existing = requests.get(sdk);
  // Initial title hydration must not supersede Chat's pending list/pin hydration.
  if (options.reuseCurrent && existing?.isCurrent() && existing.promise) return existing.promise;
  const provider = sdk.config.provider;
  const callback = provider.syncConversationsCallback;
  const contextIsCurrent = captureCurrentImConversationSyncContext();
  const isCurrent = () => (
    contextIsCurrent() &&
    (options.canCommit?.() ?? true) &&
    WKSDK.shared() === sdk &&
    sdk.config.provider === provider &&
    provider.syncConversationsCallback === callback &&
    requests.get(sdk) === request
  );
  const request: SyncRequest = { isCurrent };
  requests.set(sdk, request);
  request.promise = run();
  return request.promise;

  async function run(): Promise<ImConversationSyncResult | undefined> {
    let conversations: Conversation[];
    try {
      // SDK.sync() writes its cache in an unguarded .then before returning to callers.
      // Use the same provider and commit here only while this request still owns it.
      conversations = await callback.call(provider, { canCommit: isCurrent });
    } catch (error) {
      if (!isCurrent()) return;
      requests.delete(sdk);
      throw error;
    }
    if (!isCurrent()) return;

    let committed = false;
    const commit = (accepted = conversations): boolean => {
      if (committed || !isCurrent()) return false;
      committed = true;
      const manager = sdk.conversationManager;
      manager.conversations = accepted;
      for (const conversation of [...conversations, ...accepted]) {
        const version = conversation.remoteExtra?.version;
        if (version !== undefined && version > manager.maxExtraVersion) {
          manager.maxExtraVersion = version;
        }
      }
      // Preserve the SDK's fire-and-forget reminder hydration and error isolation.
      try {
        void Promise.resolve(sdk.reminderManager.sync()).catch((error: unknown) => {
          console.error("[im-conversation-sync] reminder sync failed", error);
        });
      } catch (error) {
        console.error("[im-conversation-sync] reminder sync failed", error);
      }
      return true;
    };
    if (!options.deferCommit) commit();
    return { conversations, isCurrent, commit };
  }
}
