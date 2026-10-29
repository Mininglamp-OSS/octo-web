// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
}));
vi.mock("../ExpertSkillBrowser", () => ({
  default: ({ skill, fetchContent }: any) => (
    <button onClick={fetchContent}>{`files:${skill.versionId}`}</button>
  ),
}));
import ExpertSpecView from "../ExpertSpecView";
afterEach(cleanup);
it("shows summary, creator and version in the skill accordion and uses the selected skill loader", () => {
  const load = vi.fn().mockResolvedValue("pinned body");
  render(
    <ExpertSpecView
      skills={[
        {
          pluginId: "skill",
          name: "Metrics",
          summary: "Check completeness",
          creatorName: "Alice",
          versionId: "pin1",
          version: "1.0.0",
          hasContent: true,
        },
      ]}
      fetchSkillContent={load}
    />
  );
  const toggle = screen.getByRole("button", { name: /Metrics/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Check completeness")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("Check completeness")).toBeTruthy();
  expect(screen.getByText(/Alice/)).toBeTruthy();
  expect(screen.getByText("1.0.0")).toBeTruthy();
  fireEvent.click(screen.getByText("files:pin1"));
  expect(load).toHaveBeenCalledWith(0);
  fireEvent.click(toggle);
  expect(screen.queryByText("Check completeness")).toBeNull();
});
it("shows MCP metadata and masks literal credentials", () => {
  render(
    <ExpertSpecView
      connectors={[
        {
          pluginId: "mcp",
          name: "Warehouse MCP",
          summary: "Query warehouse",
          creatorName: "Bob",
          config: JSON.stringify({
            mcpServers: {
              db: { command: "server", env: { TOKEN: "do-not-display" } },
            },
          }),
        },
      ]}
      fetchSkillContent={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Warehouse MCP" }));
  expect(screen.getByText("Query warehouse")).toBeTruthy();
  expect(screen.getByText(/Bob/)).toBeTruthy();
  expect(document.body.textContent).not.toContain("do-not-display");
});
it("renders missing metadata and non-previewable skills without inventing authors", () => {
  render(
    <ExpertSpecView skills={[{ name: "Legacy" }]} fetchSkillContent={vi.fn()} />
  );
  fireEvent.click(screen.getByRole("button", { name: /Legacy/ }));
  expect(screen.getByText(/dependencyUnknownAuthor/)).toBeTruthy();
  expect(screen.getByText(/dependencyNoSummary/)).toBeTruthy();
});
it("does not revive inline MCP config when explicit connector relations resolve empty", () => {
  render(
    <ExpertSpecView
      connectors={[]}
      mcpConfig='{"mcpServers":{}}'
      fetchSkillContent={vi.fn()}
    />
  );
  expect(screen.queryByText(/dependencyLegacyConfig/)).toBeNull();
});
