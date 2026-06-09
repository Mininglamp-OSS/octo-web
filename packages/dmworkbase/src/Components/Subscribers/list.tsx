import { Component, ReactNode } from "react";
import Provider from "../../Service/Provider";
import { SubscriberListVM } from "./list_vm";
import React from "react";
import { IconSearchStroked } from "@douyinfe/semi-icons";
import "./list.css";
import WKApp from "../../App";
import WKSDK, { Channel, ChannelInfo, ChannelInfoListener, ChannelTypePerson, Subscriber } from "wukongimjssdk";
import WKAvatar, { isBot } from "../WKAvatar";
import AiBadge from "../AiBadge";
import BotDetailModal from "../BotDetailModal";
import { Checkbox } from "@douyinfe/semi-ui/lib/es/checkbox";
import { Tag } from "@douyinfe/semi-ui";
import { GroupRole } from "../../Service/Const";
import { debounce, throttle } from "../../Utils/rateLimit";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { isRealnameVerified } from "../../Utils/displayName";
import { OnlineStatusBadge } from "../ConversationList";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import { I18nContext } from "../../i18n";

export interface SubscriberListProps {
  channel: Channel;
  canSelect?: boolean; // 是否支持多选
  singleSelect?: boolean; // 选择模式下是否只允许单选
  disableSelectList?: string[]; // 禁选列表
  onSelect?: (items: Subscriber[]) => void;

  filter?: (subscriber: Subscriber) => boolean; // 过滤函数
}

export interface SubscriberListState {
  selectedList: Subscriber[];
  botDetailUid: string;
  botDetailVisible: boolean;
}

export class SubscriberList extends Component<
  SubscriberListProps,
  SubscriberListState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private channelInfoListener!: ChannelInfoListener;
  // 当前已预取过 channelInfo 的 uid 集合，避免重复发请求
  private prefetchedUids = new Set<string>();

  constructor(props: SubscriberListProps) {
    super(props);
    this.state = {
      selectedList: [],
      botDetailUid: "",
      botDetailVisible: false,
    };
  }

  componentDidMount() {
    // 只响应当前成员列表内的 channel 变更，避免全局高频重渲
    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      if (!channelInfo?.channel) return;
      const uid = channelInfo.channel.channelID;
      if (uid && this.prefetchedUids.has(uid)) {
        this.setState({});
      }
    };
    WKSDK.shared().channelManager.addListener(this.channelInfoListener);
  }

  componentWillUnmount() {
    WKSDK.shared().channelManager.removeListener(this.channelInfoListener);
    this.prefetchedUids.clear();
  }

  needShowOnlineStatus(uid: string): boolean {
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(uid, ChannelTypePerson)
    );
    if (!channelInfo) return false;
    if (channelInfo.online) return true;
    const btwTime = new Date().getTime() / 1000 - channelInfo.lastOffline;
    return btwTime > 0 && btwTime < 60 * 60;
  }

  getOnlineTip(uid: string): string | undefined {
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(uid, ChannelTypePerson)
    );
    if (!channelInfo || channelInfo.online) return undefined;
    const btwTime = new Date().getTime() / 1000 - channelInfo.lastOffline;
    if (btwTime < 60) return this.context.t("base.subscribers.justNow");
    return this.context.t("base.subscribers.minutesAgoShort", {
      values: { count: (btwTime / 60).toFixed(0) },
    });
  }

  // Store debounced search functions per VM instance
  private debouncedSearchMap = new WeakMap<SubscriberListVM, (v: string) => void>();

  getDebouncedSearch = (vm: SubscriberListVM) => {
    if (!this.debouncedSearchMap.has(vm)) {
      this.debouncedSearchMap.set(vm, debounce((v: string) => {
        vm.search(v);
      }, 300));
    }
    return this.debouncedSearchMap.get(vm)!;
  };

  onSearch = (v: string, vm: SubscriberListVM) => {
    this.getDebouncedSearch(vm)(v);
  };

  // Store throttled scroll handlers per VM instance
  private throttledScrollMap = new WeakMap<SubscriberListVM, (e: React.UIEvent<HTMLDivElement>) => void>();

  getThrottledScroll = (vm: SubscriberListVM) => {
    if (!this.throttledScrollMap.has(vm)) {
      this.throttledScrollMap.set(vm, throttle((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        const offset = 200;
        if (
          target.scrollTop + target.clientHeight + offset >=
          target.scrollHeight
        ) {
          vm.loadMoreSubscribersIfNeed();
        }
      }, 100));
    }
    return this.throttledScrollMap.get(vm)!;
  };

  handleScroll = (e: React.UIEvent<HTMLDivElement>, vm: SubscriberListVM) => {
    this.getThrottledScroll(vm)(e);
  };

  // 获取显示名称
  getShowName = (subscriber: Subscriber) => {
    // 优先显示个人备注
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(subscriber.uid, ChannelTypePerson)
    );
    if (
      channelInfo &&
      channelInfo.orgData.remark &&
      channelInfo.orgData.remark.trim() !== ""
    ) {
      return channelInfo.orgData.remark;
    }

    // 其次显示群内备注
    if (subscriber.remark && subscriber.remark.trim() !== "") {
      return subscriber.remark;
    }

    // 最后显示昵称
    return subscriber.name;
  };

  onItemClick = (subscriber: Subscriber) => {
    const { canSelect } = this.props;
    if (!canSelect) {
      // #105: Bot 成员点击弹 BotDetailModal 而非 UserInfo
      if (isBot(subscriber.uid)) {
        this.setState({ botDetailUid: subscriber.uid, botDetailVisible: true });
        return;
      }
      WKApp.shared.baseContext.showUserInfo(subscriber.uid, this.props.channel);
      return;
    }
    this.checkItem(subscriber);
  };

  isDisableItem(id: string) {
    const { disableSelectList } = this.props;
    if (disableSelectList && disableSelectList.length > 0) {
      for (const disableSelect of disableSelectList) {
        if (disableSelect === id) {
          return true;
        }
      }
    }
    return false;
  }

  isCheckItem(item: Subscriber) {
    const { selectedList } = this.state;
    for (const selected of selectedList) {
      if (selected.uid === item.uid) {
        return true;
      }
    }
    return false;
  }

  checkItem(item: Subscriber) {
    const { selectedList } = this.state;
    const { onSelect, singleSelect } = this.props;
    const found = selectedList.findIndex((selected) => selected.uid === item.uid);
    let newSelectedList;
    if (found >= 0) {
      newSelectedList = [...selectedList.slice(0, found), ...selectedList.slice(found + 1)];
    } else if (singleSelect) {
      newSelectedList = [item];
    } else {
      newSelectedList = [item, ...selectedList];
    }

    this.setState({
      selectedList: newSelectedList,
    });
    if (onSelect) {
      onSelect(newSelectedList);
    }
  }

  // 批量预取成员 channelInfo（含在线状态），去重避免重复请求
  prefetchSubscribersChannelInfo = (subscribers: Subscriber[]) => {
    for (const item of subscribers) {
      if (this.prefetchedUids.has(item.uid)) continue;
      this.prefetchedUids.add(item.uid);
      const ch = new Channel(item.uid, ChannelTypePerson);
      if (!WKSDK.shared().channelManager.getChannelInfo(ch)) {
        WKSDK.shared().channelManager.fetchChannelInfo(ch);
      }
    }
  };

  getRoleName = (item: Subscriber) => {
    if (item.role === GroupRole.owner) {
      return this.context.t("base.subscribers.role.owner");
    } else if (item.role === GroupRole.manager) {
      return this.context.t("base.subscribers.role.manager");
    } else {
      return "";
    }
  };

  render() {
    const { canSelect } = this.props;
    return (
      <>
      <Provider
        create={() => {
          const vm = new SubscriberListVM(this.props.channel, this.props.filter);
          // 在数据加载完成的回调中触发预取，避免在 render 内产生副作用
          vm.onSubscribersLoaded = (subscribers) => {
            this.prefetchSubscribersChannelInfo(subscribers);
          };
          return vm;
        }}
        render={(vm: SubscriberListVM) => {
          return (
            <div
              className="wk-subscrierlist"
              onScroll={(e) => {
                this.handleScroll(e, vm);
              }}
            >
              <div className="wk-indextable-search-box">
                <div className="wk-indextable-search-icon">
                  <IconSearchStroked
                    style={{ color: "#bbbfc4", fontSize: "20px" }}
                  />
                </div>
                <div className="wk-indextable-search-input">
                  <input
                    onChange={(v) => {
                      this.onSearch(v.target.value, vm);
                    }}
                    placeholder={this.context.t("base.subscribers.searchPlaceholder")}
                    ref={(rf) => {}}
                    type="text"
                    style={{ fontSize: "17px" }}
                  />
                </div>
              </div>
              <div className="wk-subscrierlist-list">
                {vm.subscribers.map((item) => {
                  const itemIsBot = isBot(item.uid);
                  const isBotAdmin = item.orgData?.bot_admin === 1;
                  // 外部 Tag 与来源按当前查看 Space 相对渲染。
                  // 优先新字段 home_space_id / home_space_name，缺失时回落旧字段。
                  const { isExternal: isExternalToViewer, sourceSpaceName: viewerSourceSpaceName } =
                    resolveExternalForViewer({
                      homeSpaceId: item.orgData?.home_space_id,
                      homeSpaceName: item.orgData?.home_space_name,
                      isExternalLegacy: item.orgData?.is_external,
                      sourceSpaceNameLegacy: item.orgData?.source_space_name,
                    });
                  const showOnline = this.needShowOnlineStatus(item.uid);
                  const onlineTip = this.getOnlineTip(item.uid);

                  return (
                    <div
                      className="wk-subscrierlist-list-item"
                      key={item.uid}
                      onClick={() => {
                        this.onItemClick(item);
                      }}
                    >
                      {canSelect ? (
                        <div className="wk-indextable-checkbox">
                          <Checkbox
                            checked={
                              this.isDisableItem(item.uid) ||
                              this.isCheckItem(item)
                            }
                            disabled={this.isDisableItem(item.uid)}
                          ></Checkbox>
                        </div>
                      ) : undefined}
                      <div className="wk-subscrierlist-item-avatar">
                        <WKAvatar src={item.avatar}></WKAvatar>
                        {showOnline && (
                          <div className="wk-subscrierlist-item-online-badge">
                            <OnlineStatusBadge tip={onlineTip} />
                          </div>
                        )}
                      </div>
                      <div className="wk-subscrierlist-item-content">
                        <div className="wk-subscrierlist-item-name">
                          {this.getShowName(item)}
                          {/* Epic dmwork-web#1169 Phase A: 实名徽章
                              （icon variant）紧贴姓名右侧，已实名才渲染。
                              Bot 走同样规则（isRealnameVerified
                              对非实名 bot 返回 false，不会出现 Bot + 实名 同时显示）。*/}
                          {isRealnameVerified(item.orgData) && (
                            <RealnameVerifiedBadge variant="icon" />
                          )}
                          {/* 「@SpaceName」后缀（企微风格），按当前查看 Space 相对渲染。
                              观察者 home_space 与成员 home_space 不同时显示；自己看自己不显示。
                              Bot 成员走同一规则（resolveExternalForViewer 对 bot 与人类对称）。*/}
                          {isExternalToViewer && viewerSourceSpaceName && (
                            <span
                              className="wk-subscrierlist-item-space"
                              title={`@${viewerSourceSpaceName}`}
                            >
                              @{viewerSourceSpaceName}
                            </span>
                          )}
                          {itemIsBot && <AiBadge />}
                          {itemIsBot && isBotAdmin && (
                            <Tag size="small" color="green" style={{ marginLeft: 4 }}>
                              {this.context.t("base.subscribers.botAdmin")}
                            </Tag>
                          )}
                        </div>
                        <div className="wk-subscrierlist-item-desc">
                          {this.getRoleName(item)}
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            </div>
          );
        }}
      ></Provider>
      <BotDetailModal
        uid={this.state.botDetailUid}
        visible={this.state.botDetailVisible}
        onClose={() => this.setState({ botDetailVisible: false })}
        onChat={(channel) => {
          WKApp.endpoints.showConversation(channel);
          this.setState({ botDetailVisible: false });
        }}
      />
      </>
    );
  }
}
