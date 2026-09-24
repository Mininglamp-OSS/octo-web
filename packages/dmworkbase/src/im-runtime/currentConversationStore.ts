import WKSDK, { Channel, ConnectStatus, Conversation, type ConnectStatusListener } from "wukongimjssdk";
import WKApp from "../App";
import { ConversationWrap } from "../Service/Model";
import PinnedService from "../Service/PinnedService";
import { ChannelTypeCommunityTopic } from "../Service/Const";
import { parseThreadChannelId } from "../Service/Thread";
import { addImChannelInfoListener } from "./channelRuntime";
import { addImConnectStatusListener, isImConnected, removeImConnectStatusListener } from "./connectStatus";
import { captureCurrentImConversationSyncContext } from "./conversationSyncContext";
import { prepareCurrentImConversationSnapshot } from "./conversationSnapshot";
import { syncCurrentImConversations } from "./currentConversationSync";
import { createConversationRealtimeHandlers } from "./conversationRealtime";
import { spaceUnreadStore } from "../features/space-unread/store";

export type ConversationStoreChange = "data" | "update" | "space" | "connection";
export type ConversationFreshness = "loading" | "ready" | "stale" | "unavailable";
export interface ConversationStoreSnapshot {
  conversations: readonly ConversationWrap[];
  loading: boolean;
  freshness: ConversationFreshness;
  revision: number;
}

const stores = new WeakMap<WKSDK, CurrentImConversationStore>();

/** One data owner per SDK realm. Retaining it never creates an IM connection. */
export function getCurrentImConversationStore(): CurrentImConversationStore {
  const sdk = WKSDK.shared();
  let store = stores.get(sdk);
  if (!store || store.disposed) {
    store = new CurrentImConversationStore(sdk);
    stores.set(sdk, store);
  }
  return store;
}

export class CurrentImConversationStore {
  conversations: ConversationWrap[] = [];
  loading = true;
  freshness: ConversationFreshness = "loading";
  readonly pendingSpaceConversations = new Map<string, Conversation>();
  readonly lastThreadStatusByChannel = new Map<string, number | undefined>();
  disposed = false;
  private revision = 0;
  private requestRevision = 0;
  private lifecycleRevision = 0;
  private realtimeRevision = 0;
  private holders = 0;
  private cleanups: Array<() => void> = [];
  private listeners = new Set<(change: ConversationStoreChange) => void>();
  private publishing = false;
  private pendingChanges = new Set<ConversationStoreChange>();
  private contextIsCurrent = captureCurrentImConversationSyncContext();
  private snapshotIsCurrent: () => boolean = () => false;
  private hasSnapshot = false;
  private pending?: { isCurrent: () => boolean; promise: Promise<void> };
  private cancelReconcile?: () => void;

  constructor(readonly sdk: WKSDK) {}

  getSnapshot(): ConversationStoreSnapshot {
    return {
      conversations: this.conversations,
      loading: this.loading,
      freshness: this.freshness,
      revision: this.revision,
    };
  }

  subscribe(listener: (change: ConversationStoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(change: ConversationStoreChange): void {
    if (this.disposed) return;
    this.revision++;
    this.pendingChanges.add(change);
    if (this.publishing) return;
    this.publishing = true;
    try {
      // Reasons carry no stale payload: subscribers read the latest snapshot.
      // Deliver a scope transition to every subscriber even if a prior one refreshes.
      while (this.pendingChanges.size && !this.disposed) {
        const next = this.pendingChanges.values().next().value!;
        this.pendingChanges.delete(next);
        for (const listener of Array.from(this.listeners)) {
          if (this.disposed) break;
          if (!this.listeners.has(listener)) continue;
          try { listener(next); }
          catch (error) { console.error("[im-conversations] subscriber failed", error); }
        }
      }
    } finally {
      this.pendingChanges.clear();
      this.publishing = false;
    }
  }

  retain(options: { syncOnStart?: boolean } = {}): () => void {
    if (this.disposed) throw new Error("Conversation store disposed");
    if (++this.holders === 1) {
      try { this.start(options.syncOnStart !== false); }
      catch (error) { this.holders--; this.stop(); throw error; }
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holders === 0) this.stop();
    };
  }

  /** Also covers a manual refresh that has not acquired a lifecycle holder. */
  stopIfUnowned(): void {
    if (this.holders === 0) this.stop();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    this.conversations = [];
    this.hasSnapshot = false;
    this.loading = true;
    this.freshness = "loading";
  }

  private resetContext(): void {
    this.requestRevision++;
    this.contextIsCurrent = captureCurrentImConversationSyncContext();
    this.pendingSpaceConversations.clear();
    this.lastThreadStatusByChannel.clear();
    this.sdk.conversationManager.conversations = [];
    this.conversations = [];
    this.hasSnapshot = false;
    this.loading = true;
    this.freshness = "loading";
    this.publish("space");
  }

  private start(syncOnStart: boolean): void {
    const lifecycleRevision = ++this.lifecycleRevision;
    if (!this.contextIsCurrent()) this.resetContext();
    this.contextIsCurrent = captureCurrentImConversationSyncContext();
    const isActive = () => !this.disposed && lifecycleRevision === this.lifecycleRevision && WKSDK.shared() === this.sdk;
    if (!isActive()) return;
    const canHandle = () => isActive() && this.contextIsCurrent() && Boolean(WKApp.loginInfo.token);
    const handlers = createConversationRealtimeHandlers(this, canHandle);
    const onConversation: typeof handlers.conversationListener = (...args) => {
      if (!canHandle()) return;
      this.realtimeRevision++;
      handlers.conversationListener(...args);
    };
    const onChannel: typeof handlers.channelListener = (info) => {
      if (!canHandle()) return;
      this.realtimeRevision++;
      handlers.channelListener(info);
    };
    const onDelete: typeof handlers.messageDeleteListener = (...args) => {
      if (canHandle()) handlers.messageDeleteListener(...args);
    };
    const onConnection: ConnectStatusListener = (status) => {
      if (!canHandle()) return;
      if (status !== ConnectStatus.Connected && this.freshness === "ready") this.freshness = "stale";
      this.publish("connection");
      if (canHandle() && status === ConnectStatus.Connected) this.refreshInBackground(true);
    };
    const onSpace = () => {
      if (!isActive() || this.contextIsCurrent()) return;
      // The context authority has already changed the Space. Never write it here.
      this.resetContext();
      if (canHandle()) this.refreshInBackground(false);
    };
    const onAuth = () => {
      if (!isActive() || this.contextIsCurrent()) return;
      this.resetContext();
      if (canHandle()) this.refreshInBackground(false);
    };
    this.sdk.conversationManager.addConversationListener(onConversation);
    this.cleanups.push(() => this.sdk.conversationManager.removeConversationListener(onConversation));
    this.cleanups.push(addImChannelInfoListener(this.sdk, onChannel));
    WKApp.shared.addMessageDeleteListener(onDelete);
    const app = WKApp.shared;
    this.cleanups.push(() => app.removeMessageDeleteListener(onDelete));
    addImConnectStatusListener(this.sdk, onConnection);
    this.cleanups.push(() => removeImConnectStatusListener(this.sdk, onConnection));
    WKApp.mittBus.on("space-changed", onSpace);
    this.cleanups.push(() => WKApp.mittBus.off("space-changed", onSpace));
    WKApp.mittBus.on("wk:auth-state-changed", onAuth);
    this.cleanups.push(() => WKApp.mittBus.off("wk:auth-state-changed", onAuth));
    if (syncOnStart && canHandle() && isImConnected(this.sdk)) this.refreshInBackground(true);
  }

  private stop(): void {
    this.lifecycleRevision++;
    this.requestRevision++;
    this.pending = undefined;
    this.cancelReconcile?.();
    if (this.hasSnapshot) this.freshness = "stale";
    this.pendingSpaceConversations.clear();
    this.lastThreadStatusByChannel.clear();
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try { cleanup(); }
      catch (error) { console.error("[im-conversations] cleanup failed", error); }
    }
  }

  private refreshInBackground(reload: boolean): void {
    void this.refresh({ reload, reusePending: true }).catch((error: unknown) => {
      console.error("[im-conversations] background sync failed", error);
    });
  }

  refresh(options: { reload?: boolean; reusePending?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Conversation store disposed"));
    if (options.reusePending && this.pending?.isCurrent()) return this.pending.promise;
    this.cancelReconcile?.();
    const revision = ++this.requestRevision;
    const context = captureCurrentImConversationSyncContext();
    const isCurrent = () => !this.disposed && revision === this.requestRevision && context() && WKSDK.shared() === this.sdk;
    if (!options.reload) {
      this.loading = true;
      this.freshness = this.hasSnapshot ? "stale" : "loading";
      this.publish("data");
    }
    if (!isCurrent()) return Promise.resolve();
    const promise = this.runRefresh(options.reload === true, isCurrent);
    const pending = { isCurrent, promise };
    if (isCurrent()) this.pending = pending;
    void promise.finally(() => {
      if (this.pending === pending) this.pending = undefined;
    }).catch(() => undefined);
    return promise;
  }

  async ensureSnapshot(): Promise<void> {
    if (this.freshness === "ready" && this.snapshotIsCurrent()) return;
    const release = this.retain({ syncOnStart: false });
    try {
      let request = this.refresh({ reload: true, reusePending: true });
      while (true) {
        await request;
        const next = this.pending;
        // A Space switch or explicit refresh can replace the work this
        // temporary holder started. Do not stop the replacement in finally.
        if (!next?.isCurrent() || next.promise === request) return;
        request = next.promise;
      }
    } finally {
      release();
    }
  }

  private waitForReconcile(isCurrent: () => boolean): Promise<boolean> {
    if (!isCurrent()) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (retry: boolean) => {
        clearTimeout(timer);
        if (this.cancelReconcile === cancel) this.cancelReconcile = undefined;
        resolve(retry);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(isCurrent()), 1000);
      this.cancelReconcile = cancel;
    });
  }

  private async runRefresh(reload: boolean, isCurrent: () => boolean): Promise<void> {
    try {
      while (isCurrent()) {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!isCurrent()) return;
          const realtimeRevision = this.realtimeRevision;
          const spaceUnreadRevision = spaceUnreadStore.getAuthorityRevision();
          const canCommit = () => (
            isCurrent() &&
            realtimeRevision === this.realtimeRevision
          );
          const pins = WKApp.shared.currentSpaceId
            ? PinnedService.list().catch((error: unknown) => {
                console.warn("[im-conversations] failed to load pinned channels", error);
                return undefined;
              })
            : Promise.resolve(undefined);
          const result = await syncCurrentImConversations({ canCommit, deferCommit: true });
          if (!isCurrent()) return;
          if (!result?.isCurrent()) continue;
          const pinnedChannels = await pins;
          if (!isCurrent()) return;
          if (!result.isCurrent()) continue;
          const accepted = prepareCurrentImConversationSnapshot(
            result.conversations, pinnedChannels, { filterTextPreview: reload },
          );
          if (!result.commit(accepted)) continue;
          if (result.spaceMemberships !== undefined) {
            spaceUnreadStore.replaceMemberships(result.spaceMemberships);
          }
          // Sidebands are optional during rolling deployment. A missing or
          // raced badge snapshot never invalidates the committed conversation list.
          if (result.spaceUnreads !== undefined) {
            spaceUnreadStore.replaceTotals(result.spaceUnreads, spaceUnreadRevision);
          }
          this.conversations = accepted.map((conversation) => new ConversationWrap(conversation));
          this.loading = false;
          this.freshness = "ready";
          this.hasSnapshot = true;
          this.snapshotIsCurrent = captureCurrentImConversationSyncContext();
          this.sortConversations();
          this.publish("data");
          if (!isCurrent()) return;
          WKApp.menus.refresh();
          WKApp.mittBus.emit("conversation-list-refreshed");
          return;
        }
        if (!isCurrent()) return;
        // Never mix a stale SDK unread baseline into a newer server snapshot.
        // Keep this request (and ensureSnapshot's temporary holder) alive until
        // calibration completes or its lifecycle explicitly cancels the wait.
        this.loading = !this.hasSnapshot;
        this.freshness = this.hasSnapshot ? "stale" : "loading";
        this.publish("data");
        if (!(await this.waitForReconcile(isCurrent))) return;
      }
    } catch (error) {
      if (!isCurrent()) return;
      this.loading = false;
      this.freshness = this.hasSnapshot ? "stale" : "unavailable";
      this.publish("data");
      throw error;
    }
  }

  findConversation(channel: Channel): ConversationWrap | undefined {
    return this.conversations.find((item) => item.channel.isEqual(channel));
  }

  removeConversation(channel: Channel): void {
    const next = this.conversations.filter((item) => !item.channel.isEqual(channel));
    if (next.length === this.conversations.length) return;
    this.conversations = next;
    this.publish("data");
  }

  removeThreadsOfParent(parentGroupNo: string): void {
    const next = this.conversations.filter(({ channel }) => (
      channel.channelType !== ChannelTypeCommunityTopic
      || parseThreadChannelId(channel.channelID)?.groupNo !== parentGroupNo
    ));
    if (next.length === this.conversations.length) return;
    this.conversations = next;
    this.publish("data");
  }

  sortConversations(conversations?: ConversationWrap[]): ConversationWrap[] {
    const sorted = [...(conversations || this.conversations)].sort((a, b) => (
      b.timestamp + (b.extra?.top === 1 ? 1e12 : 0)
      - a.timestamp - (a.extra?.top === 1 ? 1e12 : 0)
    ));
    if (!conversations) this.conversations = sorted;
    return sorted;
  }
}
