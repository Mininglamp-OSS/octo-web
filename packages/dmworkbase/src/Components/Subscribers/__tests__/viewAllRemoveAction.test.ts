import { describe, expect, it, vi } from "vitest";

// 这条测试专门钉住 Subscribers/index.tsx 里「查看全部」路径对 removeAction 的透传
// （octo-web#1511）。
//
// 为什么单独立一个文件：评审做过变异测试——把 `removeAction={removeAction}` 从
// 那一行删掉，既有的 65 个测试全绿。原来那条名为「exposes removeAction to the
// view-all path too」的用例只断言了 section.rows[0].properties.removeAction 存在，
// 距离真正消费它的那次 render 还差一跳。普通成员唯一能到达移除按钮的路径就是
// 「查看全部」，所以这一跳断了，功能对他们就是不可达的。
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

  const renderAndClickViewAll = (removeAction?: unknown) => {
    const context = { push: vi.fn(), routeData: () => ({}) };
    const props = {
      context: context as never,
      channel: { getChannelKey: () => "g1" } as never,
      removeAction: removeAction as never,
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

  it("把 removeAction 透传给「查看全部」打开的成员列表", () => {
    // 这就是变异测试证明未被覆盖的那一行。
    const removeAction = { canRemove: vi.fn(), onRemove: vi.fn() };
    const pushed = renderAndClickViewAll(removeAction);
    expect(
      pushed.props?.removeAction,
      "「查看全部」必须把 removeAction 带给 SubscriberList —— 这是普通成员唯一的移除入口"
    ).toBe(removeAction);
  });

  it("没有 removeAction 时保持原样，不会凭空造一个", () => {
    const pushed = renderAndClickViewAll(undefined);
    expect(pushed.props?.removeAction).toBeUndefined();
  });
});
