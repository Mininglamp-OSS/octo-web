/** @vitest-environment jsdom */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGroupCreate } from "./useGroupCreate";

const loadCandidates = vi.fn();
const submitAction = vi.fn();

vi.mock("./groupCreateRuntime", () => ({
  loadGroupCreateCandidates: (...args: unknown[]) => loadCandidates(...args),
  submitGroupCreateAction: (...args: unknown[]) => submitAction(...args),
}));

function createOptions(action: "createGroup" | "addMember" = "createGroup") {
  return {
    action,
    channel: { channelID: "group-1", channelType: 2 },
    isOpen: true,
    defaultCategoryId: "category-1",
    keepSidebarTab: true,
    notice: {
      onError: vi.fn(),
      onNameRequired: vi.fn(),
      onMembersRequired: vi.fn(),
      onAvatarUploadFailed: vi.fn(),
    },
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
}

beforeEach(() => {
  loadCandidates.mockReset();
  submitAction.mockReset();
  loadCandidates.mockResolvedValue([
    { uid: "alice", name: "Alice" },
    { uid: "weijiaoying", name: "魏娇莹" },
    { uid: "bot", name: "Octo Bot", robot: true },
  ]);
  submitAction.mockResolvedValue(undefined);
});

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

function renderGroupCreateHook(initialOptions: ReturnType<typeof createOptions>) {
  let current: ReturnType<typeof useGroupCreate> | undefined;
  function Harness({ options }: { options: ReturnType<typeof createOptions> }) {
    current = useGroupCreate(options);
    return null;
  }
  act(() => ReactDOM.render(<Harness options={initialOptions} />, container));
  return {
    get current() {
      if (!current) throw new Error("Hook did not render");
      return current;
    },
    rerender(options: ReturnType<typeof createOptions>) {
      act(() => ReactDOM.render(<Harness options={options} />, container));
    },
  };
}

async function flushLoad() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useGroupCreate", () => {
  it("filters loaded candidates by full pinyin", async () => {
    const result = renderGroupCreateHook(createOptions());

    await flushLoad();
    act(() => result.current.setKeyword("weijiao"));

    expect(result.current.candidates.map((item) => item.uid)).toEqual([
      "weijiaoying",
    ]);
  });

  it("clears add-member search state after closing and reopening", async () => {
    const options = createOptions("addMember");
    const result = renderGroupCreateHook(options);

    await flushLoad();
    act(() => {
      result.current.setKeyword("weijiao");
      result.current.toggleMember("weijiaoying");
    });

    expect(result.current.keyword).toBe("weijiao");
    expect(result.current.candidates.map((item) => item.uid)).toEqual([
      "weijiaoying",
    ]);
    expect(result.current.selected.map((item) => item.uid)).toEqual([
      "weijiaoying",
    ]);

    result.rerender({ ...options, isOpen: false });

    expect(result.current.keyword).toBe("");
    expect(result.current.candidates.map((item) => item.uid)).toEqual([
      "alice",
      "weijiaoying",
      "bot",
    ]);
    expect(result.current.selected).toEqual([]);

    result.rerender({ ...options, isOpen: true });
    await flushLoad();

    expect(result.current.keyword).toBe("");
    expect(result.current.candidates.map((item) => item.uid)).toEqual([
      "alice",
      "weijiaoying",
      "bot",
    ]);
  });

  it("keeps name validation before member validation", async () => {
    const options = createOptions();
    const result = renderGroupCreateHook(options);

    await flushLoad();
    expect(result.current.candidates).toHaveLength(3);
    await act(async () => result.current.submit());
    expect(options.notice.onNameRequired).toHaveBeenCalledTimes(1);
    expect(options.notice.onMembersRequired).not.toHaveBeenCalled();

    act(() => result.current.setGroupName("Project Octo"));
    await act(async () => result.current.submit());
    expect(options.notice.onMembersRequired).toHaveBeenCalledTimes(1);
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("submits the existing create options and closes after success", async () => {
    const options = createOptions();
    const result = renderGroupCreateHook(options);

    await flushLoad();
    expect(result.current.candidates).toHaveLength(3);
    act(() => {
      result.current.setGroupName(" Project Octo ");
      result.current.toggleMember("alice");
      result.current.avatar.save({
        type: "generated",
        avatarText: "PO",
        colorIndex: 2,
      });
    });
    await act(async () => result.current.submit());

    expect(submitAction).toHaveBeenCalledWith({
      action: "createGroup",
      channel: options.channel,
      selectedUids: ["alice"],
      createOptions: {
        categoryId: "category-1",
        name: "Project Octo",
        avatarText: "PO",
        avatarColor: 2,
      },
      avatarFile: undefined,
      onAvatarUploadFailed: options.notice.onAvatarUploadFailed,
      keepSidebarTab: true,
    });
    expect(options.onSuccess).toHaveBeenCalledTimes(1);
    expect(options.onClose).toHaveBeenCalledTimes(1);
  });

  it("submits add-member without create metadata", async () => {
    const options = createOptions("addMember");
    const result = renderGroupCreateHook(options);

    await flushLoad();
    expect(result.current.candidates).toHaveLength(3);
    act(() => result.current.toggleMember("bot"));
    await act(async () => result.current.submit());

    expect(submitAction).toHaveBeenCalledWith({
      action: "addMember",
      channel: options.channel,
      selectedUids: ["bot"],
      createOptions: undefined,
      avatarFile: undefined,
      onAvatarUploadFailed: options.notice.onAvatarUploadFailed,
      keepSidebarTab: true,
    });
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onClose).toHaveBeenCalledTimes(1);
  });

  it("submits a locally selected avatar file without generated avatar fields", async () => {
    const options = createOptions();
    const result = renderGroupCreateHook(options);
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    await flushLoad();
    act(() => {
      result.current.setGroupName("Project Octo");
      result.current.toggleMember("alice");
      result.current.avatar.save({ type: "uploaded", file });
    });
    await act(async () => result.current.submit());

    expect(submitAction).toHaveBeenCalledWith({
      action: "createGroup",
      channel: options.channel,
      selectedUids: ["alice"],
      createOptions: {
        categoryId: "category-1",
        name: "Project Octo",
        avatarText: undefined,
        avatarColor: undefined,
      },
      avatarFile: file,
      onAvatarUploadFailed: options.notice.onAvatarUploadFailed,
      keepSidebarTab: true,
    });
  });
});
