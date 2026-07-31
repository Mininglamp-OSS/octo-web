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
  filter?: (subscriber: Subscriber) => boolean;
  private localSearch?: (keyword: string) => Subscriber[];
  /** 每次 subscribers 数据加载完成后调用，用于触发预取等副作用 */
  onSubscribersLoaded?: (subscribers: Subscriber[]) => void;
  private _isMounted: boolean = false;
  private _delayTimer?: ReturnType<typeof setTimeout>;
  private _requestVersion: number = 0;
  constructor(
    channel: Channel,
    filter?: (subscriber: Subscriber) => boolean,
    localSearch?: (keyword: string) => Subscriber[]
  ) {
    super();
    this.channel = channel;
    this.filter = filter;
    this.localSearch = localSearch;
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
    const subscribers = await WKApp.dataSource.channelDataSource.subscribers(
      this.channel,
      {
        page: this.currPage,
        limit: this.limit,
        keyword: this.keyword,
      }
    );
    if (!this._isMounted || requestVersion !== this._requestVersion) return;
    this.hasMore = subscribers && subscribers.length >= this.limit;
    if (subscribers) {
      const visibleSubscribers = this.filterLocallyRemovedSubscribers(
        subscribers
      );
      const filtered = this.filter
        ? visibleSubscribers.filter(this.filter)
        : visibleSubscribers;
      if (this.currPage === 1) {
        this.subscribers = this.mergeSubscribers(initialSubscribers, filtered);
      } else {
        this.subscribers = this.mergeSubscribers(this.subscribers, filtered);
      }
    }
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);

    // When client-side filtering removes most results, the list may be
    // too short for the user to scroll and trigger the next page load.
    // Auto-fetch more pages until we have enough visible items or run out.
    if (this.filter && this.hasMore && this.subscribers.length < this.limit) {
      this.currPage++;
      await this.requestSubscribers(requestVersion);
    }
  };

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

  refreshCurrentSearch = () => {
    this.currPage = 1;
    this.subscribers = [];
    this.requestSubscribers();
  };
}
