/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../i18n";
import QuickMuteSidebar from "../QuickMuteSidebar";
import type { QuickMuteService, QuickMuteState } from "../QuickMuteStore";

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

function service(initial: QuickMuteState, overrides: Partial<QuickMuteService> = {}): QuickMuteService {
  return {
    getState: vi.fn(async () => initial),
    setMute: vi.fn(async () => ({ active: true, scope: initial.scope, endAt: Date.now() + 60_000 })),
    resume: vi.fn(async () => ({ active: false, scope: initial.scope })),
    ...overrides,
  };
}

function renderSidebar(api: QuickMuteService) {
  act(() => ReactDOM.render(<QuickMuteSidebar service={api} />, container));
}

function button(text: string, root: ParentNode = document.body): HTMLButtonElement {
  const result = Array.from(root.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!result) throw new Error(`button not found: ${text}`);
  return result as HTMLButtonElement;
}

describe("QuickMuteSidebar", () => {
  it("opens the quick mute menu and applies 30 minute mute", async () => {
    const api = service({ active: false, scope: "sound" });
    renderSidebar(api);
    await flush();

    act(() => button("提醒开启", container).click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    act(() => button("静音 30 分钟").click());
    await flush();

    expect(api.setMute).toHaveBeenCalledWith({ duration: "30m" });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps mute actions disabled until the initial state is loaded", async () => {
    let resolveState!: (state: QuickMuteState) => void;
    const getState = vi.fn(() => new Promise<QuickMuteState>((resolve) => { resolveState = resolve; }));
    const api = service({ active: false, scope: "sound-and-popup" }, { getState });
    renderSidebar(api);
    act(() => button("提醒开启", container).click());
    expect(button("静音 30 分钟").disabled).toBe(true);
    await act(async () => resolveState({ active: false, scope: "sound-and-popup" }));
    await flush();
    expect(button("静音 30 分钟").disabled).toBe(false);
  });

  it("shows a save error when muting fails", async () => {
    const api = service({ active: false, scope: "sound" }, {
      setMute: vi.fn(async () => { throw new Error("offline"); }),
    });
    renderSidebar(api);
    await flush();
    act(() => button("提醒开启", container).click());
    act(() => button("静音 30 分钟").click());
    await flush();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("保存失败");
  });

  it("offers resume and closes the menu after resuming an active mute", async () => {
    const api = service({ active: true, scope: "sound-and-popup" });
    renderSidebar(api);
    await flush();
    act(() => button("已静音", container).click());
    expect(button("恢复提醒")).toBeTruthy();

    act(() => button("恢复提醒").click());
    await flush();

    expect(api.resume).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("shows a load error and retries loading state", async () => {
    const getState = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ active: false, scope: "sound" });
    const api = service({ active: false, scope: "sound" }, { getState });
    renderSidebar(api);
    await flush();
    act(() => button("提醒开启", container).click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("加载失败");

    act(() => button("重试").click());
    await flush();
    expect(getState).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("retries a failed resume instead of muting again", async () => {
    const resume = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ active: false, scope: "sound-and-popup" });
    const api = service({ active: true, scope: "sound-and-popup" }, { resume });
    renderSidebar(api);
    await flush();
    act(() => button("已静音", container).click());
    act(() => button("恢复提醒").click());
    await flush();
    act(() => button("重试").click());
    await flush();
    expect(resume).toHaveBeenCalledTimes(2);
    expect(api.setMute).not.toHaveBeenCalled();
  });
});
