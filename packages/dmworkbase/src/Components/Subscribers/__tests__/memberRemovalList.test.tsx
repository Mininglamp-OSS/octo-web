import React from "react";
import { Channel, Subscriber } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  subscriberChangeListener: undefined as
    | ((channel: Channel) => void)
    | undefined,
  unsubscribe: vi.fn(),
}));

// 「移出成员」页的**交互模型**测试：多选 + 上报选择。
//
// 纯函数层（分类/展开推导）已由 memberRemovalGrouping.test.ts 覆盖，这里只钉
// 组件自己的那部分行为，也就是最容易在重构中悄悄丢掉的两件事：
//
//   1. 勾选是**多选且跨分组**的 —— 管理员要能一次勾「我的 BOT」里的和
//      「其他成员」里的，一并提交。做成单选或按组互斥都会让批量能力失效。
//   2. 每次勾选变化都要 onSelectionChange 上报**完整 Subscriber**（不是 uid）——
//      父级要用名字拼二次确认文案，也靠它 enable/disable 路由表头的「确认」。
//
// 不走 DOM 挂载：组件 render() 返回的是普通 React 元素对象，遍历树取到行节点的
// onClick 调用即可。这样既不用处理 Provider 的数据加载时序，也不用 mock 掉
// WKAvatar 等一堆渲染期依赖。

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  addCurrentImSubscriberChangeListener: vi.fn(
    (listener: (channel: Channel) => void) => {
      runtime.subscriberChangeListener = listener;
      return runtime.unsubscribe;
    }
  ),
  getCurrentImChannelInfo: () => undefined,
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
import { SubscriberListVM } from "../list_vm";
import { GroupRole } from "../../../Service/Const";

type AnyElement = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

/** 深度优先收集所有 data-testid 命中的元素。 */
function collectByTestId(
  node: unknown,
  testId: string,
  out: AnyElement[] = []
) {
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

/** 群主视角：两组都非空（我的 bot + 其他成员）。 */
const roster = [
  sub("owner", GroupRole.owner), // 自己，canRemove 恒 false
  sub("bot-mine", GroupRole.normal, { robot: 1, bot_owned_by_me: true }),
  sub("human", GroupRole.normal),
];

/**
 * 渲染一次并返回组件 + 元素树。
 *
 * 组件未挂载，所以 setState 是 no-op —— 要改状态得直接赋值给 this.state
 * （见 applySelection）。这是测试替身的常见做法：本组测的是选择逻辑与渲染
 * 映射，不是 React 的调度行为。
 */
function render(
  component: MemberRemovalList,
  subscribers = roster,
  overrides: Record<string, unknown> = {}
) {
  const tree = component.render() as AnyElement;
  const renderProp = tree.props?.render as (vm: unknown) => unknown;
  return renderProp({
    subscribers,
    search: vi.fn(),
    loadMoreSubscribersIfNeed: vi.fn(),
    retry: vi.fn(),
    firstLoadSettled: true,
    loadError: false,
    autoPaging: false,
    hasMore: false,
    ...overrides,
  });
}

function createComponent(onSelectionChange?: (items: Subscriber[]) => void) {
  const component = new MemberRemovalList({
    channel: new Channel("g1", 2),
    viewerUid: "owner",
    viewerRole: GroupRole.owner,
    onSelectionChange,
  });
  (component as unknown as { context: unknown }).context = {
    t: (key: string) => key,
  };
  return component;
}

/** 绕开未挂载组件的 setState no-op，直接驱动选择态并触发上报。 */
function applySelection(component: MemberRemovalList, uids: string[]) {
  (component as any).state = {
    ...(component as any).state,
    selected: new Map(
      roster
        .filter((subscriber) => uids.includes(subscriber.uid))
        .map((subscriber) => [subscriber.uid, subscriber])
    ),
  };
  (component as any).reportSelection();
}

describe("MemberRemovalList · 多选交互", () => {
  beforeEach(() => {
    runtime.subscriberChangeListener = undefined;
    runtime.unsubscribe.mockReset();
  });

  // §3.3：两组并存时「我的 BOT」默认**收起**、「其他成员」默认展开，
  // 所以首帧只渲染得出「其他成员」那一行。
  it("首帧按 §3.3 的默认展开态渲染（我的 BOT 收起）", () => {
    const content = render(createComponent());
    const checks = collectByTestId(content, "member-removal-check");
    const rows = collectByTestId(content, "member-removal-row");
    expect(checks).toHaveLength(1);
    expect(rows[0].props?.["aria-label"]).toBe("human");
    expect(rows[0].props?.role).toBe("checkbox");
    expect(rows[0].props?.["aria-checked"]).toBe(false);
    expect(rows[0].props?.tabIndex).toBe(0);

    // 两组的标题都要在（空组才不渲染，收起组仍要显示标题）。
    expect(
      collectByTestId(content, "member-removal-group-myBots")
    ).toHaveLength(1);
    expect(
      collectByTestId(content, "member-removal-group-others")
    ).toHaveLength(1);
  });

  it("服务端首屏返回前使用已知成员，不显示假空态", () => {
    const component = new MemberRemovalList({
      channel: { channelID: "g1" } as never,
      initialSubscribers: roster,
      viewerUid: "owner",
      viewerRole: GroupRole.owner,
    });
    (component as unknown as { context: unknown }).context = {
      t: (key: string) => key,
    };

    const content = render(component, [], { firstLoadSettled: false });
    expect(collectByTestId(content, "member-removal-row")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("没有首屏缓存时先显示加载状态", () => {
    const content = render(createComponent(), [], {
      firstLoadSettled: false,
    });

    expect(collectByTestId(content, "member-removal-loading")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("加载失败时显示重试入口", () => {
    const retry = vi.fn();
    const content = render(createComponent(), [], {
      firstLoadSettled: true,
      loadError: true,
      retry,
    });

    expect(collectByTestId(content, "member-removal-error")).toHaveLength(1);
    const [button] = collectByTestId(content, "member-removal-retry");
    (button.props?.onClick as () => void)();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("已有成员时加载失败也显示重试，并在恢复后重新显示继续加载", () => {
    const retry = vi.fn();
    const component = createComponent();
    const failed = render(component, roster, {
      firstLoadSettled: true,
      loadError: true,
      hasMore: true,
      retry,
    });

    expect(collectByTestId(failed, "member-removal-row")).not.toHaveLength(0);
    expect(collectByTestId(failed, "member-removal-error")).toHaveLength(1);
    expect(collectByTestId(failed, "member-removal-load-more")).toHaveLength(0);
    const [retryButton] = collectByTestId(failed, "member-removal-retry");
    (retryButton.props?.onClick as () => void)();
    expect(retry).toHaveBeenCalledOnce();

    const healed = render(component, roster, {
      firstLoadSettled: true,
      loadError: false,
      hasMore: true,
    });
    expect(collectByTestId(healed, "member-removal-error")).toHaveLength(0);
    expect(collectByTestId(healed, "member-removal-load-more")).toHaveLength(1);
  });

  it("首个服务端结果到达后不再重新混入初始快照", () => {
    const component = new MemberRemovalList({
      channel: new Channel("g1", 2),
      initialSubscribers: roster,
      viewerUid: "owner",
      viewerRole: GroupRole.owner,
    });
    (component as unknown as { context: unknown }).context = {
      t: (key: string) => key,
    };

    const firstPaint = render(component, [], { firstLoadSettled: false });
    expect(collectByTestId(firstPaint, "member-removal-row")).toHaveLength(1);

    (component as any).onSubscribersLoaded([]);
    const afterSearchClear = render(component, [], {
      firstLoadSettled: false,
    });
    expect(
      collectByTestId(afterSearchClear, "member-removal-row")
    ).toHaveLength(0);
    expect(
      collectByTestId(afterSearchClear, "member-removal-loading")
    ).toHaveLength(1);
  });

  it("仅在加载完成且没有后续页时显示确定性空态", () => {
    const content = render(createComponent(), [], {
      firstLoadSettled: true,
      hasMore: false,
    });

    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(1);
  });

  it("滚动接近底部时继续加载成员", () => {
    const component = createComponent();
    const tree = component.render() as AnyElement;
    const renderProp = tree.props?.render as (vm: unknown) => AnyElement;
    const loadMoreSubscribersIfNeed = vi.fn();
    const content = renderProp({
      subscribers: roster,
      search: vi.fn(),
      loadMoreSubscribersIfNeed,
      firstLoadSettled: true,
      loadError: false,
      autoPaging: false,
      hasMore: false,
    });

    (content.props?.onScroll as (event: unknown) => void)({
      target: { scrollTop: 700, clientHeight: 300, scrollHeight: 1100 },
    });

    expect(loadMoreSubscribersIfNeed).toHaveBeenCalledTimes(1);
  });

  it("未扫完分页时不显示确定性空态，并提供继续加载", () => {
    const loadMoreSubscribersIfNeed = vi.fn();
    const content = render(createComponent(), [], {
      firstLoadSettled: true,
      hasMore: true,
      autoPageLimitReached: true,
      loadMoreSubscribersIfNeed,
    });

    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
    const buttons = collectByTestId(content, "member-removal-load-more");
    expect(buttons).toHaveLength(1);
    (buttons[0].props?.onClick as () => void)();
    expect(loadMoreSubscribersIfNeed).toHaveBeenCalledOnce();
  });

  it("已有成员但仍有下一页时也提供继续加载", () => {
    const loadMoreSubscribersIfNeed = vi.fn();
    const content = render(createComponent(), roster, {
      firstLoadSettled: true,
      hasMore: true,
      autoPageLimitReached: true,
      loadMoreSubscribersIfNeed,
    });

    const buttons = collectByTestId(content, "member-removal-load-more");
    expect(buttons).toHaveLength(1);
    (buttons[0].props?.onClick as () => void)();
    expect(loadMoreSubscribersIfNeed).toHaveBeenCalledOnce();
  });

  it("搜索无结果时显示搜索范围空态", () => {
    const component = createComponent();
    (component as any).state = {
      ...(component as any).state,
      keyword: "missing",
    };

    const content = render(component, [], {
      firstLoadSettled: true,
      hasMore: false,
    });

    expect(
      collectByTestId(content, "member-removal-search-empty")
    ).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("搜索期间不允许折叠并保留原来的展开偏好", () => {
    const component = createComponent();
    (component as any).state = {
      ...(component as any).state,
      keyword: "bot",
      manualExpanded: { myBots: false, others: true },
    };

    const content = render(component);
    expect(
      collectByTestId(content, "member-removal-chevron-myBots")
    ).toHaveLength(0);
    expect((component as any).state.manualExpanded).toEqual({
      myBots: false,
      others: true,
    });
  });

  it("成员变化后刷新真实 VM，并移除已离群成员的选中态", async () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    const syncSetState = (update: any, callback?: () => void) => {
      const next =
        typeof update === "function"
          ? update((component as any).state)
          : update;
      (component as any).state = { ...(component as any).state, ...next };
      callback?.();
    };
    (component as any).setState = syncSetState;

    const tree = component.render() as AnyElement;
    const create = tree.props?.create as () => any;
    const vm = create();
    expect(vm).toBeInstanceOf(SubscriberListVM);
    vm.subscribers = [roster[2]];
    applySelection(component, ["human"]);
    vi.spyOn(vm, "refreshCurrentSearch").mockImplementation(async () => {
      vm.subscribers = [];
      vm.onSubscribersLoaded?.([]);
    });

    component.componentDidMount();
    runtime.subscriberChangeListener?.(new Channel("g1", 2));
    await vi.waitFor(() =>
      expect(vm.refreshCurrentSearch).toHaveBeenCalledOnce()
    );

    expect(Array.from((component as any).state.selected.keys())).toEqual([]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    component.componentWillUnmount();
    expect(runtime.unsubscribe).toHaveBeenCalledOnce();
  });

  it("Provider 创建真实 VM，搜索输入会调用它的 search", () => {
    vi.useFakeTimers();
    try {
      const component = createComponent();
      const tree = component.render() as AnyElement;
      const create = tree.props?.create as () => SubscriberListVM;
      const renderProp = tree.props?.render as (
        vm: SubscriberListVM
      ) => unknown;
      const vm = create();
      const search = vi.spyOn(vm, "search").mockImplementation(() => {});
      const content = renderProp(vm);
      const [input] = collectByTestId(content, "member-removal-search");

      (input.props?.onChange as (event: unknown) => void)({
        target: { value: "alice" },
      });
      vi.advanceTimersByTime(300);

      expect(search).toHaveBeenCalledWith("alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("展开「我的 BOT」后两组的行都可勾选", () => {
    const component = createComponent();
    // 模拟用户点开「我的 BOT」分类。
    (component as any).state = {
      ...(component as any).state,
      manualExpanded: { myBots: true, others: true },
    };
    const rows = collectByTestId(render(component), "member-removal-row");
    expect(rows.map((row) => row.props?.["aria-label"]).sort()).toEqual([
      "bot-mine",
      "human",
    ]);
  });

  it("勾选跨分组累加，并上报完整 Subscriber 给父级", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    // 先渲染一次：reportSelection 要从“最近一次可见集合”里反查完整对象。
    (component as any).state = {
      ...(component as any).state,
      manualExpanded: { myBots: true, others: true },
    };
    render(component);

    applySelection(component, ["bot-mine"]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ uid: "bot-mine" }),
    ]);

    // 再勾「其他成员」组里的人类 —— 两组的选中项必须共存，而不是互相替换。
    applySelection(component, ["bot-mine", "human"]);
    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Subscriber[];
    expect(last.map((s) => s.uid).sort()).toEqual(["bot-mine", "human"]);
  });

  it("取消全部选中时上报空数组（父级据此置灰「确认」）", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    render(component);

    applySelection(component, ["human"]);
    applySelection(component, []);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("选中后该行的 aria-checked 变为 true", () => {
    const component = createComponent();
    applySelection(component, ["human"]);

    const rows = collectByTestId(render(component), "member-removal-row");
    const checked = rows
      .filter((c) => c.props?.["aria-checked"] === true)
      .map((c) => c.props?.["aria-label"]);
    expect(checked).toEqual(["human"]);
  });

  it("toggleSelected 连点两次回到未选中", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    render(component);

    // 直接驱动真实的 toggle 逻辑（而不是替身），验证它的增/删对称性。
    const toggled = new Map<string, Subscriber>();
    const fakeSetState = (updater: any, cb?: () => void) => {
      const next = updater({ selected: toggled });
      toggled.clear();
      for (const [uid, subscriber] of next.selected) {
        toggled.set(uid, subscriber);
      }
      (component as any).state = {
        ...(component as any).state,
        selected: toggled,
      };
      cb?.();
    };
    (component as any).setState = fakeSetState;

    (component as any).toggleSelected(roster[2]); // human
    expect(Array.from(toggled.keys())).toEqual(["human"]);
    (component as any).toggleSelected(roster[2]);
    expect(Array.from(toggled.keys())).toEqual([]);
  });
});
