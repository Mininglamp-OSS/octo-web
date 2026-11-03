// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ install: vi.fn() }));
vi.mock("@octo/base", () => ({
  useI18n: () => undefined,
  t: (key: string, options?: { values: Record<string, string> }) => options
    ? `${options.values.name} (${options.values.status})` : key,
  WKModal: ({ children, footer }: any) => <div>{children}{footer}</div>,
  WKButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
// Use the production Select, including its label-keyed selection bookkeeping.
// Import the component directly to avoid unrelated modules in Semi's barrel.
vi.mock("@douyinfe/semi-ui", async () => {
  const Select = (await import("@douyinfe/semi-ui/lib/es/select")).default;
  return {
    // jsdom does not complete CSS animations; keep real selection behavior.
    Select: (props: any) => React.createElement(Select as any, { ...props, motion: false }),
    Toast: { success: vi.fn(), error: vi.fn() },
  };
});
vi.mock("../../api/expertService", () => ({
  getLoopWorkspaces: async () => [{ id: "workspace", name: "Workspace" }],
  getLoopRuntimes: async () => [
    { id: "runtime-A", name: "Codex (localhost)", status: "online" },
    { id: "runtime-B", name: "Claude (localhost)", status: "online" },
    { id: "runtime-C", name: "Codex (localhost)", status: "online" },
    { id: "runtime-D", name: "Codex (localhost)", status: "offline" },
  ],
  installExpertToLoop: api.install,
  installSquadToLoop: api.install,
  createLoopInstallationKey: () => "install-key",
}));
import ExpertAddToLoopModal from "../ExpertAddToLoopModal";

let container: HTMLDivElement;
const item = { id: "expert", name: "Expert", kind: "expert" } as never;
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const selected = () => options().filter((option) => option.getAttribute("aria-selected") === "true");
const runtime = () => container.querySelectorAll<HTMLElement>('[role="combobox"]')[1];
async function openRuntime() {
  act(() => { Simulate.click(runtime()); });
  await vi.waitFor(() => expect(options()).toHaveLength(4));
}

beforeEach(() => {
  api.install.mockReset().mockResolvedValue({ agentId: "installed" });
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

it("marks only the selected runtime when names repeat, and installs the newly chosen ID", async () => {
  const close = vi.fn();
  await act(async () => {
    ReactDOM.render(<ExpertAddToLoopModal item={item} onClose={close} />, container);
  });
  await vi.waitFor(() => expect(runtime().textContent).toContain("Codex (localhost)"));
  await openRuntime();
  expect(selected()).toEqual([options()[0]]);
  expect(options()[3].getAttribute("aria-disabled")).toBe("true");

  // Scrolling must not make another equal-name option appear selected.
  act(() => { Simulate.scroll(options()[0].parentElement!); });
  expect(selected()).toEqual([options()[0]]);
  act(() => { Simulate.click(options()[2]); });
  await vi.waitFor(() => expect(runtime().getAttribute("aria-expanded")).toBe("false"));
  await openRuntime();
  await vi.waitFor(() => expect(selected()).toEqual([options()[2]]));

  // Parent rerenders recreate the option labels; selection must remain correct.
  await act(async () => {
    ReactDOM.render(<ExpertAddToLoopModal item={item} onClose={close} />, container);
  });
  expect(selected()).toEqual([options()[2]]);
  act(() => {
    const confirm = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "mcp.expert.confirmInstall")!;
    confirm.click();
  });
  await vi.waitFor(() => expect(api.install).toHaveBeenCalledWith("expert", {
    workspaceId: "workspace", runtimeId: "runtime-C", idempotencyKey: "install-key",
  }));
});
