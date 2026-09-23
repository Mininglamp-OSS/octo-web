import React from "react";
import { Subscriber } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

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
  sub("bot-mine", GroupRole.normal, {
    robot: 1,
    bot_owned_by_me: true,
    bot_created_by_me: true,
  }),
  sub("human", GroupRole.normal),
];

/**
 * 渲染一次并返回组件 + 元素树。
 *
 * 组件未挂载，所以 setState 是 no-op —— 要改状态得直接赋值给 this.state
 * （见 applySelection）。这是测试替身的常见做法：本组测的是选择逻辑与渲染
 * 映射，不是 React 的调度行为。
 */
function render(component: MemberRemovalList, rosterOverride?: Subscriber[]) {
  const tree = component.render() as AnyElement;
  const renderProp = tree.props?.render as (vm: unknown) => unknown;
  return renderProp({
    subscribers: rosterOverride ?? roster,
    search: vi.fn(),
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

/** 绕开未挂载组件的 setState no-op，直接驱动选择态并触发上报。 */
function applySelection(component: MemberRemovalList, uids: string[]) {
  (component as any).state = {
    ...(component as any).state,
    selectedUids: new Set(uids),
  };
  (component as any).reportSelection();
}

describe("MemberRemovalList · 多选交互", () => {
  // §3.3：两组并存时「我的 BOT」默认**收起**、「其他成员」默认展开，
  // 所以首帧只渲染得出「其他成员」那一行。
  it("首帧按 §3.3 的默认展开态渲染（我的 BOT 收起）", () => {
    const content = render(createComponent());
    const checks = collectByTestId(content, "member-removal-check");
    expect(checks).toHaveLength(1);
    expect(checks[0].props?.["aria-label"]).toBe("human");
    expect(checks[0].props?.role).toBe("checkbox");
    expect(checks[0].props?.["aria-checked"]).toBe(false);

    // 两组的标题都要在（空组才不渲染，收起组仍要显示标题）。
    expect(collectByTestId(content, "member-removal-group-myBots")).toHaveLength(1);
    expect(collectByTestId(content, "member-removal-group-others")).toHaveLength(1);
  });

  it("展开「我的 BOT」后两组的行都可勾选", () => {
    const component = createComponent();
    // 模拟用户点开「我的 BOT」分类。
    (component as any).state = {
      ...(component as any).state,
      manualExpanded: { myBots: true, others: true },
    };
    const checks = collectByTestId(render(component), "member-removal-check");
    expect(checks.map((c) => c.props?.["aria-label"]).sort()).toEqual([
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

    const checks = collectByTestId(render(component), "member-removal-check");
    const checked = checks
      .filter((c) => c.props?.["aria-checked"] === true)
      .map((c) => c.props?.["aria-label"]);
    expect(checked).toEqual(["human"]);
  });

  it("toggleSelected 连点两次回到未选中", () => {
    const onSelectionChange = vi.fn();
    const component = createComponent(onSelectionChange);
    render(component);

    // 直接驱动真实的 toggle 逻辑（而不是替身），验证它的增/删对称性。
    const toggled = new Set<string>();
    const fakeSetState = (updater: any, cb?: () => void) => {
      const next = updater({ selectedUids: toggled });
      toggled.clear();
      for (const uid of next.selectedUids) toggled.add(uid);
      (component as any).state = {
        ...(component as any).state,
        selectedUids: toggled,
      };
      cb?.();
    };
    (component as any).setState = fakeSetState;

    (component as any).toggleSelected(roster[2]); // human
    expect(Array.from(toggled)).toEqual(["human"]);
    (component as any).toggleSelected(roster[2]);
    expect(Array.from(toggled)).toEqual([]);
  });
});

describe("MemberRemovalList · 置灰行（我建的管理员 bot，需求1）", () => {
  // 置灰只发生在查看者移不动该 bot 时。关键：**管理员**移不动另一个管理员 bot
  // （后端 ErrGroupCannotRemoveAdmin），但它是他建的 → owned=false + created=true
  // → 落进「我的 BOT」组但置灰。（群主反而能移管理员 bot，那是可选的。）
  const rosterWithDisabled = [
    sub("bot-admin-mine", GroupRole.manager, {
      robot: 1,
      bot_owned_by_me: false,
      bot_created_by_me: true,
    }),
    sub("bot-mine", GroupRole.normal, {
      robot: 1,
      bot_owned_by_me: true,
      bot_created_by_me: true,
    }),
  ];

  // 查看者是**管理员**：对管理员 bot canRemove=false → 置灰。
  function createManagerComponent(
    onSelectionChange?: (items: Subscriber[]) => void
  ) {
    const component = new MemberRemovalList({
      channel: { channelID: "g1" } as never,
      viewerUid: "mgr",
      viewerRole: GroupRole.manager,
      onSelectionChange,
    });
    (component as unknown as { context: unknown }).context = {
      t: (key: string) => key,
    };
    return component;
  }

  function expandBothGroups(component: MemberRemovalList) {
    (component as any).state = {
      ...(component as any).state,
      manualExpanded: { myBots: true, others: true },
    };
  }

  it("我建的管理员 bot 在「我的 BOT」里可见，但圆点置灰不可选", () => {
    const component = createManagerComponent();
    expandBothGroups(component);
    const content = render(component, rosterWithDisabled as never);
    const checks = collectByTestId(content, "member-removal-check");
    const byLabel = Object.fromEntries(
      checks.map((c) => [c.props?.["aria-label"], c])
    );
    // 两行都在（都是我的 bot）。
    expect(Object.keys(byLabel).sort()).toEqual(["bot-admin-mine", "bot-mine"]);
    // 管理员 bot 的圆点 aria-disabled；普通 bot 可选。
    expect(byLabel["bot-admin-mine"].props?.["aria-disabled"]).toBe(true);
    expect(byLabel["bot-mine"].props?.["aria-disabled"]).toBeUndefined();
  });

  it("置灰行点击不改变选中态，也不上报", () => {
    const onSelectionChange = vi.fn();
    const component = createManagerComponent(onSelectionChange);
    expandBothGroups(component);
    render(component, rosterWithDisabled as never);

    const toggled = new Set<string>();
    (component as any).setState = (updater: any, cb?: () => void) => {
      const next = updater({ selectedUids: toggled });
      toggled.clear();
      for (const uid of next.selectedUids) toggled.add(uid);
      cb?.();
    };
    // 点置灰的管理员 bot：应被拦下，选中集不变。
    (component as any).toggleSelected(rosterWithDisabled[0]);
    expect(Array.from(toggled)).toEqual([]);
    // 点可选的普通 bot：正常选中。
    (component as any).toggleSelected(rosterWithDisabled[1]);
    expect(Array.from(toggled)).toEqual(["bot-mine"]);
  });

  it("reportSelection 不会把置灰行上报给父级", () => {
    const onSelectionChange = vi.fn();
    const component = createManagerComponent(onSelectionChange);
    expandBothGroups(component);
    render(component, rosterWithDisabled as never);
    // 即使 selectedUids 里残留了置灰行的 uid（比如旧状态），也不该上报。
    (component as any).state = {
      ...(component as any).state,
      selectedUids: new Set(["bot-admin-mine", "bot-mine"]),
    };
    (component as any).reportSelection();
    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Subscriber[];
    expect(last.map((s) => s.uid)).toEqual(["bot-mine"]);
  });
});
