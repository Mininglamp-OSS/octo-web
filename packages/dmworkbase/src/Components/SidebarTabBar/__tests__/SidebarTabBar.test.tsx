import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let SidebarTabBar: typeof import('../index').default
let container: HTMLDivElement

beforeAll(async () => {
  vi.doMock('../../../i18n', () => ({
    useI18n: () => ({ t: (key: string) => key }),
  }))
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    fillStyle: '',
  })) as any
  SidebarTabBar = (await import('../index')).default
})

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container)
  })
  container.remove()
})

describe('SidebarTabBar', () => {
  it('calls onTabChange when clicking an inactive tab', () => {
    const onTabChange = vi.fn()
    const onActiveTabClick = vi.fn()

    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="follow"
          followUnread={0}
          recentUnread={3}
          onTabChange={onTabChange}
          onActiveTabClick={onActiveTabClick}
        />,
        container
      )
    })

    act(() => {
      container.querySelectorAll('button')[1].click()
    })

    expect(onTabChange).toHaveBeenCalledWith('recent')
    expect(onActiveTabClick).not.toHaveBeenCalled()
  })

  it('calls onActiveTabClick when clicking the active tab', () => {
    const onTabChange = vi.fn()
    const onActiveTabClick = vi.fn()

    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="recent"
          followUnread={0}
          recentUnread={3}
          onTabChange={onTabChange}
          onActiveTabClick={onActiveTabClick}
        />,
        container
      )
    })

    act(() => {
      container.querySelectorAll('button')[1].click()
    })

    expect(onActiveTabClick).toHaveBeenCalledWith('recent')
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('treats clicking the unread badge as clicking the active tab', () => {
    const onActiveTabClick = vi.fn()

    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="recent"
          followUnread={0}
          recentUnread={3}
          onTabChange={() => {}}
          onActiveTabClick={onActiveTabClick}
        />,
        container
      )
    })

    const badge = Array.from(
      container.querySelectorAll('.wk-sidebar-tabbar__badge')
    ).find((el) => el.textContent === '3') as HTMLElement
    act(() => {
      badge.click()
    })

    expect(onActiveTabClick).toHaveBeenCalledWith('recent')
  })
})

describe("Recent keyboard and assistive activation", () => {
  it("navigates once on a non-pointer click of the active Recent tab and preserves the legacy callback", () => {
    const navigate = vi.fn();
    const changeTab = vi.fn();
    const activeClick = vi.fn();
    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="recent"
          followUnread={0}
          recentUnread={3}
          onTabChange={changeTab}
          onActiveTabClick={activeClick}
          onActiveTabDoubleClick={navigate}
        />,
        container
      );
    });
    // Native Enter/Space and assistive activation produce a click with detail=0.
    // jsdom does not synthesize this click from keyboard events.
    act(() => {
      container
        .querySelectorAll("button")[1]
        .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("recent");
    expect(activeClick).toHaveBeenCalledTimes(1);
    expect(activeClick).toHaveBeenCalledWith("recent");
    expect(changeTab).not.toHaveBeenCalled();
  });

  it("only switches tabs on the first non-pointer activation from Follow", () => {
    const navigate = vi.fn();
    const Harness = () => {
      const [activeTab, setActiveTab] = React.useState<"follow" | "recent">(
        "follow"
      );
      return (
        <SidebarTabBar
          activeTab={activeTab}
          followUnread={0}
          recentUnread={3}
          onTabChange={setActiveTab}
          onActiveTabDoubleClick={navigate}
        />
      );
    };
    act(() => {
      ReactDOM.render(<Harness />, container);
    });
    const button = container.querySelectorAll("button")[1];
    act(() => {
      button.click();
    });
    expect(button.className).toContain("wk-sidebar-tabbar__btn--active");
    expect(navigate).not.toHaveBeenCalled();
    act(() => {
      button.click();
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not navigate on non-pointer activation of Follow", () => {
    const navigate = vi.fn();
    const activeClick = vi.fn();
    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="follow"
          followUnread={3}
          recentUnread={3}
          onTabChange={() => {}}
          onActiveTabClick={activeClick}
          onActiveTabDoubleClick={navigate}
        />,
        container
      );
    });
    act(() => {
      container.querySelectorAll("button")[0].click();
    });
    expect(activeClick).toHaveBeenCalledWith("follow");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("Recent double-click navigation", () => {
  it.each(["button", ".wk-sidebar-tabbar__label", ".wk-sidebar-tabbar__badge"])(
    "navigates once only on double-click of %s",
    (selector) => {
      const navigate = vi.fn();
      const changeTab = vi.fn();
      act(() => {
        ReactDOM.render(
          <SidebarTabBar
            activeTab="recent"
            followUnread={0}
            recentUnread={3}
            onTabChange={changeTab}
            onActiveTabDoubleClick={navigate}
          />,
          container
        );
      });
      const button = container.querySelectorAll("button")[1];
      const target =
        selector === "button" ? button : button.querySelector(selector)!;
      act(() => {
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 })
        );
      });
      expect(navigate).not.toHaveBeenCalled();
      act(() => {
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 2 })
        );
        target.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, detail: 2 })
        );
      });
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith("recent");
      expect(changeTab).not.toHaveBeenCalled();
    }
  );

  it("single-click switches from Follow, then double-click navigates once", () => {
    const navigate = vi.fn();
    const Harness = () => {
      const [activeTab, setActiveTab] = React.useState<"follow" | "recent">(
        "follow"
      );
      return (
        <SidebarTabBar
          activeTab={activeTab}
          followUnread={0}
          recentUnread={3}
          onTabChange={setActiveTab}
          onActiveTabDoubleClick={navigate}
        />
      );
    };
    act(() => {
      ReactDOM.render(<Harness />, container);
    });
    const button = container.querySelectorAll("button")[1];
    act(() => {
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 })
      );
    });
    expect(button.className).toContain("wk-sidebar-tabbar__btn--active");
    expect(navigate).not.toHaveBeenCalled();
    act(() => {
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 })
      );
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 2 })
      );
      button.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, detail: 2 })
      );
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
