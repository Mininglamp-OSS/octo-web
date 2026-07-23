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

function renderGroupCreateHook(options: ReturnType<typeof createOptions>) {
  let current: ReturnType<typeof useGroupCreate> | undefined;
  function Harness() {
    current = useGroupCreate(options);
    return null;
  }
  act(() => ReactDOM.render(<Harness />, container));
  return {
    get current() {
      if (!current) throw new Error("Hook did not render");
      return current;
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
      result.current.avatar.save("PO", 2);
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
      keepSidebarTab: true,
    });
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onClose).toHaveBeenCalledTimes(1);
  });
});
