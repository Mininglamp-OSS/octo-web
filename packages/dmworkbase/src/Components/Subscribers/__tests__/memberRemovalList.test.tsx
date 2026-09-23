import React from "react";
import { Subscriber } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

// 「移出成员」页的**组件行为**测试：多选、上报选择、空态语义、名册可达性。
//
// 纯函数层（分类/截断/展开推导）由 memberRemovalGrouping.test.ts 覆盖，这里只钉
// 组件自己那部分，也就是最容易在重构中悄悄坏掉的几件事：
//
//   1. 勾选是**多选且跨分组**的 —— 管理员要能一次勾「我的 BOT」和「其他成员」里的，
//      一并提交。做成单选或按组互斥都会让批量能力失效。
//   2. 每次勾选变化都要 onSelectionChange 上报**完整 Subscriber**（不是 uid）——
//      父级要用名字拼二次确认文案，也靠它 enable/disable 路由表头的「确认」。
//   3. 选中项**跨搜索存活**：结果集被换掉时不能把之前的选择静默丢掉。
//   4. 名册里**任意位置**的成员都可达（不再有分页，第 60 位和第 1 位一样能出现）。
//   5. 空态必须分清「还在加载」「搜索无匹配」「真的没有」——对前两种说
//      「你没有可移出的成员」是在给用户一句确定的假话。
//
// 不走 DOM 挂载：组件 render() 返回的是普通 React 元素对象，遍历树取到行节点的
// onClick 调用即可。这样既不用处理数据加载时序，也不用 mock 掉 WKAvatar 等一堆
// 渲染期依赖。

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: () => undefined,
  fetchCurrentImChannelInfo: () => Promise.resolve(undefined),
  addCurrentImChannelInfoListener: () => () => {},
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

const ownedBot = (uid: string) =>
  sub(uid, GroupRole.normal, { robot: 1, bot_owned_by_me: true });

/** 群主视角：两组都非空（我的 bot + 其他成员）。 */
const roster = [
  sub("owner", GroupRole.owner), // 自己，canRemove 恒 false
  ownedBot("bot-mine"),
  sub("human", GroupRole.normal),
];

function createComponent(
  props: Partial<{
    subscribers: Subscriber[];
    loading: boolean;
    onSelectionChange: (items: Subscriber[]) => void;
    localSearch: (keyword: string) => Subscriber[];
  }> = {}
) {
  const component = new MemberRemovalList({
    channel: { channelID: "g1" } as never,
    subscribers: props.subscribers ?? roster,
    loading: props.loading,
    viewerUid: "owner",
    viewerRole: GroupRole.owner,
    onSelectionChange: props.onSelectionChange,
    localSearch: props.localSearch,
  });
  (component as unknown as { context: unknown }).context = {
    t: (key: string, opts?: { values?: Record<string, unknown> }) =>
      opts?.values ? `${key}:${JSON.stringify(opts.values)}` : key,
  };
  return component;
}

/**
 * 注入一个真正会写回 this.state 的 setState 替身，让 toggleSelected 的
 * Map 增删逻辑与 reportSelection 回调都按真实路径跑一遍（组件未挂载时
 * React 的 setState 是 no-op）。
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

const render = (component: MemberRemovalList) => component.render();

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
    const component = createComponent({ onSelectionChange });
    expandBothGroups(component);
    driveSetState(component);

    (component as any).toggleSelected(roster[1]); // bot-mine
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ uid: "bot-mine" }),
    ]);

    // 再勾「其他成员」组里的人类 —— 两组的选中项必须共存，而不是互相替换。
    (component as any).toggleSelected(roster[2]); // human
    const last = onSelectionChange.mock.calls[
      onSelectionChange.mock.calls.length - 1
    ][0] as Subscriber[];
    expect(last.map((s) => s.uid).sort()).toEqual(["bot-mine", "human"]);
  });

  it("取消全部选中时上报空数组（父级据此置灰「确认」）", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent({ onSelectionChange });
    driveSetState(component);

    (component as any).toggleSelected(roster[2]);
    (component as any).toggleSelected(roster[2]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("选中后该行的 aria-checked 变为 true", () => {
    const component = createComponent();
    driveSetState(component);
    (component as any).toggleSelected(roster[2]); // human

    const rows = collectByTestId(render(component), "member-removal-row");
    const checked = rows
      .filter((r) => r.props?.["aria-checked"] === true)
      .map((r) => r.props?.["aria-label"]);
    expect(checked).toEqual(["human"]);
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

  // 回归：分组标题的 onKeyDown 原本无条件 preventDefault，把冒泡上来的
  // Enter/Space 一起吞了，于是里面那个 chevron <button> 用键盘折叠不了。
  it("分组标题不吞掉 chevron 的键盘事件", () => {
    const component = createComponent();
    const header = collectByTestId(
      render(component),
      "member-removal-group-others"
    )[0];

    // 事件源是子元素（chevron）时，标题不应 preventDefault。
    const fromChild = { key: "Enter", preventDefault: vi.fn(), target: {}, currentTarget: {} };
    (header.props?.onKeyDown as any)(fromChild);
    expect(fromChild.preventDefault).not.toHaveBeenCalled();

    // 事件源就是标题本身时，照常处理。
    const node = {};
    const fromSelf = {
      key: "Enter",
      preventDefault: vi.fn(),
      target: node,
      currentTarget: node,
    };
    (header.props?.onKeyDown as any)(fromSelf);
    expect(fromSelf.preventDefault).toHaveBeenCalled();
  });
});

describe("MemberRemovalList · 选中项跨结果集存活", () => {
  // 回归：选中态曾经存 uid 集合，上报时从「本次渲染出的可见集合」反查对象。
  // 于是「勾 A → 搜索换结果集 → 勾 B」会把 A 静默丢掉：父级只收到 [B]，
  // 但 A 的行若回到结果集里仍显示勾选 —— UI 与提交内容不一致且无任何提示。
  it("先勾选、再搜索缩小结果集，之前的选择不丢", () => {
    const onSelectionChange = vi.fn();
    const alice = sub("alice", GroupRole.normal);
    const bob = sub("bob", GroupRole.normal);
    const component = createComponent({
      subscribers: [alice, bob],
      onSelectionChange,
      // 只匹配 bob，模拟搜索把 alice 过滤出可见集合。
      localSearch: () => [bob],
    });
    expandBothGroups(component);
    driveSetState(component);

    (component as any).toggleSelected(alice);
    expect(
      (
        onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0] as Subscriber[]
      ).map((s) => s.uid)
    ).toEqual(["alice"]);

    // 搜索后 alice 不在可见行里，但仍必须留在选中篮子里。
    (component as any).setState({ keyword: "bob" });
    const visibleUids = collectByTestId(
      render(component),
      "member-removal-row"
    ).map((r) => r.props?.["aria-label"]);
    expect(visibleUids).toEqual(["bob"]);

    (component as any).toggleSelected(bob);
    const last = onSelectionChange.mock.calls[
      onSelectionChange.mock.calls.length - 1
    ][0] as Subscriber[];
    // alice 必须还在：她是用户显式勾选的，搜索不该悄悄取消她。
    expect(last.map((s) => s.uid).sort()).toEqual(["alice", "bob"]);
    // 且上报的是完整对象（父级要用 name 拼确认文案）。
    expect(last.every((s) => typeof s.name === "string")).toBe(true);
  });

  // 选中项跨搜索存活是刻意设计，但「已经不在群里的人」不该继续躺在批量里：
  // 整批提交是全成全败的，一个已离开的 uid 能把整次操作拖失败。
  it("名册刷新后，已不在群里的选中项被剔除", () => {
    const onSelectionChange = vi.fn();
    const alice = sub("alice", GroupRole.normal);
    const bob = sub("bob", GroupRole.normal);
    const component = createComponent({
      subscribers: [alice, bob],
      onSelectionChange,
    });
    driveSetState(component);
    (component as any).toggleSelected(alice);
    (component as any).toggleSelected(bob);

    // alice 被别的管理员移走了 → 新名册只剩 bob。
    (component as any).props = { ...(component as any).props, subscribers: [bob] };
    (component as any).componentDidUpdate({ subscribers: [alice, bob] });

    expect(onSelectionChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ uid: "bob" }),
    ]);
  });
});

describe("MemberRemovalList · 名册可达性与截断", () => {
  // 回归：本页曾从 SubscriberListVM 取分页数据（每页 50），而 canRemove 过滤在
  // 加载之后做。普通成员的自有 bot 若排在第 51 位之后，第 1 页会被过滤成 0 行，
  // 页面撑不满容器 → 永不触发 scroll → 永远翻不到下一页；而减号入口读的是完整
  // 名册，于是「入口亮着、页面说没有可移出的成员」。现在页面与入口同源，
  // 名册里任意位置的成员都直接可达。
  it("名册第 60 位的自有 bot 也能渲染出来（不再受分页限制）", () => {
    const filler = Array.from({ length: 59 }, (_, i) =>
      sub(`mgr-${i}`, GroupRole.manager)
    ); // 管理员：普通成员视角下 canRemove=false，会被过滤掉
    const component = createComponent({
      subscribers: [...filler, ownedBot("bot-late")],
    });
    // 普通成员视角：唯一可移除的就是自己的 bot。
    (component as any).props = {
      ...(component as any).props,
      viewerUid: "me",
      viewerRole: GroupRole.normal,
    };
    expandBothGroups(component);

    const rows = collectByTestId(render(component), "member-removal-row");
    expect(rows.map((r) => r.props?.["aria-label"])).toEqual(["bot-late"]);
  });

  // 回归：标题计数原本用 group.subscribers.length，也就是被 200 截断**之后**的
  // 渲染行数，于是 500 人的群会显示成「其他成员（200）」—— 把一个渲染上限
  // 冒充成人口普查。现在计数用截断前的真实人数。
  it("超过渲染上限时，标题显示真实人数而不是上限值", () => {
    const many = Array.from({ length: MAX_OTHERS_GROUP_SIZE + 37 }, (_, i) =>
      sub(`human-${i}`, GroupRole.normal)
    );
    const component = createComponent({ subscribers: many });
    const content = render(component);

    const label = collectByTestId(content, "member-removal-label-others")[0];
    const text = String((label.props?.children as any) ?? "");
    expect(text).toContain(String(MAX_OTHERS_GROUP_SIZE + 37));
    expect(text).not.toContain(`:{"count":${MAX_OTHERS_GROUP_SIZE}}`);

    // 行数仍受上限约束（渲染性能），并给出截断提示。
    expect(collectByTestId(content, "member-removal-row")).toHaveLength(
      MAX_OTHERS_GROUP_SIZE
    );
    expect(
      collectByTestId(content, "member-removal-truncated-hint")
    ).toHaveLength(1);
  });
});

describe("MemberRemovalList · 空态三分", () => {
  // 回归：原本任何 groups.length === 0 都渲染「你在本群没有可移出的成员」。
  // 名册还没到的首帧也照说 —— 给用户一句确定的假话。
  it("名册加载中：说加载，不说「没有可移出的成员」", () => {
    const content = render(
      createComponent({ subscribers: [], loading: true })
    );
    expect(collectByTestId(content, "member-removal-loading")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("搜索无匹配：说没匹配，不说「本群没有可移出的成员」", () => {
    const component = createComponent({ localSearch: () => [] });
    (component as any).state = { ...(component as any).state, keyword: "zzz" };
    const content = render(component);
    expect(collectByTestId(content, "member-removal-no-match")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(0);
  });

  it("名册已到且确实没有可移出的人：才说空", () => {
    const content = render(
      createComponent({
        subscribers: [sub("owner", GroupRole.owner)], // 只有自己，canRemove=false
        loading: false,
      })
    );
    expect(collectByTestId(content, "member-removal-empty")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-loading")).toHaveLength(0);
  });
});
