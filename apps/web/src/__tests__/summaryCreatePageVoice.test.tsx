import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const mockUseTextareaVoice = vi.fn();
vi.mock("@octo/base/src/Components/VoiceInputButton/useTextareaVoice", () => ({
  default: (opts: unknown) => mockUseTextareaVoice(opts),
}));

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  Typography: { Text: ({ children }: any) => <span>{children}</span> },
  Tag: ({ children }: any) => <span>{children}</span>,
  Avatar: ({ children }: any) => <span>{children}</span>,
  Dropdown: Object.assign(vi.fn(({ children }: any) => children), {
    Menu: vi.fn(({ children }: any) => <div>{children}</div>),
    Item: vi.fn(({ children }: any) => <div>{children}</div>),
  }),
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconPlus: () => <span>+</span>,
}));

vi.mock("@octo/base/src/App", () => ({
  default: {
    routeRight: {
      popToRoot: vi.fn(),
      push: vi.fn(),
    },
  },
}));

vi.mock("@dmwork/summary/src/api/summaryApi", () => ({
  getTemplates: vi.fn().mockResolvedValue([]),
  createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
  createSchedule: vi.fn().mockResolvedValue({}),
}));

vi.mock("@dmwork/summary/src/pages/SummaryDetailPage", () => ({
  default: () => <div>SummaryDetailPage</div>,
}));

vi.mock("@dmwork/summary/src/components/ChatSelectorModal", () => ({
  default: () => null,
}));

vi.mock("@dmwork/summary/src/components/MemberSelectorModal", () => ({
  default: () => null,
}));

vi.mock("@dmwork/summary/src/components/ScheduleConfigModal", () => ({
  default: () => null,
}));

vi.mock("@dmwork/summary/src/utils/summaryHelpers", () => ({
  scheduleToCron: vi.fn(),
}));

import SummaryCreatePage from "@dmwork/summary/src/pages/SummaryCreatePage";

function createMockReturn(overrides = {}) {
  return {
    isRecording: false,
    isTranscribing: false,
    startRecording: vi.fn(),
    stopRecordingAndTranscribe: vi.fn(),
    cancelRecording: vi.fn(),
    isVoiceEnabled: true,
    localAvailable: false,
    ...overrides,
  };
}

describe("SummaryCreatePage - voice input", () => {
  beforeEach(() => {
    mockUseTextareaVoice.mockReturnValue(createMockReturn());
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render VoiceInputButton alongside the topic textarea", () => {
    const { container } = render(<SummaryCreatePage />);

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    const voiceBtn = container.querySelector(".wk-vib");
    expect(voiceBtn).toBeTruthy();
  });

  it("should position VoiceInputButton at top-right of textarea using wk-vib--textarea-corner class", () => {
    const { container } = render(<SummaryCreatePage />);

    const voiceBtn = container.querySelector(".wk-vib--textarea-corner");
    expect(voiceBtn).toBeTruthy();

    // Voice button should be inside a position: relative wrapper
    const wrapper = voiceBtn?.parentElement;
    expect(wrapper?.style.position).toBe("relative");
  });

  it("should render voice button within same container as textarea", () => {
    const { container } = render(<SummaryCreatePage />);

    const textarea = container.querySelector("textarea");
    const voiceBtn = container.querySelector(".wk-vib--textarea-corner");

    // Both should share the same parent (position: relative wrapper)
    expect(textarea?.parentElement).toBe(voiceBtn?.parentElement);
  });
});
