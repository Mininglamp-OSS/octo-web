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

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
  WKApp: {
    mittBus: {
      on: (event: string, handler: () => void) => (h.handlers[event] ??= []).push(handler),
      off: (event: string, handler: () => void) => {
        h.handlers[event] = (h.handlers[event] ?? []).filter((entry) => entry !== handler);
      },
    },
  },
  WKButton: ({ children, loading: _loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
    React.createElement("button", props, children),
  WKModal: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer: React.ReactNode }) =>
    visible ? React.createElement("div", { role: "dialog" }, children, footer) : null,
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
        React.createElement("span", { key: `${row.id}-name` }, String(row.name)),
        row.onPublish ? React.createElement("button", { key: `${row.id}-publish`, onClick: row.onPublish as () => void }, `publish-${row.name}`) : null,
        React.createElement("button", { key: `${row.id}-delete`, onClick: row.onDelete as () => void }, `delete-${row.name}`),
      ]),
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
const page = (items: unknown[]) => ({ items, nextCursor: null, total: items.length });

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  h.handlers = {};
  vi.clearAllMocks();
});
afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
});

describe("AllAssetsList Space isolation", () => {
  it("clears rows and an open delete modal before the new Space load settles", async () => {
    let resolveNew: (value: ReturnType<typeof page>) => void = () => {};
    h.getMySkills
      .mockResolvedValueOnce(page([asset("a", "Space A asset")]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    await act(async () => {
      ReactDOM.render(React.createElement(AllAssetsList, { onOpenType: vi.fn() }), container);
    });
    expect(container.textContent).toContain("Space A asset");
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "delete-Space A asset") as HTMLButtonElement).click());
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
      () => new Promise((_resolve, reject) => { rejectPublish = reject; }),
    );

    await act(async () => {
      ReactDOM.render(React.createElement(AllAssetsList, { onOpenType: vi.fn() }), container);
    });
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "publish-Space A asset") as HTMLButtonElement).click());
    await act(async () => emit("space-changed"));
    expect(container.textContent).toContain("Space B asset");

    await act(async () => rejectPublish(new Error("old Space failure")));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.getMySkills).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Space B asset");
  });
});
