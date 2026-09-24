import { Channel, Subscriber } from "wukongimjssdk";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";
import { getCurrentImChannelLocallyRemovedSubscriberUids } from "../../im-runtime/currentChannelRuntime";

export interface SubscriberListVMOptions {
  /** Absolute auto-page budget; omitted preserves the other consumers' unbounded walk. */
  maxAutoPages?: number;
}

export type SubscriberListStatus =
  | "idle"
  | "debouncing"
  | "loading"
  | "refreshing"
  | "ready"
  | "error"
  | "budget-exhausted";

/** A query owns its cursor and accumulated results, including across a retry. */
interface SubscriberQuery {
  version: number;
  keyword: string;
  limit: number;
  nextPage: number;
  refreshThrough: number;
  rows: Subscriber[];
  roster: Subscriber[];
}

export class SubscriberListVM extends ProviderListener {
  channel: Channel;
  subscribers: Subscriber[] = [];
  /** Last successfully committed page, never the page currently being requested. */
  currPage = 1;
  limit = 50;
  hasMore = true;
  keyword = "";
  status: SubscriberListStatus = "idle";
  filter?: (subscriber: Subscriber) => boolean;
  onSubscribersLoaded?: (subscribers: Subscriber[]) => void;
  private loadedRoster: Subscriber[] = [];
  private maxAutoPages?: number;
  private localSearch?: (
    keyword: string,
    roster?: Subscriber[]
  ) => Subscriber[];
  private _isMounted = false;
  private _delayTimer?: ReturnType<typeof setTimeout>;
  private _requestVersion = 0;
  private query?: SubscriberQuery;
  private pendingRefresh = false;
  private pendingLoadMore = false;

  constructor(
    channel: Channel,
    filter?: (subscriber: Subscriber) => boolean,
    localSearch?: (keyword: string, roster?: Subscriber[]) => Subscriber[],
    options?: SubscriberListVMOptions
  ) {
    super();
    this.channel = channel;
    this.filter = filter;
    this.localSearch = localSearch;
    this.maxAutoPages = options?.maxAutoPages;
  }

  // Compatibility for existing consumers. These are projections of one state,
  // not independent latches that can disagree after cancellation or refresh.
  get loading() {
    return ["debouncing", "loading", "refreshing"].includes(this.status);
  }
  get firstLoadSettled() {
    return !["idle", "debouncing", "loading"].includes(this.status);
  }
  get loadError() {
    return this.status === "error";
  }
  get autoPageBudgetExhausted() {
    return this.status === "budget-exhausted";
  }
  get autoPaging() {
    return this.loading && !!this.filter && (this.query?.nextPage ?? 1) > 1;
  }

  didMount(): void {
    this._isMounted = true;
    this.delyRequestSubscribers();
  }

  didUnMount(): void {
    this._isMounted = false;
    this._requestVersion++;
    this.clearDelay();
    this.query = undefined;
    this.pendingRefresh = false;
    this.pendingLoadMore = false;
    this.status = "idle";
  }

  private clearDelay() {
    if (this._delayTimer !== undefined) {
      clearTimeout(this._delayTimer);
      this._delayTimer = undefined;
    }
  }

  private isCurrent(query: SubscriberQuery) {
    return this._isMounted && query.version === this._requestVersion;
  }

  private localMatches(keyword: string) {
    if (!keyword.trim() || !this.localSearch) return [];
    try {
      return this.applySubscriberFilters(
        this.localSearch(keyword, this.loadedRoster)
      );
    } catch {
      return [];
    }
  }

  /** Invalidate immediately; only the network leg is debounced. */
  search(keyword: string, delayMs = 0) {
    this.clearDelay();
    this.pendingRefresh = false;
    this.pendingLoadMore = false;
    if (!this.keyword.trim()) {
      this.loadedRoster = this.mergeSubscribers(
        this.loadedRoster,
        this.subscribers
      );
    }
    this.keyword = keyword;
    this.currPage = 1;
    this.hasMore = false;
    const query = this.newQuery(1, 0, this.localMatches(keyword));
    this.subscribers = query.rows;
    this.status = delayMs > 0 ? "debouncing" : "loading";
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);
    if (!this.isCurrent(query)) return;
    if (delayMs > 0) {
      this._delayTimer = setTimeout(() => {
        this._delayTimer = undefined;
        if (this.isCurrent(query)) void this.runQuery(query);
      }, delayMs);
    } else {
      void this.runQuery(query);
    }
  }

  private newQuery(
    nextPage: number,
    refreshThrough: number,
    rows: Subscriber[]
  ) {
    const query: SubscriberQuery = {
      version: ++this._requestVersion,
      keyword: this.keyword,
      limit: this.limit,
      nextPage,
      refreshThrough,
      rows,
      roster: nextPage > 1 ? this.loadedRoster : [],
    };
    this.query = query;
    return query;
  }

  requestSubscribers = async () => {
    this.clearDelay();
    const query = this.newQuery(
      this.currPage,
      0,
      this.currPage > 1 ? this.subscribers : this.localMatches(this.keyword)
    );
    await this.runQuery(query);
  };

  /**
   * All fetch paths use one serial job. A superseded job may settle, but cannot
   * publish, clear the new job's loading state, or advance its cursor.
   * A failed job retains nextPage/rows so retry never skips a failed page.
   */
  private async runQuery(query: SubscriberQuery) {
    if (!this.isCurrent(query)) return;
    this.status = query.refreshThrough > 0 ? "refreshing" : "loading";
    this.notifyListener();
    try {
      while (this.isCurrent(query)) {
        const page = query.nextPage;
        const rows =
          (await WKApp.dataSource.channelDataSource.subscribers(this.channel, {
            page,
            limit: query.limit,
            keyword: query.keyword,
          })) ?? [];
        if (!this.isCurrent(query)) return;

        // Replace stale local copies before filtering: a fresh row that lost
        // permission must also evict its formerly removable local match.
        query.rows = this.applySubscriberFilters(
          this.mergeSubscribers(query.rows, rows)
        );
        if (!query.keyword.trim()) {
          query.roster = this.mergeSubscribers(query.roster, rows);
        }
        query.nextPage = page + 1;

        // Keep the old rendered prefix while refreshing it. It is replaced only
        // once all requested pages have arrived, not mistaken for a full roster.
        if (page < query.refreshThrough && rows.length >= query.limit) continue;
        this.currPage = page;
        this.hasMore = rows.length >= query.limit;
        this.subscribers = this.applySubscriberFilters(query.rows);
        if (!query.keyword.trim()) this.loadedRoster = query.roster;
        const needsMore =
          !!this.filter &&
          this.hasMore &&
          this.subscribers.length < query.limit;
        const budgetHit =
          this.maxAutoPages !== undefined && page >= this.maxAutoPages;
        this.status = needsMore
          ? budgetHit
            ? "budget-exhausted"
            : "loading"
          : "ready";
        this.notifyListener();
        this.onSubscribersLoaded?.(this.subscribers);
        if (!needsMore || budgetHit) return;
      }
    } catch {
      if (this.isCurrent(query)) this.status = "error";
    } finally {
      if (this.isCurrent(query)) {
        this.notifyListener();
        // Publish this generation before servicing one coalesced follow-up.
        // Errors retain their exact cursor and require an explicit retry.
        if (!this.loadError) {
          if (this.pendingLoadMore && this.hasMore) {
            this.pendingLoadMore = false;
            void this.loadMoreSubscribersIfNeed();
          } else if (this.pendingRefresh) {
            this.pendingRefresh = false;
            this.pendingLoadMore = false;
            void this.refreshCurrentSearch();
          } else {
            this.pendingLoadMore = false;
          }
        } else {
          this.pendingRefresh = false;
          this.pendingLoadMore = false;
        }
      }
    }
  }

  retry = async () => {
    if (this.status !== "error" || !this.query) return;
    await this.runQuery(this.query);
  };

  private applySubscriberFilters(subscribers: Subscriber[]) {
    const removed = new Set(
      getCurrentImChannelLocallyRemovedSubscriberUids(this.channel)
    );
    return subscribers.filter(
      (row) => !removed.has(row.uid) && (!this.filter || this.filter(row))
    );
  }

  private mergeSubscribers(current: Subscriber[], incoming: Subscriber[]) {
    // Incoming server rows replace local-index copies, so fresh permissions and
    // names win without losing stable ordering or duplicating a uid.
    const result = new Map(current.map((row) => [row.uid, row]));
    incoming.forEach((row) => result.set(row.uid, row));
    return [...result.values()];
  }

  delyRequestSubscribers = () => {
    this.clearDelay();
    this._delayTimer = setTimeout(() => {
      this._delayTimer = undefined;
      if (this._isMounted) void this.requestSubscribers();
    }, 250);
  };

  loadMoreSubscribersIfNeed = async () => {
    if (this.loading) {
      if (this.status === "refreshing") this.pendingLoadMore = true;
      return;
    }
    if (this.loadError) return this.retry();
    if (!this.hasMore) return;
    await this.runQuery(this.newQuery(this.currPage + 1, 0, this.subscribers));
  };

  removeSubscriber = (uid: string) => {
    this.subscribers = this.subscribers.filter((row) => row.uid !== uid);
    this.loadedRoster = this.loadedRoster.filter((row) => row.uid !== uid);
    if (this.query) {
      this.query.rows = this.query.rows.filter((row) => row.uid !== uid);
      this.query.roster = this.query.roster.filter((row) => row.uid !== uid);
    }
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);
  };

  refreshCurrentSearch = async () => {
    // A subscriber event during debounce must not cancel the user's queued
    // query; that query will fetch fresh server data when its timer fires.
    if (this.status === "debouncing") return;
    if (this.status === "refreshing") {
      this.pendingRefresh = true;
      return;
    }
    this.clearDelay();
    const through = Math.max(1, this.currPage);
    const query = this.newQuery(1, through, this.localMatches(this.keyword));
    await this.runQuery(query);
  };
}
