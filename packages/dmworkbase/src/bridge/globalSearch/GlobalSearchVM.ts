import {
  Channel,
  ChannelInfo,
  ChannelInfoListener,
  ChannelTypePerson,
  MessageContentManager,
  SystemContent,
} from "wukongimjssdk";
import WKApp from "../../App";
import SearchService from "../../Service/SearchService";
import { MessageContentTypeConst } from "../../Service/Const";
import { ProviderListener } from "../../Service/Provider";
import { debounce } from "../../Utils/rateLimit";
import { t } from "../../i18n";
import { addCurrentImChannelInfoListener, getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import type { LegacyGlobalSearchResponse } from "../../Service/SearchService";
import {
  createEmptyGlobalSearchPinyinIndex,
  extendGlobalSearchPinyinIndex,
  globalSearchContactsToLegacy,
  globalSearchGroupsToLegacy,
  mergeGlobalSearchPinyinResults,
  searchGlobalSearchPinyinIndex,
  type GlobalSearchPinyinIndex,
} from "./globalSearchPinyin";

/** Legacy contacts/groups bridge retained while the aggregated tabs migrate. */
export default class GlobalSearchVM extends ProviderListener {
  // 选中的tab组件
  private _selectedTabKey = "contacts";

  public page = 1; // 当前页码
  public limit = 20; // 每页条数
  public keyword = ""; // 搜索关键字
  public searchResult: any;
  public isComposing: boolean = false; // 是否正在输入(防止中文输入法干扰)
  public loadMoreing = false; // 是否正在加载更多中
  public loadFinish = false; // 是否加载完成
  public contentTypes = new Array<number>(); // 内容类型
  private channelInfoListener!: ChannelInfoListener;
  private unsubscribeChannelInfoListener?: () => void;
  public channel?: Channel; // 查询指定频道的消息
  private requestId = 0; // 请求计数器，用于处理竞态条件
  private pinyinCandidateRequestId = 0;
  private pinyinIndex: GlobalSearchPinyinIndex =
    createEmptyGlobalSearchPinyinIndex();
  private mounted = false;
  public searchError: string | null = null; // 搜索失败错误信息
  private readonly contactsChangeListener = () => {
    void this.refreshPinyinIndex();
  };
  private readonly spaceChangedListener = () => {
    this.pinyinIndex = createEmptyGlobalSearchPinyinIndex();
    this.initLoad();
    void this.refreshPinyinIndex();
    this.requestSearch();
  };
  // tab数据列表
  public get tabList() {
    if (this.searchInChannel) {
      return [
        { tab: t("base.globalSearch.tab.chat"), itemKey: "all" },
        { tab: t("base.globalSearch.tab.files"), itemKey: "files" },
      ];
    }
    return [
      { tab: t("base.globalSearch.tab.contacts"), itemKey: "contacts" },
      { tab: t("base.globalSearch.tab.groups"), itemKey: "groups" },
      { tab: t("base.globalSearch.tab.chat"), itemKey: "messages" },
      { tab: t("base.globalSearch.tab.files"), itemKey: "files" },
    ];
  }

  public get selectedTabKey() {
    return this._selectedTabKey;
  }

  public set selectedTabKey(value: string) {
    this._selectedTabKey = value;
    this.notifyListener();
  }

  // 是否在频道内搜索
  public get searchInChannel(): boolean {
    return this.channel !== undefined;
  }
  // 搜索标题
  public get searchTitle() {
    if (this.searchInChannel) {
      const channelInfo = getCurrentImChannelInfo(
        this.channel!
      );
      if (channelInfo) {
        return t("base.globalSearch.chatHistoryWith", {
          values: { name: channelInfo.title },
        });
      }
      return "";
    }
    return undefined;
  }

  // tab选中事件
  // 优化：/search/global 一次返回 friends / groups / messages 全部结果，
  // 切 contacts / groups 不必重发搜索，仅切换 UI 即可，避免打开弹窗后每次
  // 点 tab 都触发一次服务端搜索。files tab 依赖 content_type 过滤，仍需重发。
  public onTabClick(key: string) {
    if (key === "files") {
      this.contentTypes = [MessageContentTypeConst.file];
      this.initLoad();
      this.requestSearch();
    } else if (this.selectedTabKey === "files") {
      // 从 files 切回 contacts/groups，content_type 需要清空并重发一次
      this.contentTypes = [];
      this.initLoad();
      this.requestSearch();
    }
    this.selectedTabKey = key;
  }

  didMount(): void {
    this.mounted = true;
    WKApp.dataSource.addContactsChangeListener(this.contactsChangeListener);
    WKApp.mittBus.on("space-changed", this.spaceChangedListener);
    void this.refreshPinyinIndex();
    this.requestSearch();

    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      if (channelInfo.channel.channelType !== ChannelTypePerson) {
        return;
      }
      if (
        this.searchResult?.messages &&
        this.searchResult.messages.length > 0
      ) {
        this.searchResult.messages.forEach((item: any) => {
          if (item.from_uid === channelInfo.channel.channelID) {
            this.notifyListener();
            return;
          }
        });
      }
    };

    this.unsubscribeChannelInfoListener = addCurrentImChannelInfoListener(
      this.channelInfoListener
    );
  }

  didUnMount(): void {
    this.mounted = false;
    this.pinyinCandidateRequestId++;
    this.handleInputChange.cancel();
    this.handleComposingInputChange.cancel();
    WKApp.dataSource.removeContactsChangeListener(this.contactsChangeListener);
    WKApp.mittBus.off("space-changed", this.spaceChangedListener);
    this.unsubscribeChannelInfoListener?.();
    this.unsubscribeChannelInfoListener = undefined;
  }

  // 输入框输入事件 (debounced to reduce API calls)
  public handleInputChange = debounce((value: string) => {
    if (!this.isComposing) {
      this.keyword = value;
      this.initLoad();
      this.requestSearch();
    }
  }, 300);

  // 中文输入法组合期间保留原有“不请求服务端”约束，但像通讯录搜索一样，
  // 使用输入框里的原始字母即时匹配本地拼音索引。组合结束后该回调会自动
  // 失效，最终选中的中文仍由 handleInputChange 走原服务端搜索链路。
  public handleComposingInputChange = debounce((value: string) => {
    if (!this.isComposing) return;
    this.keyword = value;
    this.initLoad();
  }, 300);

  public initLoad() {
    this.page = 1;
    this.loadFinish = false;
    this.loadMoreing = false;
    this.searchResult = null;
    this.applyPinyinMatches();
    this.notifyListener();
  }

  private async refreshPinyinIndex() {
    if (this.searchInChannel) return;
    const requestId = ++this.pinyinCandidateRequestId;
    const spaceId = WKApp.shared.currentSpaceId;
    const contacts = globalSearchContactsToLegacy(
      WKApp.dataSource.contactsList || []
    );
    let groups: ChannelInfo[] = [];
    try {
      groups = await WKApp.dataSource.channelDataSource.groupSaveList();
    } catch {
      // The existing server search remains authoritative when local candidates
      // cannot be loaded.
    }
    if (
      !this.mounted ||
      requestId !== this.pinyinCandidateRequestId ||
      spaceId !== WKApp.shared.currentSpaceId
    ) {
      return;
    }
    this.pinyinIndex = extendGlobalSearchPinyinIndex(this.pinyinIndex, {
      friends: contacts,
      groups: globalSearchGroupsToLegacy(groups),
    });
    this.applyPinyinMatches();
    this.notifyListener();
  }

  private applyPinyinMatches() {
    if (this.searchInChannel || !this.keyword.trim()) return;
    const localResult = searchGlobalSearchPinyinIndex(
      this.keyword,
      this.pinyinIndex
    );
    const current: LegacyGlobalSearchResponse = this.searchResult || {
      friends: [],
      groups: [],
      messages: [],
    };
    this.searchResult = mergeGlobalSearchPinyinResults(current, localResult);
  }

  // 请求搜索
  public requestSearch() {
    // 递增请求计数器，用于识别当前请求
    this.requestId++;
    const currentRequestId = this.requestId;

    this.searchError = null;

    const spaceId = WKApp.shared.currentSpaceId;
    SearchService.searchLegacyGlobal({
      keyword: this.keyword || "",
      page: this.page,
      limit: this.limit,
      contentTypes: this.contentTypes,
      channelId: this.channel?.channelID,
      channelType: this.channel?.channelType,
      onlyMessage: !!this.channel,
      spaceId,
    })
      .then((res) => {
        // 忽略过期请求的响应，只处理最新请求的结果
        if (currentRequestId !== this.requestId) {
          return;
        }

        if (res.messages.length < this.limit) {
          this.loadFinish = true;
        }
        if (this.loadMoreing) {
          if (this.searchResult) {
            this.searchResult.messages = this.searchResult.messages?.concat(
              res.messages
            );
          } else {
            this.searchResult = res;
          }
        } else {
          this.searchResult = res;
        }

        if (!this.searchInChannel) {
          this.pinyinIndex = extendGlobalSearchPinyinIndex(
            this.pinyinIndex,
            res
          );
        }
        this.applyPinyinMatches();

        // 替换备注如果有备注的话
        this.searchResult.friends?.forEach((v: any) => {
          if (v.channel_remark && v.channel_remark !== "") {
            v.channel_name = v.channel_remark;
          }
        });
        this.searchResult.groups?.forEach((v: any) => {
          if (v.channel_remark && v.channel_remark !== "") {
            v.channel_name = v.channel_remark;
          }
        });
        this.searchResult.messages?.forEach((v: any) => {
          if (v.channel.channel_remark && v.channel.channel_remark !== "") {
            v.channel.channel_name = v.channel.channel_remark;
          }

          // 解析消息内容
          if (v.payload) {
            const contentType = v.payload.type;

            const messageContent =
              MessageContentManager.shared().getMessageContent(contentType);
            if (messageContent) {
              messageContent.decode(this.jsonToUint8Array(v.payload));

              if (messageContent instanceof SystemContent) {
                messageContent.content["content"] = t(
                  "base.globalSearch.systemMessage"
                );
              }

              v.content = messageContent;
            }
          }
        });
      })
      .catch((err) => {
        console.error("[GlobalSearch] search failed:", err);
        if (currentRequestId === this.requestId) {
          this.searchError = t("base.globalSearch.searchFailedRetry");
          this.notifyListener();
        }
      })
      .finally(() => {
        // 只有最新请求完成时才更新 loadMoreing 状态
        if (currentRequestId === this.requestId) {
          this.loadMoreing = false;
          this.notifyListener();
        }
      });
  }

  jsonToUint8Array(json: any): Uint8Array {
    // 将 JSON 对象转换为字符串
    const jsonString = JSON.stringify(json);

    return this.stringToUint8Array(jsonString);
  }

  stringToUint8Array(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }

  // 加载更多消息
  loadMore() {
    if (this.loadMoreing) {
      return;
    }
    this.loadMoreing = true;
    this.page++;
    this.requestSearch();
  }
}
