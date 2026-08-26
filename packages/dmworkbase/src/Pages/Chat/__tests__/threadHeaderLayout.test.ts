import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const chatDirectory = resolve(__dirname, "..");
const chatSource = readFileSync(resolve(chatDirectory, "index.tsx"), "utf8");
const chatStyles = readFileSync(resolve(chatDirectory, "index.css"), "utf8");

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = chatStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m")
  );

  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("Thread conversation header layout", () => {
  it("uses the standard chevron icon between the parent group and Thread", () => {
    expect(chatSource).toContain(
      'import { Columns2, ChevronRight } from "lucide-react"'
    );
    expect(chatSource).toContain(
      '<ChevronRight aria-hidden="true" size={14} />'
    );
  });

  it("keeps the full parent group name and truncates the Thread first", () => {
    const parentRule = cssRule(".wk-chat-conversation-header-parent-group");
    const threadRule = cssRule(".wk-chat-conversation-header-thread-name");

    expect(parentRule).toContain("font-size: 14px");
    expect(parentRule).toContain("font-weight: 400");
    expect(parentRule).toContain("flex-shrink: 0");
    expect(parentRule).not.toContain("text-overflow: ellipsis");
    expect(threadRule).toContain("font-size: 14px");
    expect(threadRule).toContain("font-weight: 600");
    expect(threadRule).toContain("text-overflow: ellipsis");
    expect(threadRule).toContain("flex-shrink: 1");
  });

  it("uses the shared leading-icon spacing for every conversation header", () => {
    const channelRule = cssRule(".wk-chat-conversation-header-channel");
    const nameRule = cssRule(".wk-chat-conversation-header-channel-info-name");
    const breadcrumbRule = cssRule(
      ".wk-chat-conversation-header-channel-info-name--thread"
    );

    expect(channelRule).toContain("gap: var(--wk-sp-2)");
    expect(nameRule).not.toContain("margin-left");
    expect(breadcrumbRule).not.toContain("margin-left");
    expect(breadcrumbRule).toContain("gap: var(--wk-sp-1-5)");
  });

  it("keeps the avatar image out of inline baseline layout", () => {
    const avatarRule = cssRule(".wk-chat-conversation-header-channel-avatar");
    const imageRule = cssRule(
      ".wk-chat-conversation-header-channel-avatar img"
    );

    expect(avatarRule).toContain("line-height: 0");
    expect(imageRule).toContain("display: block");
  });

  it("optically aligns the chevron with Chinese text", () => {
    const separatorRule = cssRule(".wk-chat-conversation-header-separator");

    expect(separatorRule).toContain("transform: translateY(1px)");
  });
});
