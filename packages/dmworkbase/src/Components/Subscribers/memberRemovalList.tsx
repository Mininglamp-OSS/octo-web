import React, { Component } from "react";
import { IconSearchStroked } from "@douyinfe/semi-icons";
import { Tag } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";

import Provider from "../../Service/Provider";
import { GroupRole } from "../../Service/Const";
import { I18nContext } from "../../i18n";
import { throttle } from "../../Utils/rateLimit";
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
import { canRemoveChannelSettingSubscriber, memberRemovalEligibility } from "../../features/channelSetting/memberRemovalPermission";
import { ChannelSettingActivityBinding } from "../../features/channelSetting/channelSettingActivity";
import {
  addCurrentImChannelInfoListener,
  addCurrentImSubscriberChangeListener,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../im-runtime/currentChannelRuntime";
import { MemberSelectionEvidence, readSelectedMembers } from "../../bridge/channelSetting/memberRemovalRead";
import AiBadge from "../AiBadge";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import WKButton from "../WKButton";
import WKAvatar, { isBot } from "../WKAvatar";
import { SubscriberListVM } from "./list_vm";
import { resolveSubscriberShowName } from "./subscriberShowName";
import "./list.css";
import "./memberRemovalList.css";

/**
 * 自动续翻的页数预算。
 *
 * 本页把 canRemove 当 VM 的 filter 用，所以拿到一页全被砍光时 list_vm 会自动翻
 * 下一页。稀疏场景（普通成员在大群里只有 1 个自己的 bot）会一路翻到群尾，所以
 * 给一个上限：20 页 × 50 条 = 前 1000 人。到顶后改为引导用户搜索（搜索是服务端
 * 权威的，能触及名册任意位置），而不是无限翻下去、也不是静默停住。
 */
const MAX_AUTO_PAGES = 20;

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
 * ## 数据源：与「查看全部」同构 —— 服务端分页 + Provider 持有 VM
 *
 * 本页走 SubscriberListVM（`members?page=N&limit=50`），并把 canRemove 作为
 * **VM 的 filter** 传进去。这两件事缺一不可，理由分别是：
 *
 * ### 为什么 filter 必须交给 VM，而不是在渲染层过滤
 *
 * list_vm 有一条补偿逻辑：「filter 把本页结果砍空就自动翻下一页」
 * （见 requestSubscribers 末尾）。它存在的意义正是本页这种稀疏过滤场景，
 * 「转让群主」页（filter=canTransferTo）一直靠它运作。
 *
 * 曾经为了躲开「普通成员在大群里只有 1 个 bot，会连翻很多页」而**刻意不传**
 * filter、改在渲染层过滤 —— 结果把这条兜底一起关掉了：第 1 页 50 条被全部
 * 过滤掉 → 页面只剩搜索框 + 一行空态 → 内容撑不满容器 → 永远不触发 scroll
 * → 永远翻不到第 2 页。而减号入口按完整名册判定，于是入口亮着、页面却说
 * 「你没有可移出的成员」。翻页开销用 MAX_AUTO_PAGES 预算兜住即可，不该靠
 * 关掉兜底来省。
 *
 * ### 为什么数据不能走 props
 *
 * 本页由 `routeContext.push(<MemberRemovalList .../>)` 推入，WKViewQueue 会把
 * 那个 JSX 元素存进**它自己的 state**，之后外部再怎么更新也不会给这个元素
 * 新的 props（octo-web#95 记录过同一个坑：PersonaCreate 的列表永远卡在空态）。
 * 所以名册一旦从 props 进来就是**冻结快照**：成员变动收不到、加载态永远翻不了
 * 身、按 props 变化触发的清理逻辑永远不会跑。
 *
 * 把 VM 放在 Provider 里（与 SubscriberList 完全同构）就没有这个问题：VM 活在
 * 被推入的子树**内部**，Provider 自己 setState 触发重渲染，外层 props 冻不冻结
 * 都无所谓。
 *
 * ### 超大群
 *
 * IM 本地成员缓存对超大群只有前 ~100 人，所以它只能当**加速器**用（拼音搜索
 * 的即时结果），不能当数据源。列表本体与关键词搜索都以服务端为权威 —— 这也是
 * 浏览路径的既定做法（见 list_vm.search 的注释）。
 *
 * ## 交互模型：多选 + 批量提交（不是逐行减号）
 *
 * 每行一个圆形勾选框，选中项跨分组共存，最后由路由 header 右上角的「确认」
 * 一次性提交。后端接受批量 uid，但执行/回包失败不保证没有成员被移出；
 * 提交方必须核对结果，不能把 HTTP 失败或局部缓存缺席当成最终成员状态。
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
  onRetryVerification?: (uids: string[]) => Promise<void>;
  /**
   * 可选的本地搜索实现（拼音等），与 SubscriberList 同契约。
   *
   * 只是**加速器**：本地 SDK 缓存对超大群只有前 ~100 人，所以 list_vm 在拿到
   * 本地结果后仍会照常打服务端关键词搜索并合并 —— 服务端始终是权威。
   *
   * 这里接收的是**工厂**而不是现成的搜索函数：索引要基于 VM 当前的名册重建，
   * 若在 push 时刻就用外部名册建好索引，它会和 props 一样被 WKViewQueue 冻住，
   * 成员变动后搜索的还是旧名册。
   */
  createLocalSearch?: (
    members: Subscriber[]
  ) => (keyword: string) => Subscriber[];
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
  submissionPending: boolean;
  uncertainUids: Set<string>;
  verificationMessage?: string;
  verificationRetryUids: string[];
  verificationProgress?: { checked: number; total: number };
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
  private unsubscribeSubscriberChangeListener?: () => void;
  /** 当前 Provider 创建出的 VM，供监听器回调里驱动刷新。 */
  private currentVM?: SubscriberListVM;
  /** channelInfo 到达时的重渲染合帧句柄（见 scheduleRerender）。 */
  private rerenderRaf?: number;
  private selectionRead?: AbortController;
  private selectionRevision = 0;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private verificationRead?: AbortController;
  private panelActive = true;
  private mounted = false;

  constructor(props: MemberRemovalListProps) {
    super(props);
    this.state = {
      selected: new Map<string, Subscriber>(),
      manualExpanded: {},
      keyword: "",
      submissionPending: false,
      uncertainUids: new Set(),
      verificationRetryUids: [],
    };
  }

  componentDidMount() {
    this.mounted = true;
    // 备注名：getShowName 优先用 1:1 频道的 orgData.remark，而那份缓存只会被
    // fetchCurrentImChannelInfo 填充。兄弟组件（SubscriberList）接了预取 + 监听，
    // 本页若不接，没聊过天的人就只显示原始昵称 —— 而这恰好是最需要认准
    // 「我要踢的是谁」的页面。
    //
    // 预取本身挂在 vm.onSubscribersLoaded 上（见 render），只覆盖**已加载的行**。
    // 早先按整份名册预取过，2000 人的群会在挂载瞬间打 2000 个请求、却只渲染
    // 200 行，把共享的每域名连接队列占满（实时 IM 流量排在后面）。
    this.unsubscribeChannelInfoListener = addCurrentImChannelInfoListener(
      (channelInfo) => {
        const uid = channelInfo?.channel?.channelID;
        if (uid && this.prefetchedUids.has(uid)) this.scheduleRerender();
      }
    );
    // 成员变动（别人被移出/退群/新人进来）时刷新当前结果集，并把已离群的人
    // 从选中里剔除。与 SubscriberList 同一套接线。
    this.unsubscribeSubscriberChangeListener =
      addCurrentImSubscriberChangeListener((channel: Channel) => {
        if (!channel?.isEqual?.(this.props.channel)) return;
        if (!this.panelActive) return;
        this.currentVM?.refreshCurrentSearch();
        this.selectionRead?.abort();
        clearTimeout(this.selectionTimer);
        this.selectionTimer = setTimeout(() => {
          if (!this.state.submissionPending) void this.reconcileSelectedMembers();
        }, 200);
      });
  }

  componentWillUnmount() {
    this.mounted = false;
    clearTimeout(this.selectionTimer);
    this.verificationRead?.abort();
    this.selectionRead?.abort();
    if (this.scrollRaf !== undefined) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = undefined;
    }
    if (this.rerenderRaf !== undefined) {
      cancelAnimationFrame(this.rerenderRaf);
      this.rerenderRaf = undefined;
    }
    this.unsubscribeChannelInfoListener?.();
    this.unsubscribeChannelInfoListener = undefined;
    this.unsubscribeSubscriberChangeListener?.();
    this.unsubscribeSubscriberChangeListener = undefined;
    this.groupFirstItemRefs.clear();
    this.prefetchedUids.clear();
    this.currentVM = undefined;
  }

  /**
   * 把 channelInfo 到达引发的重渲染合并到一帧一次。
   *
   * 备注名是逐个异步回来的，每到一条就 setState 会在大列表上产生成百上千次
   * 重渲染，而每次重渲染都要重跑一遍 O(名册) 的分组。
   */
  private scheduleRerender() {
    if (this.rerenderRaf !== undefined) return;
    this.rerenderRaf = requestAnimationFrame(() => {
      this.rerenderRaf = undefined;
      this.setState({});
    });
  }

  /**
   * 拉取显示名所需的人频道信息（只拉一次，已有缓存的跳过）。
   *
   * 入参是**已加载并过滤后的行**，不是整份名册 —— 边界与兄弟组件一致。
   */
  private prefetchShowNames = (subscribers: Subscriber[]) => {
    for (const subscriber of subscribers ?? []) {
      if (!subscriber?.uid || this.prefetchedUids.has(subscriber.uid)) continue;
      this.prefetchedUids.add(subscriber.uid);
      const personChannel = new Channel(subscriber.uid, ChannelTypePerson);
      if (!getCurrentImChannelInfo(personChannel)) {
        void fetchCurrentImChannelInfo(personChannel);
      }
    }
  };

  /** Called only for membership events, not for every page/search callback. */
  async reconcileSelectedMembers() {
    this.selectionRead?.abort();
    if (!this.panelActive || !this.state.selected.size) return;
    const controller = new AbortController();
    this.selectionRead = controller;
    const revision = this.selectionRevision;
    const evidence = await readSelectedMembers(
      this.props.channel, [...this.state.selected.keys()], controller.signal, { retryUnknown: true }
    );
    if (controller.signal.aborted || revision !== this.selectionRevision) return;
    this.applySelectionEvidence(evidence);
  }

  /** Unknown reads retain selection; only explicit server evidence may prune. */
  applySelectionEvidence(evidence: MemberSelectionEvidence) {
    const invalid = new Set(evidence.absent);
    const uncertain = new Set(evidence.unknown);
    for (const subscriber of evidence.present) {
      const eligibility = memberRemovalEligibility({
        viewerUid: this.props.viewerUid, viewerRole: this.props.viewerRole, subscriber,
      });
      if (eligibility === "denied") invalid.add(subscriber.uid);
      if (eligibility === "unknown") uncertain.add(subscriber.uid);
    }
    for (const uid of invalid) this.currentVM?.removeSubscriber(uid);
    this.selectionRevision++;
    this.setState(
      (prev) => {
        const next = new Map(prev.selected);
        const pending = new Set(prev.uncertainUids);
        for (const uid of invalid) next.delete(uid);
        for (const uid of [...evidence.absent, ...evidence.present.map(row => row.uid)]) pending.delete(uid);
        for (const uid of uncertain) if (next.has(uid)) pending.add(uid);
        for (const row of evidence.present) {
          if (next.has(row.uid) && !uncertain.has(row.uid)) next.set(row.uid, row);
        }
        return { selected: next, uncertainUids: pending };
      },
      () => this.reportSelection()
    );
  }

  refreshMembers() {
    void this.currentVM?.refreshCurrentSearch();
  }

  setSubmissionPending(pending: boolean) {
    this.setState(prev => ({ submissionPending: pending,
      verificationProgress: pending ? prev.verificationProgress : undefined }));
  }

  beginVerification(total: number) {
    this.selectionRead?.abort();
    clearTimeout(this.selectionTimer);
    this.verificationRead?.abort();
    this.verificationRead = new AbortController();
    if (!this.panelActive) this.verificationRead.abort();
    this.setState({ submissionPending: true, verificationMessage: undefined,
      verificationProgress: { checked: 0, total } });
    return this.verificationRead.signal;
  }

  updateVerificationProgress = (checked: number, total: number) => {
    if (this.mounted && !this.verificationRead?.signal.aborted) {
      this.setState({ verificationProgress: { checked, total } });
    }
  };

  showVerificationResult(message: string, retryUids: string[]) {
    this.setState({ verificationMessage: message, verificationRetryUids: retryUids,
      verificationProgress: undefined });
  }

  private setPanelActive = (active: boolean) => {
    this.panelActive = active;
    if (!active) {
      this.selectionRead?.abort();
      this.verificationRead?.abort();
      clearTimeout(this.selectionTimer);
      if (this.mounted && this.state.submissionPending) {
        this.setState({ submissionPending: false, verificationProgress: undefined,
          verificationMessage: this.context.t("base.subscribers.verificationPaused"),
          verificationRetryUids: [...this.state.selected.keys()] });
      }
    }
  };

  private retryVerification = async () => {
    if (this.state.submissionPending) return;
    const uids = [...new Set([...this.state.verificationRetryUids, ...this.state.uncertainUids])];
    if (this.props.onRetryVerification && uids.length) await this.props.onRetryVerification(uids);
    else await this.reconcileSelectedMembers();
  };

  private get searching() {
    return this.state.keyword.trim().length > 0;
  }

  private buildGroups(vm: SubscriberListVM): MemberRemovalGroup[] {
    return buildMemberRemovalGroups({
      // VM 已经把 canRemove 当 filter 用过一遍（并据此决定要不要继续翻页），
      // 这里再过一遍是幂等的：分组模块自己也要对外保证「只输出可移除的人」，
      // 不能靠调用方先过滤过。
      subscribers: vm.subscribers,
      viewerUid: this.props.viewerUid,
      viewerRole: this.props.viewerRole,
      hasMore: vm.hasMore || vm.loading,
    });
  }

  /**
   * 搜索：本地索引出即时结果，服务端结果为权威（与浏览路径同一套）。
   *
   * 节流/防抖的实例按 VM 存一份：它们有内部时间戳状态，每次 render 新建会让
   * 节流彻底失效。
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

  private onSearchChange = (keyword: string, vm: SubscriberListVM) => {
    // The VM invalidates the old query and marks debounce pending immediately;
    // delaying the entire search() would leave an empty old result looking final.
    vm.search(keyword, 300);
    this.setState({ keyword });
  };

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
    if (this.state.submissionPending) return;
    this.selectionRevision++;
    this.setState(
      (prev) => {
        const next = new Map(prev.selected);
        if (next.has(subscriber.uid)) next.delete(subscriber.uid);
        else next.set(subscriber.uid, subscriber);
        const uncertainUids = new Set(prev.uncertainUids);
        if (!next.has(subscriber.uid)) uncertainUids.delete(subscriber.uid);
        return { selected: next, uncertainUids };
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

  private getShowName = (subscriber: Subscriber) =>
    resolveSubscriberShowName(subscriber);

  private groupTitle(group: MemberRemovalGroup) {
    // 用 total（截断前的真实人数）而不是渲染出的行数，否则 500 人的群会写成
    // 「其他成员（200）」，把渲染上限冒充成人口普查。
    const count = group.total;
    if (group.id === "myBots") {
      return this.context.t(group.isPartial
        ? "base.subscribers.groupMyBotsLoaded"
        : "base.subscribers.groupMyBotsWithCount", {
        values: { count },
      });
    }
    return this.context.t(group.isPartial
      ? "base.subscribers.groupOtherMembersLoaded"
      : "base.subscribers.groupOtherMembersWithCount", {
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
        aria-disabled={this.state.submissionPending || undefined}
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
              <Tag size="small" color="green" style={{ marginLeft: "var(--wk-sp-1)" }}>
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
    const collapsible = groups.length > 1 && !this.searching;
    return (
      <div className="wk-memberremoval-group" key={group.id}>
        {/* 分类文字是独立点击区：展开 + 滚动定位。chevron 在右侧，只管折叠（§3.4）。 */}
        <div
          className="wk-memberremoval-group-header"
          data-testid={`member-removal-group-${group.id}`}
        >
          <button
            type="button"
            className="wk-memberremoval-group-label"
            data-testid={`member-removal-label-${group.id}`}
            aria-expanded={expanded}
            onClick={() => this.onGroupLabelClick(group.id, groups)}
          >
            {this.groupTitle(group)}
          </button>
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
                {this.context.t(this.searching
                  ? "base.subscribers.searchResultsTruncated"
                  : "base.subscribers.othersGroupTruncated", {
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
          const vm: SubscriberListVM = new SubscriberListVM(
            this.props.channel,
            // canRemove 必须作为 **VM 的 filter** 传进去，不能只在渲染层过滤：
            // list_vm 靠它才能知道「本页被砍空了，得接着翻下一页」。去掉它等于
            // 把唯一的自动翻页兜底关掉，稀疏场景下列表会永远停在第 1 页。
            (subscriber) =>
              canRemoveChannelSettingSubscriber({
                viewerUid: this.props.viewerUid,
                viewerRole: this.props.viewerRole,
                subscriber,
              }),
            // 索引基于 VM 当前名册建，而不是 push 时刻的外部快照 —— 后者会跟 props
            // 一起被 WKViewQueue 冻住，成员变动后搜到的还是旧名册。
            this.props.createLocalSearch
              ? (keyword: string, roster?: Subscriber[]) =>
                  this.props.createLocalSearch!(roster ?? vm.subscribers)(
                    keyword
                  )
              : undefined,
            { maxAutoPages: MAX_AUTO_PAGES }
          );
          // 预取只覆盖**已加载的行**，与 SubscriberList 同一边界。
          vm.onSubscribersLoaded = this.prefetchShowNames;
          this.currentVM = vm;
          return vm;
        }}
        render={(vm: SubscriberListVM) => {
          this.currentVM = vm;
          const groups = this.buildGroups(vm);
          return (
            <div
              className="wk-subscrierlist wk-memberremoval"
              // 滚到底继续拉下一页（写法与 SubscriberList 一致）。自动续翻只负责「凑满一屏」，
              // 凑满之后的翻页仍由用户滚动驱动。
              onScroll={(event) => this.getThrottledScroll(vm)(event)}
            >
              <ChannelSettingActivityBinding onChange={this.setPanelActive} />
              {this.renderVerification()}
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
              {this.renderBody(groups, vm)}
            </div>
          );
        }}
      ></Provider>
    );
  }

  /** Render one derived request state, including visible errors alongside rows. */
  private renderVerification() {
    const { verificationMessage, verificationProgress, uncertainUids, submissionPending } = this.state;
    if (!verificationMessage && !verificationProgress && !uncertainUids.size) return null;
    return <div className="wk-memberremoval-verification" role="status" data-testid="member-removal-verification">
      {verificationProgress
        ? this.context.t("base.subscribers.verificationProgress", { values: verificationProgress })
        : verificationMessage}
      {uncertainUids.size > 0 && <div>
        {this.context.t("base.subscribers.verificationUnknownNames", {
          values: { names: [...uncertainUids].map(uid => {
            const row = this.state.selected.get(uid);
            return row ? this.getShowName(row) : uid;
          }).join("、") },
        })}
      </div>}
      {!submissionPending && (this.state.verificationRetryUids.length > 0 || uncertainUids.size > 0) &&
        <WKButton size="sm" variant="ghost" onClick={() => void this.retryVerification()}>
          {this.context.t("base.subscribers.verificationRetry")}
        </WKButton>}
    </div>;
  }

  private renderBody(groups: MemberRemovalGroup[], vm: SubscriberListVM) {
    return <>
      {groups.map((group) => this.renderGroup(group, groups))}
      {this.renderRequestState(vm, groups.length > 0)}
    </>;
  }

  private renderRequestState(vm: SubscriberListVM, hasRows: boolean) {
    if (vm.status === "idle" || vm.loading) {
      return (
        <div
          className="wk-memberremoval-empty"
          data-testid="member-removal-loading"
          role="status"
        >
          {this.context.t("base.subscribers.loadingMembers")}
        </div>
      );
    }
    if (vm.loadError) {
      return (
        <div
          className="wk-memberremoval-empty"
          data-testid="member-removal-error"
          role="alert"
        >
          {this.context.t("base.subscribers.loadMembersFailed")}
          <WKButton size="sm" variant="ghost" data-testid="member-removal-retry"
            onClick={() => void vm.retry()}>
            {this.context.t("base.subscribers.retry")}
          </WKButton>
        </div>
      );
    }
    // 页数预算用尽：名册还没扫完，不能说「没有可移出的成员」，要给出路。
    // 搜索是服务端权威的，能触及名册任意位置。
    if (vm.autoPageBudgetExhausted) {
      return (
        <div
          className="wk-memberremoval-empty"
          data-testid="member-removal-budget-exhausted"
        >
          {this.context.t("base.subscribers.removalScanBudget", {
            values: { count: MAX_AUTO_PAGES * vm.limit },
          })}
        </div>
      );
    }
    if (vm.hasMore) {
      return <div className="wk-memberremoval-empty">
        <WKButton size="sm" variant="ghost" data-testid="member-removal-load-more"
          onClick={() => void vm.loadMoreSubscribersIfNeed()}>
          {this.context.t("base.subscribers.loadMore")}
        </WKButton>
      </div>;
    }
    if (hasRows) return null;
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
