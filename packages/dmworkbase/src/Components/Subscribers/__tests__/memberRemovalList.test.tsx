import React from "react";
import { Subscriber } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

// 「移出成员」页的**交互模型**测试：多选 + 上报选择 + 分页。
//
// 纯函数层（分类/展开推导）已由 memberRemovalGrouping.test.ts 覆盖，这里只钉
// 组件自己的那部分行为，也就是最容易在重构中悄悄丢掉的几件事：
//
//   1. 勾选是**多选且跨分组**的 —— 管理员要能一次勾「我的 BOT」里的和
//      「其他成员」里的，一并提交。做成单选或按组互斥都会让批量能力失效。
//   2. 每次勾选变化都要 onSelectionChange 上报**完整 Subscriber**（不是 uid）——
//      父级要用名字拼二次确认文案，也靠它 enable/disable 路由表头的「确认」。
//   3. 选中项**跨搜索/分页存活**：VM 结果集被换掉时不能把之前的选择静默丢掉。
//   4. 滚到底要**继续翻页**：VM 每页只有 50 人，不翻页则大群里的人永远不可达。
//
// 不走 DOM 挂载：组件 render() 返回的是普通 React 元素对象，遍历树取到行节点的
// onClick 调用即可。这样既不用处理 Provider 的数据加载时序，也不用 mock 掉
// WKAvatar 等一堆渲染期依赖。

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
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
import { GroupRole } from "../../../Service/Const";

type AnyElement = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

/** 深度优先收集所有 data-testid 命中的元素。 */
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

/** 群主视角：两组都非空（我的 bot + 其他成员）。 */
const roster = [
  sub("owner", GroupRole.owner), // 自己，canRemove 恒 false
  sub("bot-mine", GroupRole.normal, { robot: 1, bot_owned_by_me: true }),
  sub("human", GroupRole.normal),
];

/**
 * 渲染一次并返回元素树。`rosterOverride` 用来模拟 VM 结果集被搜索/分页换掉。
 *
 * 组件未挂载，所以 setState 是 no-op —— 要驱动真实 toggle 逻辑得注入 setState
 * 替身（见 driveSetState）。本组测的是选择逻辑与渲染映射，不是 React 的调度行为。
 */
function render(
  component: MemberRemovalList,
  rosterOverride?: Subscriber[],
  vmExtra?: Record<string, unknown>
) {
  const tree = component.render() as AnyElement;
  const renderProp = tree.props?.render as (vm: unknown) => unknown;
  return renderProp({
    subscribers: rosterOverride ?? roster,
    search: vi.fn(),
    ...vmExtra,
  });
}

function createComponent(onSelectionChange?: (items: Subscriber[]) => void) {
  const component = new MemberRemovalList({
    channel: { channelID: "g1" } as never,
    viewerUid: "owner",
    viewerRole: GroupRole.owner,
    onSelectionChange,
  });
  (component as unknown as { context: unknown }).context = {
    t: (key: string) => key,
  };
  return component;
}

/**
 * 注入一个真正会写回 this.state 的 setState 替身，让 toggleSelected 的
 * Map 增删逻辑与 reportSelection 回调都按真实路径跑一遍。
 */
function driveSetState(component: MemberRemovalList) {
  (component as any).setState = (updater: any, cb?: () => void) => {
    const next =
      typeof updater === "function" ? updater((component as any).state) : updater;
    (component as any).state = { ...(component as any).state, ...next };
    cb?.();
  };
}

/** 展开两组，避免默认收起的「我的 BOT」让行渲染不出来。 */
function expandBothGroups(component: MemberRemovalList) {
  (component as any).state = {
    ...(component as any).state,
    manualExpanded: { myBots: true, others: true },
  };
}

describe("MemberRemovalList · 多选交互", () => {
  // §3.3：两组并存时「我的 BOT」默认**收起**、「其他成员」默认展开，
  // 所以首帧只渲染得出「其他成员」那一行。
  it("首帧按 §3.3 的默认展开态渲染（我的 BOT 收起）", () => {
    const content = render(createComponent());
    const rows = collectByTestId(content, "member-removal-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].props?.["aria-label"]).toBe("human");
    expect(rows[0].props?.role).toBe("checkbox");
    expect(rows[0].props?.["aria-checked"]).toBe(false);

    // 两组的标题都要在（空组才不渲染，收起组仍要显示标题）。
    expect(collectByTestId(content, "member-removal-group-myBots")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-group-others")).toHaveLength(1);
  });

  it("展开「我的 BOT」后两组的行都可勾选", () => {
    const component = createComponent();
    expandBothGroups(component);
    const rows = collectByTestId(render(component), "member-removal-row");
    expect(rows.map((r) => r.props?.["aria-label"]).sort()).toEqual([
      "bot-mine",
      "human",
    ]);
  });

  it("勾选跨分组累加，并上报完整 Subscriber 给父级", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    expandBothGroups(component);
    driveSetState(component);
    render(component);

    (component as any).toggleSelected(roster[1]); // bot-mine
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ uid: "bot-mine" }),
    ]);

    // 再勾「其他成员」组里的人类 —— 两组的选中项必须共存，而不是互相替换。
    (component as any).toggleSelected(roster[2]); // human
    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Subscriber[];
    expect(last.map((s) => s.uid).sort()).toEqual(["bot-mine", "human"]);
  });

  it("取消全部选中时上报空数组（父级据此置灰「确认」）", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    driveSetState(component);
    render(component);

    (component as any).toggleSelected(roster[2]);
    (component as any).toggleSelected(roster[2]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("选中后该行的 aria-checked 变为 true", () => {
    const component = createComponent();
    driveSetState(component);
    render(component);
    (component as any).toggleSelected(roster[2]); // human

    const rows = collectByTestId(render(component), "member-removal-row");
    const checked = rows
      .filter((r) => r.props?.["aria-checked"] === true)
      .map((r) => r.props?.["aria-label"]);
    expect(checked).toEqual(["human"]);
  });

  it("toggleSelected 连点两次回到未选中", () => {
    const component = createComponent();
    driveSetState(component);
    render(component);

    (component as any).toggleSelected(roster[2]); // human
    expect(Array.from((component as any).state.selected.keys())).toEqual([
      "human",
    ]);
    (component as any).toggleSelected(roster[2]);
    expect(Array.from((component as any).state.selected.keys())).toEqual([]);
  });

  // 行本身就是那个 checkbox 控件：键盘用户必须能用 Enter/Space 选人。
  // 早先把 role/aria 挂在里面那个纯装饰的圆圈上、且没有 tabIndex，
  // 导致键盘根本选不了人。
  it("行可聚焦且响应 Enter/Space（键盘可操作）", () => {
    const component = createComponent();
    driveSetState(component);
    const rows = collectByTestId(render(component), "member-removal-row");
    const row = rows[0];
    expect(row.props?.tabIndex).toBe(0);

    const preventDefault = vi.fn();
    (row.props?.onKeyDown as any)({ key: "Enter", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(Array.from((component as any).state.selected.keys())).toEqual([
      "human",
    ]);

    // 非确认键不应改变选中态。
    (row.props?.onKeyDown as any)({ key: "a", preventDefault: vi.fn() });
    expect(Array.from((component as any).state.selected.keys())).toEqual([
      "human",
    ]);
  });
});

describe("MemberRemovalList · 选中项跨结果集存活（回归 P1-2）", () => {
  // 回归：选中态曾经存 uid 集合，上报时从「本次渲染出的可见集合」反查对象。
  // 于是「勾 A → 搜索换结果集 → 勾 B」会把 A 静默丢掉：父级只收到 [B]，
  // 但 A 的行若回到结果集里仍显示勾选 —— UI 与提交内容不一致且无任何提示。
  it("先勾选、再搜索换掉结果集，之前的选择不丢", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    expandBothGroups(component);
    driveSetState(component);

    const alice = sub("alice", GroupRole.normal);
    const bob = sub("bob", GroupRole.normal);

    // 第一批结果集里勾 alice。
    render(component, [alice, bob]);
    (component as any).toggleSelected(alice);
    expect(
      (onSelectionChange.mock.calls.at(-1)?.[0] as Subscriber[]).map((s) => s.uid)
    ).toEqual(["alice"]);

    // 搜索把结果集换成只剩 bob（alice 已不在可见集合里），再勾 bob。
    render(component, [bob]);
    (component as any).toggleSelected(bob);

    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Subscriber[];
    // alice 必须还在：她是用户显式勾选的，搜索不该悄悄取消她。
    expect(last.map((s) => s.uid).sort()).toEqual(["alice", "bob"]);
    // 且上报的是完整对象（父级要用 name 拼确认文案）。
    expect(last.every((s) => typeof s.name === "string")).toBe(true);
  });

  it("结果集之外的选中项也能被取消（Map 里按 uid 删）", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    driveSetState(component);
    const alice = sub("alice", GroupRole.normal);

    render(component, [alice]);
    (component as any).toggleSelected(alice);
    (component as any).toggleSelected(alice);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });
});

describe("MemberRemovalList · 滚动分页（回归 P1-1）", () => {
  // 回归：本页曾经没有 onScroll，而 SubscriberListVM 每页只有 50 人、
  // 后续页只能由 loadMoreSubscribersIfNeed 拉取。结果是大群里第 50 名之后的人
  // 永远不可达 —— 减号入口（按全量本地名册判定）亮着，页面却渲染空态。
  it("滚动到底部触发 loadMoreSubscribersIfNeed", () => {
    const component = createComponent();
    const loadMore = vi.fn();
    const content = render(component, undefined, {
      loadMoreSubscribersIfNeed: loadMore,
    }) as AnyElement;

    const onScroll = content.props?.onScroll as any;
    expect(typeof onScroll).toBe("function");

    // 已到底部（含 200px 预取余量）→ 应翻页。
    onScroll({
      target: { scrollTop: 900, clientHeight: 300, scrollHeight: 1200 },
    });
    expect(loadMore).toHaveBeenCalled();
  });

  it("距底部很远时不翻页（避免每次滚动都打请求）", () => {
    const component = createComponent();
    const loadMore = vi.fn();
    const content = render(component, undefined, {
      loadMoreSubscribersIfNeed: loadMore,
    }) as AnyElement;

    (content.props?.onScroll as any)({
      target: { scrollTop: 0, clientHeight: 300, scrollHeight: 5000 },
    });
    expect(loadMore).not.toHaveBeenCalled();
  });
});
