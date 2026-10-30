// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExpertSpecView from "../ExpertSpecView";
import BoundVersionBadge from "../BoundVersionBadge";
vi.mock("@octo/base", () => ({ t: (key: string) => key, useI18n: () => undefined }));
vi.mock("../ExpertSkillBrowser", () => ({ default: () => <div>bound skill content</div> }));
let root: HTMLDivElement;
function render(node: React.ReactElement) {
  root = document.createElement("div"); document.body.appendChild(root);
  act(() => { ReactDOM.render(node, root); });
}
afterEach(() => { act(() => ReactDOM.unmountComponentAtNode(root)); root.remove(); });
describe("bound dependency versions", () => {
  it("shows snapshot labels on both expandable and metadata-only skill rows", () => {
    render(<ExpertSpecView fetchSkillContent={vi.fn()} skills={[
      { name: "Old skill", versionId: "s1", version: "1.0.0", hasContent: true },
      { name: "Metadata skill", versionId: "s2", version: "v1.2.0" },
    ]} />);
    expect([...root.querySelectorAll(".wk-mcp-bound-version")].map(e => e.textContent)).toEqual(["v1.0.0", "v1.2.0"]);
    const row = root.querySelector("button")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    act(() => row.click());
    expect(root.textContent).toContain("bound skill content");
  });
  it("does not display a live label for an unpinned edge or fabricate a missing historical label", () => {
    render(<><BoundVersionBadge version="9.0.0" /><BoundVersionBadge versionId="historical-id" /></>);
    expect(root.textContent).not.toContain("9.0.0");
    expect(root.textContent).toContain("mcp.expert.versionUnpinned");
    expect(root.textContent).toContain("mcp.expert.versionPinned");
  });
  it("labels connectors as versionless and retains redaction when expanded", () => {
    render(<ExpertSpecView fetchSkillContent={vi.fn()} connectors={[
      { pluginId: "c1", name: "Search", mcpConfig: '{"mcpServers":{"search":{"url":"https://example.com","env":{"API_KEY":"private-value"}}}}' },
      { pluginId: "c2", name: "Invalid", mcpConfig: '{invalid private-value' },
    ]} />);
    expect(root.querySelector(".wk-mcp-bound-version")?.textContent).toBe("mcp.expert.versionless");
    act(() => root.querySelectorAll("button")[0].click());
    expect(root.textContent).toContain("••••••");
    expect(root.textContent).not.toContain("private-value");
    act(() => root.querySelectorAll("button")[1].click());
    expect(root.textContent).toContain("mcp.expert.mcpUnavailable");
    expect(root.textContent).not.toContain("private-value");
  });
});
