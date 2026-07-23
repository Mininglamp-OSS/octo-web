import { Channel, Subscriber } from "wukongimjssdk";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";

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
      this._requestVersion++;
      this.hasMore = false;
      const localResults = this.localSearch(keyword);
      this.subscribers = this.filter
        ? localResults.filter(this.filter)
        : localResults;
      this.notifyListener();
      this.onSubscribersLoaded?.(this.subscribers);
      return;
    }
    this.requestSubscribers();
  }

  requestSubscribers = async (requestVersion = ++this._requestVersion) => {
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
      const filtered = this.filter
        ? subscribers.filter(this.filter)
        : subscribers;
      if (this.currPage === 1) {
        this.subscribers = filtered;
      } else {
        this.subscribers = this.subscribers.concat(filtered);
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
}
