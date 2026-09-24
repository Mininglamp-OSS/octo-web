import { Channel, Subscriber } from "wukongimjssdk";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";
import { getCurrentImChannelLocallyRemovedSubscriberUids } from "../../im-runtime/currentChannelRuntime";

export class SubscriberListVM extends ProviderListener {
  channel: Channel;
  subscribers: Subscriber[] = [];
  currPage: number = 1;
  loading: boolean = false;
  limit: number = 50;
  hasMore: boolean = true;
  keyword: string = "";
  firstLoadSettled: boolean = false;
  loadError: boolean = false;
  autoPaging: boolean = false;
  autoPageLimitReached: boolean = false;
  filter?: (subscriber: Subscriber) => boolean;
  private localSearch?: (keyword: string) => Subscriber[];
  private maxAutoPages?: number;
  /** 每次 subscribers 数据加载完成后调用，用于触发预取等副作用 */
  onSubscribersLoaded?: (subscribers: Subscriber[]) => void;
  private _isMounted: boolean = false;
  private _delayTimer?: ReturnType<typeof setTimeout>;
  private _requestVersion: number = 0;
  constructor(
    channel: Channel,
    filter?: (subscriber: Subscriber) => boolean,
    localSearch?: (keyword: string) => Subscriber[],
    maxAutoPages?: number
  ) {
    super();
    this.channel = channel;
    this.filter = filter;
    this.localSearch = localSearch;
    this.maxAutoPages = maxAutoPages;
  }

  didMount(): void {
    this._isMounted = true;
    this.delyRequestSubscribers();
  }

  didUnMount(): void {
    this._isMounted = false;
    this._requestVersion++;
    if (this._delayTimer) {
      clearTimeout(this._delayTimer);
      this._delayTimer = undefined;
    }
  }

  search(keyword: string) {
    this.currPage = 1;
    this.subscribers = [];
    this.keyword = keyword;
    if (this.maxAutoPages !== undefined) {
      this.firstLoadSettled = false;
      this.loadError = false;
      this.autoPaging = false;
      this.autoPageLimitReached = false;
    }
    if (this.localSearch && keyword.trim()) {
      const requestVersion = ++this._requestVersion;
      this.hasMore = false;
      let localResults: Subscriber[];
      try {
        localResults = this.localSearch(keyword);
      } catch {
        this.requestSubscribers(requestVersion);
        return;
      }
      localResults = this.filterLocallyRemovedSubscribers(localResults);
      this.subscribers = this.filter
        ? localResults.filter(this.filter)
        : localResults;
      this.notifyListener();
      this.onSubscribersLoaded?.(this.subscribers);
      // Keep the original server-backed keyword search authoritative. The
      // local index adds immediate pinyin matches, but may represent only a
      // partial SDK cache (for example, the first 100 super-group members).
      this.requestSubscribers(requestVersion, this.subscribers);
      return;
    }
    this.requestSubscribers();
  }

  requestSubscribers = async (
    requestVersion = ++this._requestVersion,
    initialSubscribers: Subscriber[] = []
  ) => {
    let subscribers: Subscriber[];
    try {
      subscribers = await WKApp.dataSource.channelDataSource.subscribers(
        this.channel,
        {
          page: this.currPage,
          limit: this.limit,
          keyword: this.keyword,
        }
      );
    } catch (error) {
      if (!this._isMounted || requestVersion !== this._requestVersion) return;
      if (this.maxAutoPages === undefined) throw error;
      this.firstLoadSettled = true;
      this.loadError = true;
      this.autoPaging = false;
      this.autoPageLimitReached = false;
      this.notifyListener();
      return;
    }
    if (!this._isMounted || requestVersion !== this._requestVersion) return;
    this.firstLoadSettled = true;
    this.loadError = false;
    this.hasMore = subscribers && subscribers.length >= this.limit;
    if (subscribers) {
      const filtered = this.applySubscriberFilters(subscribers);
      if (this.currPage === 1) {
        this.subscribers = this.mergeSubscribers(initialSubscribers, filtered);
      } else {
        this.subscribers = this.mergeSubscribers(this.subscribers, filtered);
      }
    }
    // When client-side filtering removes most results, the list may be
    // too short for the user to scroll and trigger the next page load.
    // Auto-fetch more pages until we have enough visible items or run out.
    const needsMore =
      !!this.filter && this.hasMore && this.subscribers.length < this.limit;
    const withinBudget =
      this.maxAutoPages === undefined || this.currPage < this.maxAutoPages;
    this.autoPaging = needsMore && withinBudget;
    this.autoPageLimitReached = needsMore && !withinBudget;
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);

    if (this.autoPaging) {
      this.currPage++;
      await this.requestSubscribers(requestVersion);
    }
  };

  retry = () => {
    this.firstLoadSettled = false;
    this.loadError = false;
    this.autoPaging = false;
    this.autoPageLimitReached = false;
    this.notifyListener();
    return this.requestSubscribers();
  };

  private async requestLoadedSubscriberPages(requestVersion: number) {
    const pageCount = Math.max(1, this.currPage);
    let pages: Subscriber[][];
    try {
      pages = await Promise.all(
        Array.from({ length: pageCount }, (_, index) =>
          WKApp.dataSource.channelDataSource.subscribers(this.channel, {
            page: index + 1,
            limit: this.limit,
            keyword: this.keyword,
          })
        )
      );
    } catch (error) {
      if (!this._isMounted || requestVersion !== this._requestVersion) return;
      if (this.maxAutoPages === undefined) throw error;
      this.firstLoadSettled = true;
      this.loadError = true;
      this.autoPaging = false;
      this.autoPageLimitReached = false;
      this.notifyListener();
      return;
    }
    if (!this._isMounted || requestVersion !== this._requestVersion) return;

    this.firstLoadSettled = true;
    this.loadError = false;
    let nextSubscribers: Subscriber[] = [];
    if (this.localSearch && this.keyword.trim()) {
      try {
        nextSubscribers = this.applySubscriberFilters(
          this.localSearch(this.keyword)
        );
      } catch {
        nextSubscribers = [];
      }
    }

    for (const pageSubscribers of pages) {
      nextSubscribers = this.mergeSubscribers(
        nextSubscribers,
        this.applySubscriberFilters(pageSubscribers || [])
      );
    }

    const lastPage = pages[pages.length - 1] || [];
    this.hasMore = lastPage.length >= this.limit;
    this.subscribers = nextSubscribers;
    const needsMore =
      !!this.filter && this.hasMore && this.subscribers.length < this.limit;
    const withinBudget =
      this.maxAutoPages === undefined || this.currPage < this.maxAutoPages;
    this.autoPaging = needsMore && withinBudget;
    this.autoPageLimitReached = needsMore && !withinBudget;
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);

    if (this.autoPaging) {
      this.currPage++;
      await this.requestSubscribers(requestVersion);
    }
  }

  private filterLocallyRemovedSubscribers(subscribers: Subscriber[]) {
    const removedUids = new Set(
      getCurrentImChannelLocallyRemovedSubscriberUids(this.channel)
    );
    if (removedUids.size === 0) return subscribers;
    const filtered = subscribers.filter(
      (subscriber) => !removedUids.has(subscriber?.uid || "")
    );
    return filtered.length === subscribers.length ? subscribers : filtered;
  }

  private applySubscriberFilters(subscribers: Subscriber[]) {
    const visibleSubscribers =
      this.filterLocallyRemovedSubscribers(subscribers);
    return this.filter
      ? visibleSubscribers.filter(this.filter)
      : visibleSubscribers;
  }

  private mergeSubscribers(
    current: Subscriber[],
    incoming: Subscriber[]
  ): Subscriber[] {
    const seen = new Set(current.map((subscriber) => subscriber.uid));
    return current.concat(
      incoming.filter((subscriber) => {
        if (seen.has(subscriber.uid)) return false;
        seen.add(subscriber.uid);
        return true;
      })
    );
  }

  delyRequestSubscribers = () => {
    // 延迟执行,这样动画切换的时候就不会显的卡顿
    this._delayTimer = setTimeout(async () => {
      this._delayTimer = undefined;
      if (this._isMounted) {
        this.requestSubscribers();
      }
    }, 250);
  };

  loadMoreSubscribersIfNeed = async () => {
    if (this.loading || !this.hasMore) {
      return;
    }
    this.loading = true;
    this.currPage++;
    await this.requestSubscribers();
    if (this._isMounted) {
      this.loading = false;
    }
  };

  removeSubscriber = (uid: string) => {
    this.subscribers = this.subscribers.filter(
      (subscriber) => subscriber.uid !== uid
    );
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);
  };

  refreshCurrentSearch = () =>
    this.requestLoadedSubscriberPages(++this._requestVersion);
}
