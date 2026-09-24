import { describe, expect, it, vi } from "vitest";

// 「查看全部」保留普通成员移除自己 Bot 的兜底能力，避免 Bot 不在本地缓存时
// 减号入口不亮后完全无路可达。

vi.mock("../../../App", () => ({
  default: {
    loginInfo: { uid: "me" },
    endpoints: {
      organizationalTool: (_channel: unknown, node: unknown) => node,
    },
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
function findByClassName(
  node: unknown,
  className: string
): AnyElement | undefined {
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
      removeAction: {
        canRemove: vi.fn(() => true),
        onRemove: vi.fn(async () => undefined),
      },
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

  it("把普通成员的自有 Bot 移除兜底带进查看全部列表", () => {
    const pushed = renderAndClickViewAll();
    expect(pushed.props?.removeAction).toBeTruthy();
    expect(typeof pushed.props?.removeAction.canRemove).toBe("function");
    expect(typeof pushed.props?.removeAction.onRemove).toBe("function");
  });

  it("仍然正常打开成员列表并带上本地搜索", () => {
    // 解耦不等于把这条路径弄坏：列表本身、以及它的拼音本地搜索都要照常工作。
    const pushed = renderAndClickViewAll();
    expect(pushed.props?.channel).toBeTruthy();
    expect(typeof pushed.props?.localSearch).toBe("function");
  });
});
