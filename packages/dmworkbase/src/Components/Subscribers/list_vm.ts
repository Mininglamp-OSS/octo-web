import { Channel, Subscriber } from "wukongimjssdk";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";
import { getCurrentImChannelLocallyRemovedSubscriberUids } from "../../im-runtime/currentChannelRuntime";

export interface SubscriberListVMOptions {
  /**
   * 「本页被 filter 砍空就自动翻下一页」这条补偿逻辑的**页数预算**。
   *
   * 不传 = 不限（既有行为，浏览/转让群主/摘要页都依赖它，不能改）。
   * 传了 = 翻到该页仍未凑够一屏就停下并置 autoPageBudgetExhausted，
   * 由调用方渲染「前 N 人中未找到，请用搜索」之类的明确出路 —— 这比无限翻页
   * 扫完整个大群更可控，也比静默停住诚实。
   */
  maxAutoPages?: number;
}

export class SubscriberListVM extends ProviderListener {
  channel: Channel;
  subscribers: Subscriber[] = [];
  currPage: number = 1;
  loading: boolean = false;
  limit: number = 50;
  hasMore: boolean = true;
  keyword: string = "";
  filter?: (subscriber: Subscriber) => boolean;
  /**
   * 首次请求是否已经有结果（成功或失败都算）。
   *
   * 用来把「还没拉到」和「拉到了但确实是空的」分开：只看 subscribers.length===0
   * 的话，首帧就会对用户断言「这里什么都没有」，而那时请求都还没发出去。
   */
  firstLoadSettled: boolean = false;
  /** 最近一次请求是否失败。失败时调用方应给重试入口，而不是断言列表为空。 */
  loadError: boolean = false;
  /** 自动续翻是否用尽了 maxAutoPages 预算（仅在传了预算时可能为 true）。 */
  autoPageBudgetExhausted: boolean = false;
  /**
   * 是否正在自动续翻（横跨整个循环，而不是单次请求）。
   *
   * 调用方必须在渲染「空」之前检查它：firstLoadSettled 只说明「第一页回来了」，
   * 不说明「扫完了」。稀疏过滤时中间页的空结果是过程量，不是结论。
   */
  autoPaging: boolean = false;
  private maxAutoPages?: number;
  private localSearch?: (keyword: string, roster?: Subscriber[]) => Subscriber[];
  /** 每次 subscribers 数据加载完成后调用，用于触发预取等副作用 */
  onSubscribersLoaded?: (subscribers: Subscriber[]) => void;
  private _isMounted: boolean = false;
  private _delayTimer?: ReturnType<typeof setTimeout>;
  private _requestVersion: number = 0;
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
    // 先快照：本地索引是基于「当前已加载的名册」建的，而下一行就把它清空了。
    // 不快照的话，localSearch 每次拿到的都是空数组 —— 拼音加速器永远出不了结果。
    const rosterBeforeReset = this.subscribers;
    this.currPage = 1;
    this.subscribers = [];
    this.keyword = keyword;
    // 换了关键词就是一次全新的检索：预算重新开始算，旧的错误态也别留着。
    this.autoPageBudgetExhausted = false;
    this.loadError = false;
    this.autoPaging = false;
    if (this.localSearch && keyword.trim()) {
      const requestVersion = ++this._requestVersion;
      this.hasMore = false;
      let localResults: Subscriber[];
      try {
        localResults = this.localSearch(keyword, rosterBeforeReset);
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
    let subscribers: Subscriber[] | undefined;
    try {
      subscribers = await WKApp.dataSource.channelDataSource.subscribers(
        this.channel,
        {
          page: this.currPage,
          limit: this.limit,
          keyword: this.keyword,
        }
      );
    } catch (e) {
      if (!this._isMounted || requestVersion !== this._requestVersion) return;
      // 请求失败必须留痕：早先这里没有 catch，异常会静默逃逸，列表永远停在空，
      // 而调用方只能看到「0 条」，于是对用户断言「这里没有任何成员」——
      // 把一次网络失败说成了一个事实。
      this.loadError = true;
      this.firstLoadSettled = true;
      this.loading = false;
      this.autoPaging = false;
      this.notifyListener();
      return;
    }
    if (!this._isMounted || requestVersion !== this._requestVersion) return;
    this.loadError = false;
    this.firstLoadSettled = true;
    this.hasMore = !!subscribers && subscribers.length >= this.limit;
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
    //
    // 继续与否必须在 notifyListener() **之前**算出来。早先是先 notify 再决定，
    // 于是稀疏过滤的每一个中间页都把「空结果 + 已结束」的快照推给组件，
    // 组件只能渲染「你没有可移出的成员」—— bot 在第 450 名时连说 8 遍这句假话。
    // autoPaging 横跨整个循环，让调用方能区分「还在扫」和「真没有」。
    const needsMorePages =
      !!this.filter && this.hasMore && this.subscribers.length < this.limit;
    const budgetHit =
      this.maxAutoPages !== undefined && this.currPage >= this.maxAutoPages;
    const willAutoPage = needsMorePages && !budgetHit;

    if (needsMorePages && budgetHit) {
      // 预算用尽：稀疏过滤（例如普通成员在大群里只有 1 个自己的 bot）会一路翻到
      // 群尾，页数预算把它兜住，调用方据此引导用户改用服务端搜索。
      this.autoPageBudgetExhausted = true;
    }
    this.autoPaging = willAutoPage;

    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);

    if (willAutoPage) {
      this.currPage++;
      await this.requestSubscribers(requestVersion);
    }
  };

  private async requestLoadedSubscriberPages(requestVersion: number) {
    const pageCount = Math.max(1, this.currPage);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, index) =>
        WKApp.dataSource.channelDataSource.subscribers(this.channel, {
          page: index + 1,
          limit: this.limit,
          keyword: this.keyword,
        })
      )
    );
    if (!this._isMounted || requestVersion !== this._requestVersion) return;

    let nextSubscribers: Subscriber[] = [];
    if (this.localSearch && this.keyword.trim()) {
      try {
        nextSubscribers = this.applySubscriberFilters(
          this.localSearch(this.keyword, this.subscribers)
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
    this.notifyListener();
    this.onSubscribersLoaded?.(this.subscribers);
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

  refreshCurrentSearch = () => {
    this.requestLoadedSubscriberPages(++this._requestVersion);
  };
}
