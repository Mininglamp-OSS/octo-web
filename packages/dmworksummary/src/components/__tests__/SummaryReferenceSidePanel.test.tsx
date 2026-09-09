import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSummaryDetail: vi.fn(),
  getPersonalResult: vi.fn(),
}));

vi.mock("@octo/base", async () => {
  return vi.importActual<typeof import("../../__mocks__/dmworkBase")>(
    "../../__mocks__/dmworkBase"
  );
});

vi.mock("@douyinfe/semi-ui", () => ({
  Empty: ({ description }: { description: React.ReactNode }) => (
    <div>{description}</div>
  ),
  Spin: () => <div>loading</div>,
}));

vi.mock("../../api/summaryApi", () => ({
  getSummaryDetail: (...args: unknown[]) => mocks.getSummaryDetail(...args),
  getPersonalResult: (...args: unknown[]) => mocks.getPersonalResult(...args),
}));

vi.mock("../SummaryContent", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

import SummaryReferenceSidePanel from "../SummaryReferenceSidePanel";

describe("SummaryReferenceSidePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSummaryDetail.mockResolvedValue({
      task_id: 42,
      title: "Original summary",
      result: { content: "Original body" },
    });
  });

  it("exposes a keyboard-operable close-preview button with the correct label", async () => {
    const onClose = vi.fn();
    render(<SummaryReferenceSidePanel taskId={42} onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: "关闭预览" });
    expect(closeButton).toHaveAttribute("title", "关闭预览");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Original body")).toBeInTheDocument();
  });
});
