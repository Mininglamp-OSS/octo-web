// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  GroupMdEditor,
  normalizeGroupMdContent,
} from "../index";

const hoisted = vi.hoisted(() => ({
  getGroupMd: vi.fn(),
}));

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      channelDataSource: {
        getGroupMd: hoisted.getGroupMd,
      },
    },
  },
  __esModule: true,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement("button", props, children),
  TextArea: ({ value, onChange, placeholder }: any) =>
    React.createElement("textarea", {
      value,
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
        onChange?.(event.target.value),
    }),
  Spin: () => React.createElement("div", { "data-testid": "spin" }),
  Toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../Messages/Text/MarkdownContent", () => ({
  default: ({ content }: { content: string }) => {
    const lines = content.split("\n");
    return React.createElement(
      "div",
      { "data-testid": "markdown-content" },
      lines.map((line, index) =>
        React.createElement("p", { key: index }, line)
      )
    );
  },
  __esModule: true,
}));

beforeEach(() => {
  hoisted.getGroupMd.mockReset();
});

describe("normalizeGroupMdContent", () => {
  it("turns escaped LF into real line breaks", () => {
    expect(normalizeGroupMdContent("# Title\\n\\n- item")).toBe(
      "# Title\n\n- item"
    );
  });

  it("turns escaped CRLF into real line breaks", () => {
    expect(normalizeGroupMdContent("# Title\\r\\n\\r\\n- item")).toBe(
      "# Title\n\n- item"
    );
  });

  it("keeps normal Markdown unchanged", () => {
    const content = "# Title\n\n- item";
    expect(normalizeGroupMdContent(content)).toBe(content);
  });

  it("does not aggressively unescape mixed multiline content", () => {
    const content = "# Title\nliteral \\n example";
    expect(normalizeGroupMdContent(content)).toBe(content);
  });
});

describe("GroupMdEditor preview", () => {
  it("normalizes escaped newlines before rendering Markdown preview", async () => {
    hoisted.getGroupMd.mockResolvedValueOnce({
      content: "# Title\\n\\n- item",
      version: 2,
    });
    const channel = new Channel("group-1", ChannelTypeGroup);

    render(<GroupMdEditor channel={channel} canEdit={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-content")).toHaveTextContent(
        "# Title- item"
      );
    });
    expect(screen.queryByText(/\\n/)).not.toBeInTheDocument();
  });
});
