// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", () => ({ t: (_key: string, options?: { values?: { count?: number } }) => `views:${options?.values?.count ?? ""}` }));
vi.mock("@douyinfe/semi-ui", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../../utils/icon", () => ({ IconGlyph: () => null }));

import McpCard from "../McpCard";

let container: HTMLDivElement | null = null;
afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
});

describe("McpCard view count", () => {
  it("renders the compact count with an accessible label", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      ReactDOM.render(
        <McpCard
          item={{ id: "m1", name: "MCP", slogan: "", category: "dev", tags: [], toolCount: 2, viewCount: 1250, icon: "" }}
          onClick={vi.fn()}
        />,
        container
      );
    });
    const stat = container.querySelector('[aria-label="views:1250"]');
    expect(stat?.textContent).toContain("1.3K");
  });
});
