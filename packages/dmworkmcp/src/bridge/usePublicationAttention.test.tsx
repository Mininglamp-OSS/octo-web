// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  handlers: new Map<string, Function>(),
  changed: undefined as undefined | (() => void),
}));
vi.mock("@dmwork/skillmarket", () => ({ getMySkills: mocks.list }));
vi.mock("@octo/base", () => ({
  WKApp: {
    mittBus: {
      on: (event: string, fn: Function) => mocks.handlers.set(event, fn),
      off: (event: string) => mocks.handlers.delete(event),
    },
  },
}));
vi.mock("@dmwork/skillmarket/src/api/reviewSignal", () => ({
  subscribeReviewsChanged: (fn: () => void) => {
    mocks.changed = fn;
    return () => {
      mocks.changed = undefined;
    };
  },
}));
import {
  hasPublicationAttention,
  usePublicationAttention,
} from "./usePublicationAttention";
let container: HTMLDivElement;
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  total: items.length,
});
function Probe() {
  return <span>{String(usePublicationAttention())}</span>;
}
beforeEach(() => {
  mocks.list.mockReset();
  mocks.handlers.clear();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});
it.each([
  { listingState: "delisted" },
  { dependencySuspended: true },
  { dependencyIssues: [{ reason: "delisted" }] },
  { dependencyUpdates: [{ is_skipped: false }] },
])("finds outstanding state on later pages: %j", async (item) => {
  mocks.list
    .mockResolvedValueOnce(page([{ listingState: "draft" }], "2"))
    .mockResolvedValueOnce(page([item], "3"));
  const signal = new AbortController().signal;
  expect(await hasPublicationAttention(signal)).toBe(true);
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(mocks.list).toHaveBeenLastCalledWith(
    { limit: 100, cursor: "2" },
    { pluginType: "all", signal }
  );
});
it("clears only after all pages are clear, ignoring skipped updates", async () => {
  mocks.list
    .mockResolvedValueOnce(
      page([{ dependencyUpdates: [{ is_skipped: true }] }], "2")
    )
    .mockResolvedValueOnce(page([{ listingState: "published" }]));
  expect(await hasPublicationAttention(new AbortController().signal)).toBe(
    false
  );
});
it("treats a later page failure and repeated cursor as unknown", async () => {
  mocks.list
    .mockResolvedValueOnce(page([], "2"))
    .mockRejectedValueOnce(new Error("offline"));
  await expect(
    hasPublicationAttention(new AbortController().signal)
  ).rejects.toThrow("offline");
  mocks.list.mockResolvedValue(page([], "2"));
  await expect(
    hasPublicationAttention(new AbortController().signal)
  ).rejects.toThrow("cursor");
});
it("preserves the dot on failed refresh and clears after resolution without click dismissal", async () => {
  mocks.list.mockResolvedValue(page([{ listingState: "delisted" }]));
  await act(async () => {
    ReactDOM.render(<Probe />, container);
  });
  expect(container.textContent).toBe("true");
  mocks.list.mockRejectedValue(new Error("offline"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(container.textContent).toBe("true");
  mocks.list.mockResolvedValue(page());
  await act(async () => {
    mocks.changed?.();
  });
  expect(container.textContent).toBe("false");
});
it.each(["space-changed", "wk:auth-state-changed"])(
  "cancels previous reads and clears old scope on %s",
  async (event) => {
    let finish!: (value: unknown) => void;
    mocks.list
      .mockResolvedValueOnce(page([{ listingState: "delisted" }]))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValueOnce(page());
    await act(async () => {
      ReactDOM.render(<Probe />, container);
    });
    await act(async () => {
      mocks.changed?.();
    });
    const previousSignal = mocks.list.mock.calls[1][1].signal;
    await act(async () => {
      mocks.handlers.get(event)?.();
    });
    expect(previousSignal.aborted).toBe(true);
    expect(container.textContent).toBe("false");
    await act(async () => {
      finish(page([{ listingState: "delisted" }]));
    });
    expect(container.textContent).toBe("false");
  }
);
it("refreshes on market activation and cancels/unsubscribes on unmount", async () => {
  mocks.list.mockResolvedValue(page());
  await act(async () => {
    ReactDOM.render(<Probe />, container);
  });
  await act(async () => {
    mocks.handlers.get("wk:nav-menu-activated")?.({ menuId: "mcp-market" });
  });
  expect(mocks.list).toHaveBeenCalledTimes(2);
  const signal = mocks.list.mock.calls[1][1].signal;
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  expect(signal.aborted).toBe(true);
  expect(mocks.changed).toBeUndefined();
  expect(mocks.handlers.size).toBe(0);
});
