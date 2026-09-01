/**
 * @vitest-environment jsdom
 *
 * PromptForwardActions tests — the shared "copy prompt / forward to Bot" block.
 * Covers: owned-bot list renders after fetch (first auto-selected), copy calls
 * copyToClipboard, and forward sends the prompt to the selected Bot's Person
 * channel via forwardPlainText then navigates into that conversation.
 *
 * React 17 + ReactDOM.render pattern (matches WebhookEditModal.test.tsx).
 */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  forwardPlainText: vi.fn(),
  copyToClipboard: vi.fn(),
  showConversation: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../../i18n", () => ({
  t: (k: string) => k,
  useI18n: () => {},
}));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: hoisted.toastSuccess, error: hoisted.toastError },
}));
vi.mock("wukongimjssdk", () => ({
  Channel: class {
    constructor(public channelID: string, public channelType: number) {}
  },
  ChannelTypePerson: 1,
}));
vi.mock("../../../Service/APIClient", () => ({
  default: { shared: { get: hoisted.get } },
}));
vi.mock("../../../Service/ForwardService", () => ({
  forwardPlainText: hoisted.forwardPlainText,
}));
vi.mock("../../../Utils/clipboard", () => ({
  copyToClipboard: hoisted.copyToClipboard,
}));
vi.mock("../../../App", () => ({
  default: {
    shared: { currentSpaceId: "minglue_default" },
    endpoints: { showConversation: hoisted.showConversation },
  },
}));

import PromptForwardActions from "../index";

let container: HTMLDivElement;

beforeEach(() => {
  hoisted.get.mockResolvedValue([
    { uid: "bot_a", name: "研发助手 Bot", description: "dev" },
    { uid: "bot_b", name: "数据分析 Bot" },
  ]);
  hoisted.forwardPlainText.mockResolvedValue({ failedTargets: 0 });
  hoisted.copyToClipboard.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.clearAllMocks();
});

async function render(props: Partial<React.ComponentProps<typeof PromptForwardActions>> = {}) {
  await act(async () => {
    ReactDOM.render(
      <PromptForwardActions prompt="PROMPT_TEXT" {...props} />,
      container
    );
  });
  // Flush the fetchOwnedBots promise chain.
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;
}

describe("PromptForwardActions", () => {
  it("fetches owned bots for the space and renders them (first auto-selected)", async () => {
    await render();
    expect(hoisted.get).toHaveBeenCalledWith("/robot/owned_bots", {
      param: { space_id: "minglue_default" },
    });
    expect(container.textContent).toContain("研发助手 Bot");
    expect(container.textContent).toContain("数据分析 Bot");
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios[0].checked).toBe(true);
  });

  it("copies the prompt via copyToClipboard", async () => {
    await render();
    await act(async () => {
      buttonByText("base.promptForward.copyPrompt")?.click();
    });
    expect(hoisted.copyToClipboard).toHaveBeenCalledWith("PROMPT_TEXT");
  });

  it("forwards the prompt to the selected bot's person channel, then navigates", async () => {
    const onForwarded = vi.fn();
    await render({ onForwarded });
    await act(async () => {
      buttonByText("base.promptForward.forwardToBot")?.click();
      await Promise.resolve();
    });
    expect(hoisted.forwardPlainText).toHaveBeenCalledTimes(1);
    const [channels, text, opts] = hoisted.forwardPlainText.mock.calls[0];
    expect(channels).toHaveLength(1);
    expect(channels[0].channelID).toBe("bot_a");
    expect(channels[0].channelType).toBe(1);
    expect(text).toBe("PROMPT_TEXT");
    expect(opts).toEqual({ spaceId: "minglue_default" });
    expect(hoisted.showConversation).toHaveBeenCalledTimes(1);
    expect(onForwarded).toHaveBeenCalledWith("bot_a");
  });

  it("does not navigate when forward reports a failed target", async () => {
    hoisted.forwardPlainText.mockResolvedValue({ failedTargets: 1 });
    await render();
    await act(async () => {
      buttonByText("base.promptForward.forwardToBot")?.click();
      await Promise.resolve();
    });
    expect(hoisted.toastError).toHaveBeenCalled();
    expect(hoisted.showConversation).not.toHaveBeenCalled();
  });

  it("shows the empty state and no forward button target when the space has no owned bots", async () => {
    hoisted.get.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain("base.promptForward.botEmpty");
    const forwardBtn = buttonByText("base.promptForward.forwardToBot");
    expect(forwardBtn?.disabled).toBe(true);
  });

  it("relabels the forward button per kind (publish / update)", async () => {
    await render({ kind: "publish" });
    expect(buttonByText("base.promptForward.forwardToBotPublish")).toBeTruthy();

    ReactDOM.unmountComponentAtNode(container);
    await render({ kind: "update" });
    expect(buttonByText("base.promptForward.forwardToBotUpdate")).toBeTruthy();
  });

  it("keeps the edit button actionable after the draft is cleared (gates on the prompt prop)", async () => {
    // Split layout renders the 编辑提示词 button; enter edit mode, wipe the
    // textarea, then leave edit mode. Regression guard: the button must gate on
    // the immutable `prompt` prop, not the mutable draft — otherwise clearing
    // the textarea permanently disables edit/copy/forward until reopen.
    await render({ layout: "split" });
    await act(async () => {
      buttonByText("base.promptForward.editPrompt")?.click();
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setValue.call(textarea, "");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonByText("base.promptForward.doneEdit")?.click();
    });
    const editBtn = buttonByText("base.promptForward.editPrompt");
    expect(editBtn?.disabled).toBe(false);
  });
});
