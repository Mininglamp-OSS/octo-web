// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
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
let container: HTMLDivElement | undefined;
// Match the package's React 17 renderer and act implementation. The testing
// library dependency carries a React 18 renderer, so mixing them leaves its
// concurrent render unflushed under the package's default CI configuration.
function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container!);
  });
}
function button(name: string | RegExp) {
  const match = Array.from(container!.querySelectorAll("button")).find((node) =>
    typeof name === "string"
      ? node.textContent === name
      : name.test(node.textContent || "")
  );
  expect(match).toBeDefined();
  return match!;
}
function click(node: HTMLElement) {
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
afterEach(() => {
  if (container) {
    act(() => {
      ReactDOM.unmountComponentAtNode(container!);
    });
    container.remove();
    container = undefined;
  }
});
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
  const toggle = button(/Metrics/);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container!.textContent).not.toContain("Check completeness");
  click(toggle);
  expect(container!.textContent).toContain("Check completeness");
  expect(container!.textContent).toContain("Alice");
  expect(toggle.textContent).toContain("1.0.0");
  click(button("files:pin1"));
  expect(load).toHaveBeenCalledWith(0);
  click(toggle);
  expect(container!.textContent).not.toContain("Check completeness");
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
  click(button("Warehouse MCP"));
  expect(container!.textContent).toContain("Query warehouse");
  expect(container!.textContent).toContain("Bob");
  expect(document.body.textContent).not.toContain("do-not-display");
});
it("renders missing metadata and non-previewable skills without inventing authors", () => {
  render(
    <ExpertSpecView skills={[{ name: "Legacy" }]} fetchSkillContent={vi.fn()} />
  );
  click(button(/Legacy/));
  expect(container!.textContent).toContain("dependencyUnknownAuthor");
  expect(container!.textContent).toContain("dependencyNoSummary");
});
it("does not revive inline MCP config when explicit connector relations resolve empty", () => {
  render(
    <ExpertSpecView
      connectors={[]}
      mcpConfig='{"mcpServers":{}}'
      fetchSkillContent={vi.fn()}
    />
  );
  expect(container!.textContent).not.toContain("dependencyLegacyConfig");
});

it.each(["connector", "legacy"])("does not render command/cwd credentials in %s MCP preview", source => {
  const config = JSON.stringify({ mcpServers: { server: {
    command: "sh -c 'curl https://host/?token=never-render-command'",
    cwd: "/workspaces/never-render-directory",
  } } });
  render(<ExpertSpecView fetchSkillContent={vi.fn()} {...(source === "connector"
    ? { connectors: [{ pluginId: "unsafe", name: "Unsafe MCP", config }] }
    : { mcpConfig: config })} />);
  click(button(source === "connector" ? "Unsafe MCP" : /dependencyLegacyConfig/));
  expect(container!.querySelector("pre")).not.toBeNull();
  expect(container!.textContent).not.toContain("never-render-command");
  expect(container!.textContent).not.toContain("never-render-directory");
  expect(container!.textContent).toContain("••••••");
});
