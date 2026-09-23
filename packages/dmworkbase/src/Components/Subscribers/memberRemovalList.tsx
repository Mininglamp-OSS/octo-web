import React, { Component } from "react";
import { IconSearchStroked } from "@douyinfe/semi-icons";
import { Tag } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";

import { GroupRole } from "../../Service/Const";
import { I18nContext } from "../../i18n";
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
import {
  addCurrentImChannelInfoListener,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../im-runtime/currentChannelRuntime";import AiBadge from "../AiBadge";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import WKAvatar, { isBot } from "../WKAvatar";
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
 * ## 数据源：与减号入口同一份完整名册（不分页）
 *
 * 本页**不**用 SubscriberListVM。那条路是 `members?page=N&limit=50` 的服务端
 * 分页，而本页的可见性判据（canRemove）只能在**加载之后**于客户端计算，两者
 * 叠在一起会死锁：
 *
 *   普通成员唯一可移除的对象是自己的普通 bot。若它排在名册第 51 位之后，
 *   第 1 页 50 条全被 canRemove 过滤掉 → 页面只剩搜索框 + 一行空态提示 →
 *   内容撑不满容器 → **永远不会触发 scroll 事件** → 永远翻不到第 2 页。
 *   而减号入口读的是完整名册（见下），所以入口亮着、页面却说「你没有可移出的
 *   成员」—— 后者是假话，人就在没被拉取的页上。
 *
 * 所以改为直接消费 `ChannelSettingRouteData.subscriberAll`：它由 IM SDK 的频道
 * 成员缓存填充（底层是 `groups/:id/membersync?limit=10000`），**和减号入口
 * （Subscribers/vm.ts 的 showRemove）读的是同一份数据**。入口与页面同源之后，
 * 「入口比页面宽」这个矛盾从结构上不可能再出现 —— 最坏情况是两者一致地看不到
 * 超出 10000 的成员，而不是互相打脸。
 *
 * 代价是大群会一次性拿到全部名册，所以「其他成员」组保留
 * MAX_OTHERS_GROUP_SIZE 截断 + 「请用搜索」提示（换数据源后这段逻辑才真正可达）。
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
  /**
   * 群完整成员名册（`ChannelSettingRouteData.subscriberAll`）。
   *
   * 由 channelSettingMemberSection 传入，与减号入口的判定读同一份，见类注释。
   * 空数组有两种含义（名册还没加载好 / 群里真的没人），交给 `loading` 区分。
   */
  subscribers: Subscriber[];
  /**
   * 名册是否仍在加载。
   *
   * 必须与「过滤后为空」分开：早期版本对任何空结果都渲染「你在本群没有可移出的
   * 成员」，于是首帧（名册还没到）就先给用户一句确定的假话。
   */
  loading?: boolean;
  /** 行级权限判据所需的查看者身份。由 channelSettingMemberSection 传入。 */
  viewerUid?: string;
  viewerRole?: number;
  /**
   * 选中项变化时上报（含完整 Subscriber，父级做二次确认文案要用名字）。
   * 父级据此 enable/disable 路由表头的「确认」按钮。
   */
  onSelectionChange?: (selected: Subscriber[]) => void;
  /**
   * 可选的本地搜索实现（拼音等），与 SubscriberList 同契约。
   *
   * 名册全在内存，所以本页搜索是**纯本地**的：没有 debounce + 服务端 keyword
   * 请求那条路，输入即出结果。未注入时退化为对显示名做子串匹配。
   */
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
  /** 已发起过人频道信息预取的 uid，避免重复请求。 */
  private prefetchedUids = new Set<string>();
  private unsubscribeChannelInfoListener?: () => void;

  constructor(props: MemberRemovalListProps) {
    super(props);
    this.state = {
      selected: new Map<string, Subscriber>(),
      manualExpanded: {},
      keyword: "",
    };
  }

  componentDidMount() {
    // 备注名：getShowName 优先用 1:1 频道的 orgData.remark，而那份缓存只会被
    // fetchCurrentImChannelInfo 填充。兄弟组件（SubscriberList）接了预取 + 监听，
    // 本页若不接，没聊过天的人就只显示原始昵称 —— 而这恰好是最需要认准
    // 「我要踢的是谁」的页面。
    this.prefetchShowNames(this.props.subscribers);
    this.unsubscribeChannelInfoListener = addCurrentImChannelInfoListener(
      (channelInfo) => {
        const uid = channelInfo?.channel?.channelID;
        if (uid && this.prefetchedUids.has(uid)) this.setState({});
      }
    );
  }

  componentDidUpdate(prevProps: MemberRemovalListProps) {
    if (prevProps.subscribers !== this.props.subscribers) {
      this.prefetchShowNames(this.props.subscribers);
      this.pruneSelectionToRoster();
    }
  }

  componentWillUnmount() {
    if (this.scrollRaf !== undefined) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = undefined;
    }
    this.unsubscribeChannelInfoListener?.();
    this.unsubscribeChannelInfoListener = undefined;
    this.groupFirstItemRefs.clear();
  }

  /** 拉取显示名所需的人频道信息（只拉一次，已有缓存的跳过）。 */
  private prefetchShowNames(subscribers: Subscriber[]) {
    for (const subscriber of subscribers ?? []) {
      if (!subscriber?.uid || this.prefetchedUids.has(subscriber.uid)) continue;
      this.prefetchedUids.add(subscriber.uid);
      const personChannel = new Channel(subscriber.uid, ChannelTypePerson);
      if (!getCurrentImChannelInfo(personChannel)) {
        void fetchCurrentImChannelInfo(personChannel);
      }
    }
  }

  /**
   * 名册刷新后把已不在群里的人从选中里剔除。
   *
   * 选中项是跨搜索/刷新存活的（这是刻意设计），但「已经被别的管理员移走或自己
   * 退群的人」不应该继续躺在批量里：整批提交是全成全败的，一个已离开的 uid
   * 能把整次操作拖失败，而用户无法从报错里看出是哪一个。
   */
  private pruneSelectionToRoster() {
    const alive = new Set(
      (this.props.subscribers ?? []).map((subscriber) => subscriber.uid)
    );
    const stale = Array.from(this.state.selected.keys()).filter(
      (uid) => !alive.has(uid)
    );
    if (stale.length === 0) return;
    this.setState(
      (prev) => {
        const next = new Map(prev.selected);
        for (const uid of stale) next.delete(uid);
        return { selected: next };
      },
      () => this.reportSelection()
    );
  }

  private get searching() {
    return this.state.keyword.trim().length > 0;
  }

  private buildGroups(): MemberRemovalGroup[] {
    return buildMemberRemovalGroups({
      subscribers: this.visibleSubscribers(),
      viewerUid: this.props.viewerUid,
      viewerRole: this.props.viewerRole,
    });
  }

  /**
   * 当前关键词下要参与分类的名册。
   *
   * 名册全在内存，所以搜索是**纯本地**的：既不防抖也不打请求，输入即出结果。
   * 优先用注入的 localSearch（带拼音/首字母/备注/真实姓名索引，与「查看全部」、
   * 「转让群主」一致）；未注入时退化为对显示名做大小写无关的子串匹配。
   */
  private visibleSubscribers(): Subscriber[] {
    const keyword = this.state.keyword.trim();
    const roster = this.props.subscribers ?? [];
    if (!keyword) return roster;
    const { localSearch } = this.props;
    if (localSearch) {
      try {
        return localSearch(keyword);
      } catch {
        // 索引出错不应让整页变空，退回子串匹配。
      }
    }
    const lowered = keyword.toLowerCase();
    return roster.filter((subscriber) =>
      this.getShowName(subscriber).toLowerCase().includes(lowered)
    );
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
    const fallback = deriveDefaultExpandedGroups(groups);
    const resolve = (id: MemberRemovalGroupId) =>
      this.state.manualExpanded[id] !== undefined
        ? (this.state.manualExpanded[id] as boolean)
        : fallback[id];
    return isGroupExpanded({
      groupId,
      // 两个槽各自回退，不能把被问的那个组的表态写进 `myBots` 槽：
      // isGroupExpanded 目前只读 `manualExpanded[groupId]`，所以键错位恰好看不出来，
      // 但谁要是让该 helper 同时考虑两组就会踩坑。
      manualExpanded: {
        myBots: resolve("myBots"),
        others: resolve("others"),
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

  private onSearchChange = (keyword: string) => {
    // 纯本地过滤：名册已在内存，不防抖也不打请求。早期版本把 keyword 同步写 state
    // 而实际结果要等 300ms 防抖后的服务端响应，于是那段窗口里分组已按搜索态展开、
    // 行却还是搜索前的 —— 现在两者同一帧生效。
    this.setState({ keyword });
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
    // 用 total（截断前的真实人数）而不是渲染出的行数，否则 500 人的群会写成
    // 「其他成员（200）」，把渲染上限冒充成人口普查。
    const count = group.total;
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
          与其覆盖它的内部样式，不如自己画。无障碍语义已由**行容器**承担
          （role=checkbox + aria-checked + tabIndex），所以这里只是个纯装饰元素，
          标 aria-hidden 避免屏幕阅读器把同一个控件报两次。
        */}
        <span
          className={`wk-memberremoval-check${
            selected ? " wk-memberremoval-check-on" : ""
          }`}
          data-testid="member-removal-check"
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
            // 不能拦下子元素（chevron 按钮）自己的键盘激活：早期版本在这里无条件
            // preventDefault，把冗余上来的 Enter/Space 也吐掉了，于是 chevron 用键盘
            // 根本折叠不了。
            if (event.target !== event.currentTarget) return;
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
    const groups = this.buildGroups();
    const rosterEmpty = (this.props.subscribers ?? []).length === 0;
    return (
      <div className="wk-subscrierlist wk-memberremoval">
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
              onChange={(event) => this.onSearchChange(event.target.value)}
            />
          </div>
        </div>
        {this.renderBody(groups, rosterEmpty)}
      </div>
    );
  }

  /**
   * 空结果拆三态，不能全部归为「你没有可移出的成员」。
   *
   * 早期版本只看 `groups.length === 0`，于是：名册还没加载完的首帧会先给用户一句
   * 确定的假话；搜索无匹配时也说「本群没有可移出的成员」，而用户明明只是打错了
   * 一个字。现在：加载中 / 搜索无匹配 / 真的没有，各说各话。
   */
  private renderBody(groups: MemberRemovalGroup[], rosterEmpty: boolean) {
    if (groups.length > 0) {
      return groups.map((group) => this.renderGroup(group, groups));
    }
    if (this.props.loading && rosterEmpty) {
      return (
        <div
          className="wk-memberremoval-empty"
          data-testid="member-removal-loading"
        >
          {this.context.t("base.subscribers.loadingMembers")}
        </div>
      );
    }
    if (this.searching) {
      return (
        <div
          className="wk-memberremoval-empty"
          data-testid="member-removal-no-match"
        >
          {this.context.t("base.subscribers.noRemovableMatches")}
        </div>
      );
    }
    return (
      <div
        className="wk-memberremoval-empty"
        data-testid="member-removal-empty"
      >
        {this.context.t("base.subscribers.noRemovableMembers")}
      </div>
    );
  }
}
