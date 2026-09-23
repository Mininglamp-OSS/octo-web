import { describe, expect, it, vi } from "vitest";

// 「查看全部」是**纯浏览**路径：它不得下发任何移除能力。
//
// 这个文件原本钉的是相反的契约——当时「查看全部」透传 removeAction，理由是
// 「19 人以下的小群里普通成员没有别的入口」（vm.showRemove() 那时只对群主/管理员
// 返回 true）。现在减号入口本身已经覆盖了「拥有可移除 bot 的普通成员」，兜底不再
// 需要；继续透传只会把管理语义混进浏览场景，与「+ / - 完全解耦」的目标相反。
//
// 保留这个文件而不是删掉，是因为它当初的存在理由现在反过来同样成立：评审做过
// 变异测试，证明**光看 section.rows[0].properties 是测不到这一跳的**——那里少一个
// 字段和真正 render 时少传一个 prop 是两回事。所以这里依旧走到 render + 点击
// 「查看全部」，只是断言方向反过来：pushed 视图上不能出现 removeAction。
//
// 实现上不走 DOM：Subscribers.render() 返回的是普通 React 元素对象，
// 直接遍历树、取到「查看全部」节点的 onClick 调用即可，既不用挂载也不用
// 处理组件里的 require(png) 资源。

vi.mock("../../../App", () => ({
  default: {
    loginInfo: { uid: "me" },
    endpoints: { organizationalTool: (_channel: unknown, node: unknown) => node },
    shared: { baseContext: { showUserInfo: vi.fn() } },
  },
}));

vi.mock("../../../features/channelSetting/channelSettingMemberSearch", () => ({
  createChannelSettingMemberSearch: () => () => [],
}));

import { Subscribers } from "../index";

type AnyElement = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

/** 深度优先找到第一个 className 命中的元素。 */
function findByClassName(node: unknown, className: string): AnyElement | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByClassName(child, className);
      if (hit) return hit;
    }
    return undefined;
  }
  const el = node as AnyElement;
  if (el.props?.className === className) return el;
  return findByClassName(el.props?.children, className);
}

describe("Subscribers · 查看全部路径", () => {
  const buildStubVM = (subscriberCount: number) => ({
    // 只实现 render 用到的表面。
    subscribers: Array.from({ length: subscriberCount }, (_, i) => ({
      uid: `u${i}`,
      role: 0,
    })),
    subscribersTop: [],
    showAdd: () => true,
    showRemove: () => false, // 普通成员：没有专用的移除入口图标
    hasMoreSubscribers: () => true,
    memberCount: () => subscriberCount,
  });

  const renderAndClickViewAll = () => {
    const context = { push: vi.fn(), routeData: () => ({}) };
    const props = {
      context: context as never,
      channel: { getChannelKey: () => "g1" } as never,
    };
    const component = new Subscribers(props);
    // i18n 在 render 里通过 this.context 取，塞一个恒等 t 即可。
    (component as unknown as { context: unknown }).context = {
      t: (key: string) => key,
    };

    const tree = component.render() as AnyElement;
    // 外层是 Provider，真正的内容由它的 render prop 产出。
    const renderProp = tree.props?.render as (vm: unknown) => unknown;
    expect(typeof renderProp).toBe("function");
    const content = renderProp(buildStubVM(25));

    const viewAll = findByClassName(content, "wk-subscribers-more");
    expect(viewAll, "应渲染出「查看全部」入口").toBeTruthy();
    (viewAll?.props?.onClick as () => void)();

    expect(context.push).toHaveBeenCalledTimes(1);
    return context.push.mock.calls[0][0] as AnyElement;
  };

  it("不把任何移除能力带进「查看全部」打开的成员列表", () => {
    const pushed = renderAndClickViewAll();
    expect(
      pushed.props?.removeAction,
      "「查看全部」是纯浏览入口；移除只走「移出成员」独立页（减号图标）"
    ).toBeUndefined();
  });

  it("仍然正常打开成员列表并带上本地搜索", () => {
    // 解耦不等于把这条路径弄坏：列表本身、以及它的拼音本地搜索都要照常工作。
    const pushed = renderAndClickViewAll();
    expect(pushed.props?.channel).toBeTruthy();
    expect(typeof pushed.props?.localSearch).toBe("function");
  });
});
