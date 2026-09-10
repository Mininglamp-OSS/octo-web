// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, Array<() => void>>,
  getMySkills: vi.fn(),
  publishPlugin: vi.fn(),
  deleteSkill: vi.fn(),
  cancelReview: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

function emit(event: string) {
  for (const handler of [...(h.handlers[event] ?? [])]) handler();
}

interface FakeObserver {
  callback: IntersectionObserverCallback;
  elements: Set<Element>;
}

const observers: FakeObserver[] = [];

class MockIntersectionObserver {
  private entry: FakeObserver;

  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, elements: new Set() };
    observers.push(this.entry);
  }

  observe(element: Element) {
    this.entry.elements.add(element);
  }

  unobserve(element: Element) {
    this.entry.elements.delete(element);
  }

  disconnect() {
    this.entry.elements.clear();
    const index = observers.indexOf(this.entry);
    if (index >= 0) observers.splice(index, 1);
  }

  takeRecords() {
    return [];
  }
}

function scrollLoadMore() {
  act(() => {
    for (const observer of [...observers]) {
      const targets = Array.from(observer.elements).filter((element) =>
        container.contains(element)
      );
      if (targets.length === 0) continue;
      observer.callback(
        targets.map(
          (target) =>
            ({ isIntersecting: true, target } as IntersectionObserverEntry)
        ),
        observer as unknown as IntersectionObserver
      );
    }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
  WKApp: {
    mittBus: {
      on: (event: string, handler: () => void) =>
        (h.handlers[event] ??= []).push(handler),
      off: (event: string, handler: () => void) => {
        h.handlers[event] = (h.handlers[event] ?? []).filter(
          (entry) => entry !== handler
        );
      },
    },
  },
  WKButton: ({
    children,
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
    React.createElement("button", props, children),
  WKModal: ({
    visible,
    children,
    footer,
  }: {
    visible: boolean;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    visible
      ? React.createElement("div", { role: "dialog" }, children, footer)
      : null,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: h.toastError, success: h.toastSuccess },
}));

vi.mock("@dmwork/skillmarket", () => ({
  MineTable: ({ rows }: { rows: Array<Record<string, unknown>> }) =>
    React.createElement(
      "div",
      null,
      ...rows.flatMap((row) => [
        React.createElement(
          "span",
          { key: `${row.id}-name` },
          String(row.name)
        ),
        row.onPublish
          ? React.createElement(
              "button",
              {
                key: `${row.id}-publish`,
                onClick: row.onPublish as () => void,
              },
              `publish-${row.name}`
            )
          : null,
        React.createElement(
          "button",
          { key: `${row.id}-delete`, onClick: row.onDelete as () => void },
          `delete-${row.name}`
        ),
      ])
    ),
  getMySkills: (...args: unknown[]) => h.getMySkills(...args),
  publishPlugin: (...args: unknown[]) => h.publishPlugin(...args),
  deleteSkill: (...args: unknown[]) => h.deleteSkill(...args),
  cancelReview: (...args: unknown[]) => h.cancelReview(...args),
  getSkillAvatarColor: () => "transparent",
  getSkillAvatarText: () => "A",
}));

vi.mock("../../utils/mcpAvatar", () => ({
  getMcpAvatarColor: () => "transparent",
  getMcpAvatarText: () => "A",
}));

import AllAssetsList from "../AllAssetsList";

const asset = (id: string, name: string) => ({
  id,
  name,
  displayName: name,
  description: "",
  pluginType: "skill",
  visibility: "private",
  version: "1.0.0",
  viewCount: 0,
  downloadCount: 0,
  listingState: "draft",
  displayStatus: "draft",
});
const page = (items: unknown[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  total: items.length,
});

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  h.handlers = {};
  observers.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});
afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.unstubAllGlobals();
});

describe("AllAssetsList pagination", () => {
  it("appends the next page once when the tail intersects", async () => {
    const nextPage = deferred<ReturnType<typeof page>>();
    h.getMySkills
      .mockResolvedValueOnce(page([asset("a", "First page")], "next"))
      .mockReturnValueOnce(nextPage.promise);

    await act(async () => {
      ReactDOM.render(
        React.createElement(AllAssetsList, { onOpenType: vi.fn() }),
        container
      );
    });
    const initialObserver = observers[0];
    scrollLoadMore();
    scrollLoadMore();

    expect(h.getMySkills).toHaveBeenCalledTimes(2);
    expect(h.getMySkills).toHaveBeenLastCalledWith(
      { limit: 50, cursor: "next" },
      { pluginType: "all" }
    );

    await act(async () =>
      nextPage.resolve(page([asset("b", "Second page")], "third"))
    );
    expect(container.textContent).toContain("First page");
    expect(container.textContent).toContain("Second page");
    expect(observers).toHaveLength(1);
    expect(observers[0]).toBe(initialObserver);
  });

  it("does not page with the old cursor during a row-action reload", async () => {
    const reload = deferred<ReturnType<typeof page>>();
    h.getMySkills
      .mockResolvedValueOnce(page([asset("a", "Published asset")], "old-next"))
      .mockReturnValueOnce(reload.promise);
    h.publishPlugin.mockResolvedValueOnce({ displayStatus: "published" });

    await act(async () => {
      ReactDOM.render(
        React.createElement(AllAssetsList, { onOpenType: vi.fn() }),
        container
      );
    });
    const publish = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "publish-Published asset"
    );
    await act(async () => publish?.click());

    scrollLoadMore();
    expect(h.getMySkills).toHaveBeenCalledTimes(2);
    expect(h.getMySkills).not.toHaveBeenCalledWith(
      { limit: 50, cursor: "old-next" },
      { pluginType: "all" }
    );

    await act(async () =>
      reload.resolve(page([asset("a", "Published asset")]))
    );
  });

  it("keeps loaded rows and exposes retry when the next page fails", async () => {
    h.getMySkills
      .mockResolvedValueOnce(page([asset("a", "First page")], "next"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([asset("b", "Retried page")]));

    await act(async () => {
      ReactDOM.render(
        React.createElement(AllAssetsList, { onOpenType: vi.fn() }),
        container
      );
    });
    scrollLoadMore();
    await act(async () => undefined);

    expect(container.textContent).toContain("First page");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "skillMarket.common.loadFailed"
    );
    scrollLoadMore();
    expect(h.getMySkills).toHaveBeenCalledTimes(2);

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "skillMarket.list.retry"
    );
    await act(async () => retry?.click());

    expect(h.getMySkills).toHaveBeenLastCalledWith(
      { limit: 50, cursor: "next" },
      { pluginType: "all" }
    );
    expect(container.textContent).toContain("Retried page");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("lets the new Space paginate while the old Space page is still in flight", async () => {
    const oldPage = deferred<ReturnType<typeof page>>();
    h.getMySkills
      .mockResolvedValueOnce(
        page([asset("a", "Space A asset")], "space-a-next")
      )
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce(
        page([asset("b", "Space B asset")], "space-b-next")
      )
      .mockResolvedValueOnce(page([asset("c", "Space B second page")]));

    await act(async () => {
      ReactDOM.render(
        React.createElement(AllAssetsList, { onOpenType: vi.fn() }),
        container
      );
    });
    scrollLoadMore();
    await act(async () => emit("space-changed"));

    expect(container.textContent).toContain("Space B asset");
    expect(container.textContent).not.toContain("skillMarket.common.loading");

    scrollLoadMore();
    await act(async () => undefined);
    expect(h.getMySkills).toHaveBeenLastCalledWith(
      { limit: 50, cursor: "space-b-next" },
      { pluginType: "all" }
    );
    expect(container.textContent).toContain("Space B second page");

    await act(async () =>
      oldPage.resolve(page([asset("stale", "Stale Space A row")]))
    );
    expect(container.textContent).not.toContain("Stale Space A row");
    expect(container.textContent).toContain("Space B second page");
  });
});

describe("AllAssetsList Space isolation", () => {
  it("clears rows and an open delete modal before the new Space load settles", async () => {
    let resolveNew: (value: ReturnType<typeof page>) => void = () => {};
    h.getMySkills
      .mockResolvedValueOnce(page([asset("a", "Space A asset")]))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          })
      );

    await act(async () => {
      ReactDOM.render(
        React.createElement(AllAssetsList, { onOpenType: vi.fn() }),
        container
      );
    });
    expect(container.textContent).toContain("Space A asset");
    act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "delete-Space A asset"
        ) as HTMLButtonElement
      ).click()
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => emit("space-changed"));
    expect(container.textContent).not.toContain("Space A asset");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => resolveNew(page([asset("b", "Space B asset")])));
    expect(container.textContent).toContain("Space B asset");
  });

  it("ignores an old-Space action continuation after switching Space", async () => {
    let rejectPublish: (error: Error) => void = () => {};
    h.getMySkills
      .mockResolvedValueOnce(page([asset("a", "Space A asset")]))
      .mockResolvedValueOnce(page([asset("b", "Space B asset")]));
    h.publishPlugin.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPublish = reject;
        })
    );

    await act(async () => {
      ReactDOM.render(
        React.createElement(AllAssetsList, { onOpenType: vi.fn() }),
        container
      );
    });
    act(() =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "publish-Space A asset"
        ) as HTMLButtonElement
      ).click()
    );
    await act(async () => emit("space-changed"));
    expect(container.textContent).toContain("Space B asset");

    await act(async () => rejectPublish(new Error("old Space failure")));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.getMySkills).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Space B asset");
  });
});
