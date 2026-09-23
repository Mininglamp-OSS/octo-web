import React from "react";
import { Subscriber } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

// 「移出成员」页的**组件行为**测试。
//
// 纯函数层（分类/截断/展开推导）由 memberRemovalGrouping.test.ts 覆盖，这里只钉
// 组件自己那部分，尤其是**它与数据源的接线** —— 前几轮的缺陷全部逃逸在这条缝上：
//
//   1. canRemove 必须作为 **VM 的 filter** 传进去。只在渲染层过滤会关掉 list_vm
//      「本页被砍空就自动翻下一页」的兜底，稀疏场景下列表永远停在第 1 页。
//   2. 数据必须由**子树内部**的 Provider+VM 提供，不能走 props：本页是被
//      routeContext.push 推入的，WKViewQueue 会把 JSX 冻在自己的 state 里，
//      props 永远不会更新（octo-web#95）。
//   3. 预取只覆盖**已加载的行**，不是整份名册。
//   4. 空态要分清「还没加载完 / 加载失败 / 翻页预算用尽 / 搜索无匹配 / 真的没有」，
//      对前四种说「你没有可移出的成员」都是在给用户一句确定的假话。
//
// 不走 DOM 挂载：render() 返回的是普通 React 元素对象，取出 Provider 的
// `create`/`render` 两个 prop 直接调用即可 —— 这正是 Provider 在生产里做的事。

const vmInstances: any[] = [];

vi.mock("../list_vm", () => ({
  SubscriberListVM: class {
    channel: any;
    filter?: (s: Subscriber) => boolean;
    localSearch?: (k: string) => Subscriber[];
    options?: { maxAutoPages?: number };
    subscribers: Subscriber[] = [];
    limit = 50;
    firstLoadSettled = true;
    loadError = false;
    autoPageBudgetExhausted = false;
    onSubscribersLoaded?: (s: Subscriber[]) => void;
    search = vi.fn();
    loadMoreSubscribersIfNeed = vi.fn();
    refreshCurrentSearch = vi.fn();
    constructor(
      channel: any,
      filter?: (s: Subscriber) => boolean,
      localSearch?: (k: string) => Subscriber[],
      options?: { maxAutoPages?: number }
    ) {
      this.channel = channel;
      this.filter = filter;
      this.localSearch = localSearch;
      this.options = options;
      vmInstances.push(this);
    }
  },
}));

const fetchedUids: string[] = [];
let subscriberChangeHandler: ((channel: any) => void) | undefined;
let cachedRoster: Subscriber[] = [];

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: () => undefined,
  fetchCurrentImChannelInfo: (channel: any) => {
    fetchedUids.push(channel.channelID);
    return Promise.resolve(undefined);
  },
  addCurrentImChannelInfoListener: () => () => {},
  addCurrentImSubscriberChangeListener: (fn: (channel: any) => void) => {
    subscriberChangeHandler = fn;
    return () => {
      subscriberChangeHandler = undefined;
    };
  },
  getCurrentImChannelSubscribers: () => cachedRoster,
}));

vi.mock("../../WKAvatar", () => ({
  default: () => null,
  isBot: (uid: string) => uid.startsWith("bot"),
}));

vi.mock("../../AiBadge", () => ({ default: () => null }));
vi.mock("../../RealnameVerifiedBadge", () => ({ default: () => null }));
vi.mock("@douyinfe/semi-icons", () => ({ IconSearchStroked: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({ Tag: () => null }));

import { MemberRemovalList } from "../memberRemovalList";
import { GroupRole } from "../../../Service/Const";
import { MAX_OTHERS_GROUP_SIZE } from "../../../features/channelSetting/memberRemovalGrouping";

type AnyElement = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

function collectByTestId(node: unknown, testId: string, out: AnyElement[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectByTestId(child, testId, out);
    return out;
  }
  const el = node as AnyElement;
  if (el.props?.["data-testid"] === testId) out.push(el);
  collectByTestId(el.props?.children, testId, out);
  return out;
}

const sub = (uid: string, role: number, orgData: any = {}) =>
  ({ uid, name: uid, role, orgData } as unknown as Subscriber);

const ownedBot = (uid: string) =>
  sub(uid, GroupRole.normal, { robot: 1, bot_owned_by_me: true });

const roster = [
  sub("owner", GroupRole.owner), // 自己，canRemove 恒 false
  ownedBot("bot-mine"),
  sub("human", GroupRole.normal),
];

function createComponent(
  props: Partial<{
    onSelectionChange: (items: Subscriber[]) => void;
    createLocalSearch: (m: Subscriber[]) => (k: string) => Subscriber[];
    viewerUid: string;
    viewerRole: number;
  }> = {}
) {
  vmInstances.length = 0;
  fetchedUids.length = 0;
  const component = new MemberRemovalList({
    channel: { channelID: "g1", isEqual: (c: any) => c?.channelID === "g1" } as never,
    viewerUid: props.viewerUid ?? "owner",
    viewerRole: props.viewerRole ?? GroupRole.owner,
    onSelectionChange: props.onSelectionChange,
    createLocalSearch: props.createLocalSearch,
  });
  (component as unknown as { context: unknown }).context = {
    t: (key: string, opts?: { values?: Record<string, unknown> }) =>
      opts?.values ? `${key}:${JSON.stringify(opts.values)}` : key,
  };
  (component as any).setState = (updater: any, cb?: () => void) => {
    const next =
      typeof updater === "function" ? updater((component as any).state) : updater;
    (component as any).state = { ...(component as any).state, ...next };
    cb?.();
  };
  return component;
}

/** 走 Provider 的真实两步：create() 造 VM，再用它渲染。 */
function mountThroughProvider(
  component: MemberRemovalList,
  vmOverrides: Record<string, unknown> = {}
) {
  const tree = component.render() as AnyElement;
  const create = tree.props?.create as () => any;
  const renderProp = tree.props?.render as (vm: any) => unknown;
  const vm = create();
  Object.assign(vm, vmOverrides);
  return { vm, content: renderProp(vm) };
}

function expandBothGroups(component: MemberRemovalList) {
  (component as any).state = {
    ...(component as any).state,
    manualExpanded: { myBots: true, others: true },
  };
}

describe("MemberRemovalList · 与数据源的接线", () => {
  // 回归：round-3 曾把 canRemove 只用在渲染层、给 VM 传 undefined filter，
  // 于是 list_vm「本页被砍空就自动翻下一页」的兜底被关掉，稀疏场景永远停在第 1 页。
  it("canRemove 作为 VM 的 filter 传入（否则自动翻页兜底会失效）", () => {
    const component = createComponent();
    const { vm } = mountThroughProvider(component);
    expect(typeof vm.filter).toBe("function");

    // filter 的语义必须与行级判据一致：自己不可移除，自有普通 bot 可移除。
    expect(vm.filter(sub("owner", GroupRole.owner))).toBe(false);
    expect(vm.filter(ownedBot("bot-mine"))).toBe(true);
  });

  it("传入翻页预算，避免稀疏过滤把整个大群翻完", () => {
    const { vm } = mountThroughProvider(createComponent());
    expect(vm.options?.maxAutoPages).toBeGreaterThan(0);
  });

  // 回归：索引若在 push 时刻用外部名册建好，会和 props 一起被 WKViewQueue 冻住，
  // 成员变动后搜到的还是旧名册。所以传的是**工厂**，每次都用 VM 当前名册重建。
  it("本地搜索索引基于 VM 当前名册重建，而不是 push 时刻的快照", () => {
    const seen: Subscriber[][] = [];
    const component = createComponent({
      createLocalSearch: (members) => {
        seen.push(members);
        return () => members;
      },
    });
    const { vm } = mountThroughProvider(component);

    vm.subscribers = [sub("a", GroupRole.normal)];
    vm.localSearch("x");
    vm.subscribers = [sub("a", GroupRole.normal), sub("b", GroupRole.normal)];
    vm.localSearch("x");

    expect(seen).toHaveLength(2);
    expect(seen[0].map((s) => s.uid)).toEqual(["a"]);
    expect(seen[1].map((s) => s.uid)).toEqual(["a", "b"]);
  });

  // 回归：预取一度遍历整份名册（上限 10000），2000 人的群会在挂载瞬间打 2000 个
  // 请求却只渲染 200 行，把共享的连接队列占满。边界必须是「已加载的行」。
  it("预取挂在 onSubscribersLoaded 上，只覆盖已加载的行", () => {
    const component = createComponent();
    const { vm } = mountThroughProvider(component);
    expect(typeof vm.onSubscribersLoaded).toBe("function");

    vm.onSubscribersLoaded([sub("a", GroupRole.normal), sub("b", GroupRole.normal)]);
    expect(fetchedUids.sort()).toEqual(["a", "b"]);

    // 同一个人不会被重复预取。
    vm.onSubscribersLoaded([sub("a", GroupRole.normal)]);
    expect(fetchedUids.sort()).toEqual(["a", "b"]);
  });

  // 回归：数据若走 props，本页被 push 后就永远收不到更新（octo-web#95）。
  // 成员变动要能驱动 VM 刷新，这条链路必须是活的。
  it("成员变动会驱动 VM 刷新当前结果集", () => {
    const component = createComponent();
    const { vm } = mountThroughProvider(component);
    component.componentDidMount();

    expect(subscriberChangeHandler).toBeTypeOf("function");
    subscriberChangeHandler!({ channelID: "g1", isEqual: (c: any) => c?.channelID === "g1" });
    expect(vm.refreshCurrentSearch).toHaveBeenCalled();

    // 别的群的变动不该触发刷新。
    vm.refreshCurrentSearch.mockClear();
    subscriberChangeHandler!({ channelID: "other", isEqual: () => false });
    expect(vm.refreshCurrentSearch).not.toHaveBeenCalled();

    component.componentWillUnmount();
  });
});

describe("MemberRemovalList · 多选交互", () => {
  it("首帧按 §3.3 的默认展开态渲染（我的 BOT 收起）", () => {
    const { content } = mountThroughProvider(createComponent(), {
      subscribers: roster,
    });
    const rows = collectByTestId(content, "member-removal-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].props?.["aria-label"]).toBe("human");
    expect(rows[0].props?.role).toBe("checkbox");
    expect(rows[0].props?.["aria-checked"]).toBe(false);

    expect(collectByTestId(content, "member-removal-group-myBots")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-group-others")).toHaveLength(1);
  });

  it("展开「我的 BOT」后两组的行都可勾选", () => {
    const component = createComponent();
    expandBothGroups(component);
    const { content } = mountThroughProvider(component, { subscribers: roster });
    expect(
      collectByTestId(content, "member-removal-row")
        .map((r) => r.props?.["aria-label"])
        .sort()
    ).toEqual(["bot-mine", "human"]);
  });

  it("勾选跨分组累加，并上报完整 Subscriber 给父级", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent({ onSelectionChange });
    expandBothGroups(component);
    mountThroughProvider(component, { subscribers: roster });

    (component as any).toggleSelected(roster[1]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ uid: "bot-mine" }),
    ]);

    (component as any).toggleSelected(roster[2]);
    const calls = onSelectionChange.mock.calls;
    expect((calls[calls.length - 1][0] as Subscriber[]).map((s) => s.uid).sort()).toEqual([
      "bot-mine",
      "human",
    ]);
  });

  it("取消全部选中时上报空数组（父级据此置灰「确认」）", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent({ onSelectionChange });
    mountThroughProvider(component, { subscribers: roster });
    (component as any).toggleSelected(roster[2]);
    (component as any).toggleSelected(roster[2]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("行可聚焦且响应 Enter/Space（键盘可操作）", () => {
    const component = createComponent();
    const { content } = mountThroughProvider(component, { subscribers: roster });
    const row = collectByTestId(content, "member-removal-row")[0];
    expect(row.props?.tabIndex).toBe(0);

    const preventDefault = vi.fn();
    (row.props?.onKeyDown as any)({ key: "Enter", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(Array.from((component as any).state.selected.keys())).toEqual(["human"]);

    (row.props?.onKeyDown as any)({ key: "a", preventDefault: vi.fn() });
    expect(Array.from((component as any).state.selected.keys())).toEqual(["human"]);
  });

  // 回归：标题的 onKeyDown 原本无条件 preventDefault，把冒泡上来的 Enter/Space
  // 一起吞了，于是里面那个 chevron <button> 用键盘反而按不动。
  it("分组标题不吞掉 chevron 的键盘事件，且带 aria-expanded", () => {
    const { content } = mountThroughProvider(createComponent(), {
      subscribers: roster,
    });
    const header = collectByTestId(content, "member-removal-group-others")[0];
    expect(header.props?.["aria-expanded"]).toBe(true);

    const fromChild = { key: "Enter", preventDefault: vi.fn(), target: {}, currentTarget: {} };
    (header.props?.onKeyDown as any)(fromChild);
    expect(fromChild.preventDefault).not.toHaveBeenCalled();

    const node = {};
    const fromSelf = { key: "Enter", preventDefault: vi.fn(), target: node, currentTarget: node };
    (header.props?.onKeyDown as any)(fromSelf);
    expect(fromSelf.preventDefault).toHaveBeenCalled();
  });
});

describe("MemberRemovalList · 选中项的存活与剔除", () => {
  // 选中项跨搜索/分页存活是刻意设计：结果集被换掉不能把之前的选择静默丢掉。
  it("结果集被换掉后，之前的选择仍在", () => {
    const onSelectionChange = vi.fn();
    const alice = sub("alice", GroupRole.normal);
    const bob = sub("bob", GroupRole.normal);
    const component = createComponent({ onSelectionChange });
    expandBothGroups(component);

    const tree = component.render() as AnyElement;
    const renderProp = tree.props?.render as (vm: any) => unknown;
    const vm = (tree.props?.create as () => any)();

    vm.subscribers = [alice, bob];
    renderProp(vm);
    (component as any).toggleSelected(alice);

    // 搜索把结果集换成只剩 bob。
    vm.subscribers = [bob];
    renderProp(vm);
    (component as any).toggleSelected(bob);

    const calls = onSelectionChange.mock.calls;
    const last = calls[calls.length - 1][0] as Subscriber[];
    expect(last.map((s) => s.uid).sort()).toEqual(["alice", "bob"]);
    expect(last.every((s) => typeof s.name === "string")).toBe(true);
  });

  // 但「已经不在群里的人」不该继续躺在批量里：整批提交全成全败，一个失效 uid
  // 能把整次操作拖失败，用户还无法从报错里看出是哪一个。
  it("已离群的选中项在名册刷新后被剔除", () => {
    const onSelectionChange = vi.fn();
    const alice = sub("alice", GroupRole.normal);
    const bob = sub("bob", GroupRole.normal);
    const component = createComponent({ onSelectionChange });
    const { vm } = mountThroughProvider(component, { subscribers: [alice, bob] });

    (component as any).toggleSelected(alice);
    (component as any).toggleSelected(bob);

    // alice 被别的管理员移走：缓存与新一批加载结果里都没有她。
    cachedRoster = [bob];
    vm.onSubscribersLoaded([bob]);

    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ uid: "bob" }),
    ]);
    cachedRoster = [];
  });

  // 缓存为空只说明「不知道谁还在群里」，不等于「所有人都走了」——
  // 此时静默取消用户的勾选是更糟的行为。
  it("成员缓存为空时不剔除任何选中项", () => {
    const onSelectionChange = vi.fn();
    const alice = sub("alice", GroupRole.normal);
    const component = createComponent({ onSelectionChange });
    const { vm } = mountThroughProvider(component, { subscribers: [alice] });
    (component as any).toggleSelected(alice);
    onSelectionChange.mockClear();

    cachedRoster = [];
    vm.onSubscribersLoaded([]);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(Array.from((component as any).state.selected.keys())).toEqual(["alice"]);
  });
});

describe("MemberRemovalList · 截断与真实人数", () => {
  // 回归：标题计数原本用截断**之后**的行数，500 人的群会显示成「其他成员（200）」——
  // 把一个渲染上限冒充成人口普查。
  it("超过渲染上限时，标题显示真实人数而不是上限值", () => {
    const many = Array.from({ length: MAX_OTHERS_GROUP_SIZE + 37 }, (_, i) =>
      sub(`human-${i}`, GroupRole.normal)
    );
    const { content } = mountThroughProvider(createComponent(), {
      subscribers: many,
    });

    const label = collectByTestId(content, "member-removal-label-others")[0];
    const text = String((label.props?.children as any) ?? "");
    expect(text).toContain(String(MAX_OTHERS_GROUP_SIZE + 37));
    expect(text).not.toContain(`:{"count":${MAX_OTHERS_GROUP_SIZE}}`);

    expect(collectByTestId(content, "member-removal-row")).toHaveLength(
      MAX_OTHERS_GROUP_SIZE
    );
    expect(collectByTestId(content, "member-removal-truncated-hint")).toHaveLength(1);
  });
});

describe("MemberRemovalList · 空态分型", () => {
  const emptyVM = (overrides: Record<string, unknown>) =>
    mountThroughProvider(createComponent(), { subscribers: [], ...overrides })
      .content;

  it("首次加载未结束：说加载中，不说「没有可移出的成员」", () => {
    const content = emptyVM({ firstLoadSettled: false });
    expect(collectByTestId(content, "member-removal-loading")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  // 回归：requestSubscribers 原本没有 catch，异常会静默逃逸，列表停在空，
  // 于是把一次网络失败说成了「这里没有任何成员」。
  it("加载失败：说失败，不说「没有可移出的成员」", () => {
    const content = emptyVM({ loadError: true });
    expect(collectByTestId(content, "member-removal-error")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("翻页预算用尽：给出搜索这条出路，而不是断言没有", () => {
    const content = emptyVM({ autoPageBudgetExhausted: true });
    expect(collectByTestId(content, "member-removal-budget-exhausted")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("搜索无匹配：说没匹配，不说「本群没有可移出的成员」", () => {
    const component = createComponent();
    (component as any).state = { ...(component as any).state, keyword: "zzz" };
    const { content } = mountThroughProvider(component, { subscribers: [] });
    expect(collectByTestId(content, "member-removal-no-match")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("加载完成、无搜索、确实没有可移出的人：才说空", () => {
    const content = emptyVM({});
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-loading")).toHaveLength(0);
  });
});
