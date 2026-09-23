import React, { Component } from "react";
import { IconSearchStroked } from "@douyinfe/semi-icons";
import { Tag } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";

import Provider from "../../Service/Provider";
import { GroupRole } from "../../Service/Const";
import { I18nContext } from "../../i18n";
import { debounce, throttle } from "../../Utils/rateLimit";
import { isRealnameVerified } from "../../Utils/displayName";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import {
  MemberRemovalGroup,
  MemberRemovalGroupId,
  buildMemberRemovalGroups,
  deriveDefaultExpandedGroups,
  isGroupExpanded,
  MAX_OTHERS_GROUP_SIZE,
} from "../../features/channelSetting/memberRemovalGrouping";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import AiBadge from "../AiBadge";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import WKAvatar, { isBot } from "../WKAvatar";
import { SubscriberListVM } from "./list_vm";
import "./list.css";
import "./memberRemovalList.css";

/**
 * 「移出成员」独立页（PRD §3.2–§3.4）。
 *
 * ## 为什么新开一个组件而不是给 SubscriberList 加 mode
 *
 * SubscriberList 已经 540 行，同时服务三种场景：选人（转让群主）、浏览（查看全部）、
 * 移除。再往里塞分类 + 折叠 + 滚动定位，三条路径会互相污染 —— 尤其是它的
 * canSelect / filter / removeAction 已经有隐式互斥关系。
 *
 * 本组件只做一件事：**展示当前查看者可移除的成员，按归属分两类，支持多选**。
 *
 * ## 交互模型：多选 + 批量提交（不是逐行减号）
 *
 * 每行一个圆形勾选框，选中项跨分组共存，最后由路由 header 右上角的「确认」
 * 一次性提交。这比逐行「点一个弹一次确认框」更贴合后端：memberRemove 的入参
 * 本来就是 `Members []string`，而且自助分支做的是**整批校验**（任一目标不在
 * 白名单内即整批拒绝，不做部分执行）。逐行调用等于把一个天然批量的接口拆散用。
 *
 * ## 「确认」按钮为什么不在本组件里
 *
 * 它属于路由表头（RouteContextConfig.showFinishButton），由 push 本页的
 * channelSettingMemberSection 持有。所以本组件只负责**上报选择**
 * （onSelectionChange），提交、二次确认、Toast、pop 都在父级 —— 与
 * 「转让群主」完全同一套模式，不另造一套。
 *
 * ## 与「+」完全解耦
 *
 * 本页 title 是纯文案，不挂 WKApp.endpoints.organizationalTool。之前移除页复用了
 * 带「添加成员」按钮的 title，导致「-」页面右上角永远有个「+」，两个相反的操作
 * 挤在同一个 Route 里。入口、标题、列表内容现在各自独立。
 */

export interface MemberRemovalListProps {
  channel: Channel;
  /** 行级权限判据所需的查看者身份。由 channelSettingMemberSection 传入。 */
  viewerUid?: string;
  viewerRole?: number;
  /**
   * 选中项变化时上报（含完整 Subscriber，父级做二次确认文案要用名字）。
   * 父级据此 enable/disable 路由表头的「确认」按钮。
   */
  onSelectionChange?: (selected: Subscriber[]) => void;
  /** 可选的本地搜索实现（拼音等），与 SubscriberList 同契约。 */
  localSearch?: (keyword: string) => Subscriber[];
}

interface MemberRemovalListState {
  /**
   * 已勾选的成员，按 uid 索引到**完整 Subscriber**。
   *
   * 用 Map 而不是 Set<uid>：早期版本存 uid 集合，上报时再从「最近一次渲染出的
   * 可见集合」反查对象。但可见集合会被搜索/分页整体替换，于是「先勾 Alice，
   * 再搜 bob 并勾 Bob」会把 Alice 静默丢掉（行仍显示勾选，提交里却没它）。
   * 勾选时 Subscriber 对象已在手上，直接存下来就不再依赖瞬时的渲染集合。
   */
  selected: Map<string, Subscriber>;
  /**
   * 用户**手动**折叠/展开过的分组。
   *
   * 用 Partial 而不是完整 Record，是为了区分「用户显式收起了」和「用户还没表态」：
   * 后者要落回 §3.3 的默认推导。早先用完整 Record + 一个
   * expandedInitialized 标志位，靠 componentDidMount 后的 setState 回填默认值，
   * 但那使得**首帧渲染依赖 setState 已生效** —— 在组件挂载前（包括测试里
   * 直接调 render）setState 是 no-op，于是两组都算“未展开”，一行都渲染不出来。
   * 改成「缺失即未表态 → 当场推导」后，展开态是个纯派生值，首帧就是对的。
   */
  manualExpanded: Partial<Record<MemberRemovalGroupId, boolean>>;
  keyword: string;
}

export class MemberRemovalList extends Component<
  MemberRemovalListProps,
  MemberRemovalListState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  /** 各分类第一行的 DOM 节点，供 §3.4 的「点分类名滚到该组第一个成员」使用。 */
  private groupFirstItemRefs = new Map<MemberRemovalGroupId, HTMLDivElement>();
  private pendingScrollGroupId?: MemberRemovalGroupId;
  private scrollRaf?: number;

  constructor(props: MemberRemovalListProps) {
    super(props);
    this.state = {
      selected: new Map<string, Subscriber>(),
      manualExpanded: {},
      keyword: "",
    };
  }

  componentWillUnmount() {
    if (this.scrollRaf !== undefined) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = undefined;
    }
    this.groupFirstItemRefs.clear();
  }

  private get searching() {
    return this.state.keyword.trim().length > 0;
  }

  private buildGroups(vm: SubscriberListVM): MemberRemovalGroup[] {
    return buildMemberRemovalGroups({
      subscribers: vm.subscribers,
      viewerUid: this.props.viewerUid,
      viewerRole: this.props.viewerRole,
    });
  }

  /**
   * 计算某组当前是否展开。
   *
   * 优先用用户的手动表态；未表态时落回 §3.3 的默认推导（按**组数**，不按角色）。
   * 全程无副作用，所以首帧就能得到正确结果，不依赖 setState 时序。
   */
  private expandedFor(
    groupId: MemberRemovalGroupId,
    groups: MemberRemovalGroup[]
  ) {
    const manual = this.state.manualExpanded[groupId];
    const fallback = deriveDefaultExpandedGroups(groups);
    return isGroupExpanded({
      groupId,
      manualExpanded: {
        myBots: manual !== undefined ? manual : fallback.myBots,
        others:
          this.state.manualExpanded.others !== undefined
            ? this.state.manualExpanded.others
            : fallback.others,
      },
      searching: this.searching,
      groupCount: groups.length,
    });
  }

  private isSelected(uid: string) {
    return this.state.selected.has(uid);
  }

  /**
   * 切换某一行的选中态，并把**完整 Subscriber 列表**上报给父级。
   *
   * 上报的不是 uid 而是对象：父级要用名字拼二次确认文案。选中项直接存 Map，
   * 所以搜索/分页换掉当前结果集也不会丢选 —— 这是与早期版本（存 uid 集合、
   * 上报时反查瞬时可见集合）的关键区别。
   */
  private toggleSelected = (subscriber: Subscriber) => {
    this.setState(
      (prev) => {
        const next = new Map(prev.selected);
        if (next.has(subscriber.uid)) next.delete(subscriber.uid);
        else next.set(subscriber.uid, subscriber);
        return { selected: next };
      },
      () => this.reportSelection()
    );
  };

  private reportSelection() {
    const { onSelectionChange } = this.props;
    if (!onSelectionChange) return;
    // 直接用 Map 里存的对象，不再依赖「本次渲染出的可见集合」：后者会被搜索
    // 或分页整体替换，曾导致先勾选再搜索会静默丢弃之前的选择。
    onSelectionChange(Array.from(this.state.selected.values()));
  }

  /**
   * §3.4：**点击分类文字** = 展开（若收起）+ 滚动到该分类第一个成员。
   *
   * 已展开时只滚动、不收起 —— 点标题把内容点没了是很糟的交互。收起只由 chevron 负责。
   */
  private onGroupLabelClick = (
    groupId: MemberRemovalGroupId,
    groups: MemberRemovalGroup[]
  ) => {
    const alreadyExpanded = this.expandedFor(groupId, groups);
    if (alreadyExpanded) {
      this.scrollToGroupFirstItem(groupId);
      return;
    }
    this.pendingScrollGroupId = groupId;
    this.setState(
      (prev) => ({
        manualExpanded: { ...prev.manualExpanded, [groupId]: true },
      }),
      () => {
        // 展开后布局要到下一帧才成立，此刻 scrollIntoView 会滚不到位
        // （目标高度仍是 0）。故推到 rAF 里执行。
        this.flushPendingScroll();
      }
    );
  };

  /** §3.4：**点击 chevron** = 纯展开/收起，不滚动。 */
  private onGroupChevronClick = (
    event: React.MouseEvent,
    groupId: MemberRemovalGroupId,
    groups: MemberRemovalGroup[]
  ) => {
    // 不 stopPropagation 的话会冒泡到标题行，变成「收起的同时又滚动」。
    event.stopPropagation();
    if (groups.length === 1) return; // 单组恒展开，chevron 无意义
    const currentlyExpanded = this.expandedFor(groupId, groups);
    this.setState((prev) => ({
      manualExpanded: {
        ...prev.manualExpanded,
        [groupId]: !currentlyExpanded,
      },
    }));
  };

  private flushPendingScroll() {
    const groupId = this.pendingScrollGroupId;
    if (!groupId) return;
    this.pendingScrollGroupId = undefined;
    if (this.scrollRaf !== undefined) cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = undefined;
      this.scrollToGroupFirstItem(groupId);
    });
  }

  private scrollToGroupFirstItem(groupId: MemberRemovalGroupId) {
    const node = this.groupFirstItemRefs.get(groupId);
    if (!node?.scrollIntoView) return;
    // block:"nearest" 与 FileListPanel 一致：目标已在视口内时不做多余滚动。
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private searchDebouncedMap = new WeakMap<
    SubscriberListVM,
    (keyword: string) => void
  >();

  /**
   * 滚动到底时继续拉下一页，写法与 SubscriberList 一致（同一个 throttle 工具）。
   *
   * 按 VM 存一份：throttle 有内部时间戳状态，每次 render 新建会让节流失效。
   */
  private throttledScrollMap = new WeakMap<
    SubscriberListVM,
    (event: React.UIEvent<HTMLDivElement>) => void
  >();

  private getThrottledScroll(vm: SubscriberListVM) {
    if (!this.throttledScrollMap.has(vm)) {
      this.throttledScrollMap.set(
        vm,
        throttle((event: React.UIEvent<HTMLDivElement>) => {
          const target = event.target as HTMLDivElement;
          const offset = 200;
          if (
            target.scrollTop + target.clientHeight + offset >=
            target.scrollHeight
          ) {
            vm.loadMoreSubscribersIfNeed();
          }
        }, 100)
      );
    }
    return this.throttledScrollMap.get(vm)!;
  }

  private getDebouncedSearch(vm: SubscriberListVM) {
    if (!this.searchDebouncedMap.has(vm)) {
      this.searchDebouncedMap.set(
        vm,
        debounce((keyword: string) => vm.search(keyword), 300)
      );
    }
    return this.searchDebouncedMap.get(vm)!;
  }

  private onSearchChange = (keyword: string, vm: SubscriberListVM) => {
    this.setState({ keyword });
    this.getDebouncedSearch(vm)(keyword);
  };

  private getShowName = (subscriber: Subscriber) => {
    const channelInfo = getCurrentImChannelInfo(
      new Channel(subscriber.uid, ChannelTypePerson)
    );
    const remark = channelInfo?.orgData?.remark;
    if (remark && remark.trim() !== "") return remark;
    if (subscriber.remark && subscriber.remark.trim() !== "") {
      return subscriber.remark;
    }
    return subscriber.name;
  };

  private groupTitle(group: MemberRemovalGroup) {
    const count = group.subscribers.length;
    if (group.id === "myBots") {
      return this.context.t("base.subscribers.groupMyBotsWithCount", {
        values: { count },
      });
    }
    return this.context.t("base.subscribers.groupOtherMembersWithCount", {
      values: { count },
    });
  }

  private renderSubscriberRow(
    subscriber: Subscriber,
    group: MemberRemovalGroup,
    indexInGroup: number
  ) {
    const itemIsBot = isBot(subscriber.uid);
    const isBotAdmin = subscriber.orgData?.bot_admin === 1;
    const selected = this.isSelected(subscriber.uid);
    const { isExternal, sourceSpaceName } = resolveExternalForViewer({
      homeSpaceId: subscriber.orgData?.home_space_id,
      homeSpaceName: subscriber.orgData?.home_space_name,
      isExternalLegacy: subscriber.orgData?.is_external,
      sourceSpaceNameLegacy: subscriber.orgData?.source_space_name,
    });
    return (
      <div
        className="wk-subscrierlist-list-item wk-memberremoval-item"
        key={subscriber.uid}
        data-testid="member-removal-row"
        // 整行可点即切换选中，所以行本身就是那个 checkbox 控件：把 role/tabIndex/
        // 键盘事件挂在这里，而不是里面那个纯装饰的圆圈 —— 否则键盘用户根本
        // 选不了人（圆圈不可聚焦，行又没有键盘处理）。
        role="checkbox"
        aria-checked={selected}
        aria-label={this.getShowName(subscriber)}
        tabIndex={0}
        onClick={() => this.toggleSelected(subscriber)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          this.toggleSelected(subscriber);
        }}
        ref={(node) => {
          // 只记录每组第一行，供点分类名时滚动定位。
          if (indexInGroup !== 0) return;
          if (node) this.groupFirstItemRefs.set(group.id, node);
          else this.groupFirstItemRefs.delete(group.id);
        }}
      >
        {/*
          圆形多选控件。不用 Semi 的 Checkbox：那是方形的，而设计要求圆形；
          与其覆盖它的内部样式，不如用原生语义元素自己画，顺带拿到正确的
          role/aria-checked。整行可点，这里 tabIndex={-1} 避免焦点重复停留。
        */}
        <span
          className={`wk-memberremoval-check${
            selected ? " wk-memberremoval-check-on" : ""
          }`}
          data-testid="member-removal-check"
          // 无障碍语义已由行容器承担（role=checkbox + aria-checked + tabIndex），
          // 这里只是视觉圆圈，标 aria-hidden 避免屏幕阅读器把同一个控件报两次。
          aria-hidden="true"
        >
          {selected && (
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path
                d="M3.5 8.5l3 3 6-6.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          )}
        </span>
        <div className="wk-subscrierlist-item-avatar">
          <WKAvatar src={subscriber.avatar}></WKAvatar>
        </div>
        <div className="wk-subscrierlist-item-content">
          <div className="wk-subscrierlist-item-name">
            {this.getShowName(subscriber)}
            {isRealnameVerified(subscriber.orgData) && (
              <RealnameVerifiedBadge variant="icon" />
            )}
            {isExternal && sourceSpaceName && (
              <span
                className="wk-subscrierlist-item-space"
                title={`@${sourceSpaceName}`}
              >
                @{sourceSpaceName}
              </span>
            )}
            {itemIsBot && <AiBadge />}
            {itemIsBot && isBotAdmin && (
              <Tag size="small" color="green" style={{ marginLeft: 4 }}>
                {this.context.t("base.subscribers.botAdmin")}
              </Tag>
            )}
          </div>
          <div
            className={`wk-subscrierlist-item-desc${
              subscriber.role === GroupRole.owner
                ? " wk-subscrierlist-item-desc-owner"
                : subscriber.role === GroupRole.manager
                ? " wk-subscrierlist-item-desc-manager"
                : ""
            }`}
          >
            {subscriber.role === GroupRole.owner
              ? this.context.t("base.subscribers.role.owner")
              : subscriber.role === GroupRole.manager
              ? this.context.t("base.subscribers.role.manager")
              : ""}
          </div>
        </div>
      </div>
    );
  }

  private renderGroup(
    group: MemberRemovalGroup,
    groups: MemberRemovalGroup[]
  ) {
    const expanded = this.expandedFor(group.id, groups);
    // 单组时 chevron 无意义（收起后页面全空），隐藏它而不是渲染一个点了没反应的控件。
    const collapsible = groups.length > 1;
    return (
      <div className="wk-memberremoval-group" key={group.id}>
        {/* 分类文字是独立点击区：展开 + 滚动定位。chevron 在右侧，只管折叠（§3.4）。 */}
        <div
          className="wk-memberremoval-group-header"
          data-testid={`member-removal-group-${group.id}`}
          role="button"
          tabIndex={0}
          onClick={() => this.onGroupLabelClick(group.id, groups)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.onGroupLabelClick(group.id, groups);
          }}
        >
          <span
            className="wk-memberremoval-group-label"
            data-testid={`member-removal-label-${group.id}`}
          >
            {this.groupTitle(group)}
          </span>
          {collapsible && (
            <button
              type="button"
              className={`wk-memberremoval-group-chevron${
                expanded ? " wk-memberremoval-group-chevron-expanded" : ""
              }`}
              data-testid={`member-removal-chevron-${group.id}`}
              aria-label={this.context.t(
                expanded
                  ? "base.subscribers.collapseGroup"
                  : "base.subscribers.expandGroup"
              )}
              aria-expanded={expanded}
              onClick={(event) =>
                this.onGroupChevronClick(event, group.id, groups)
              }
            >
              <svg aria-hidden="true" viewBox="0 0 12 12">
                <path
                  d="M2.5 4.5L6 8l3.5-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          )}
        </div>
        {expanded && (
          <div className="wk-memberremoval-group-body">
            {group.subscribers.map((subscriber, index) =>
              this.renderSubscriberRow(subscriber, group, index)
            )}
            {group.truncated && (
              <div
                className="wk-memberremoval-group-truncated"
                data-testid="member-removal-truncated-hint"
              >
                {this.context.t("base.subscribers.othersGroupTruncated", {
                  values: { count: MAX_OTHERS_GROUP_SIZE },
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  render() {
    return (
      <Provider
        create={() => {
          // 有意**不**把 canRemove 作为 filter 传给 VM。
          //
          // list_vm 有一条「filter 把本页结果砍光就自动翻下一页」的逻辑，普通成员
          // 在 500 人群里只有 1 个 bot，那会连翻 10 页把全群扫一遍。过滤放在
          // 渲染层做，VM 保持朴素分页。
          return new SubscriberListVM(
            this.props.channel,
            undefined,
            this.props.localSearch
          );
        }}
        render={(vm: SubscriberListVM) => {
          const groups = this.buildGroups(vm);
          return (
            <div
              className="wk-subscrierlist wk-memberremoval"
              // 分页：SubscriberListVM 每页只拉 50 人，其余靠滚到底时继续加载。
              // 没有这一句的话列表永远停在第 50 人：大群里普通成员的 bot 若排在 50
              // 名之后，减号入口亮着（showRemove 按全量本地名册判定）但页面渲染空态，
              // 恰好是共享判据本想避免的那个「点得进去、里面没东西」死胡同。
              onScroll={(event) => this.getThrottledScroll(vm)(event)}
            >
              <div className="wk-indextable-search-box">
                <div className="wk-indextable-search-icon">
                  <IconSearchStroked className="wk-subscrierlist-search-icon" />
                </div>
                <div className="wk-indextable-search-input">
                  <input
                    type="text"
                    data-testid="member-removal-search"
                    placeholder={this.context.t(
                      "base.subscribers.searchPlaceholder"
                    )}
                    onChange={(event) =>
                      this.onSearchChange(event.target.value, vm)
                    }
                  />
                </div>
              </div>
              {groups.length === 0 ? (
                <div
                  className="wk-memberremoval-empty"
                  data-testid="member-removal-empty"
                >
                  {this.context.t("base.subscribers.noRemovableMembers")}
                </div>
              ) : (
                groups.map((group) => this.renderGroup(group, groups))
              )}
            </div>
          );
        }}
      ></Provider>
    );
  }
}
