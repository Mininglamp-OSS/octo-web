import { vi, describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const mockUseSpaceFeedbackSetting = vi.fn();

vi.mock("@octo/base/src/Components/MessageInput/useSpaceFeedbackSetting", () => ({
  default: () => mockUseSpaceFeedbackSetting(),
  ensureVoiceFeedbackLoaded: vi.fn().mockResolvedValue(undefined),
  toggleVoiceFeedback: vi.fn(),
}));

vi.mock("@octo/base/src/App", () => ({
  default: {
    mittBus: { on: vi.fn(), off: vi.fn() },
    shared: { currentSpaceId: "space-1" },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Switch: (props: any) => {
    const React = require("react");
    return React.createElement("button", {
      role: "switch",
      "aria-checked": props.checked,
      disabled: props.disabled,
      onClick: () => props.onChange?.(!props.checked),
    });
  },
  Tooltip: ({ children }: any) => children,
  Toast: { error: vi.fn() },
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconHelpCircle: () => {
    const React = require("react");
    return React.createElement("span", { "data-testid": "help-icon" });
  },
}));

import NavVoiceFeedbackItem from "@octo/base/src/Components/NavRail/NavVoiceFeedbackItem";

describe("NavVoiceFeedbackItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when apiAvailable is false", () => {
    mockUseSpaceFeedbackSetting.mockReturnValue({
      spaceSetting: null,
      voiceConfig: null,
      apiAvailable: false,
      updateSetting: vi.fn(),
    });

    const { container } = render(<NavVoiceFeedbackItem />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the switch and label when apiAvailable is true", () => {
    mockUseSpaceFeedbackSetting.mockReturnValue({
      spaceSetting: { voice_feedback_on: 1, voice_feedback_notice_acked: 0 },
      voiceConfig: { feedback_url: "https://feedback.test" },
      apiAvailable: true,
      updateSetting: vi.fn(),
    });

    const { getByRole, getByText } = render(
      <ul><NavVoiceFeedbackItem /></ul>
    );
    expect(getByText("语音质量改善计划")).toBeTruthy();
    const toggle = getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the privacy link when feedback_privacy_url is set", () => {
    mockUseSpaceFeedbackSetting.mockReturnValue({
      spaceSetting: { voice_feedback_on: 0, voice_feedback_notice_acked: 0 },
      voiceConfig: {
        feedback_url: "https://feedback.test",
        feedback_privacy_url: "https://privacy.test",
      },
      apiAvailable: true,
      updateSetting: vi.fn(),
    });

    const { getByText } = render(
      <ul><NavVoiceFeedbackItem /></ul>
    );
    expect(getByText("隐私协议")).toBeTruthy();
  });

  it("does not render privacy link when feedback_privacy_url is absent", () => {
    mockUseSpaceFeedbackSetting.mockReturnValue({
      spaceSetting: { voice_feedback_on: 1, voice_feedback_notice_acked: 0 },
      voiceConfig: { feedback_url: "https://feedback.test" },
      apiAvailable: true,
      updateSetting: vi.fn(),
    });

    const { queryByText } = render(
      <ul><NavVoiceFeedbackItem /></ul>
    );
    expect(queryByText("隐私协议")).toBeNull();
  });
});
