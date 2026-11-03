// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ workspaces: vi.fn(), runtimes: vi.fn(), install: vi.fn() }));
// Keep the production runtime getter/cache. Only replace the HTTP boundary so
// reopen tests catch stale prefetch/session data rather than bypassing it.
vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      get: (_url: string, config: any) => api.runtimes(config.params.workspace_id)
        .then((data: unknown) => ({ data })),
    }),
  },
}));
vi.mock("@octo/base", () => ({
  WKApp: { shared: { currentSpaceId: "space" } },
  buildAcceptLanguage: () => "en-US",
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
  useI18n: () => undefined,
  t: (key: string) => key,
  WKModal: ({ visible, children, footer }: any) => visible ? <div>{children}{footer}</div> : null,
  WKButton: ({ children, disabled, onClick }: any) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
  Select: ({ value, optionList, onChange, disabled, placeholder }: any) => (
    <select aria-label={placeholder} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {optionList.map((o: any) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock("../../api/expertService", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/expertService")>(),
  getLoopWorkspaces: () => api.workspaces(),
  installExpertToLoop: (...args: unknown[]) => api.install(...args),
  installSquadToLoop: (...args: unknown[]) => api.install(...args),
  createLoopInstallationKey: () => "install-key",
}));
import ExpertAddToLoopModal from "../ExpertAddToLoopModal";
import { clearLoopCache, getLoopRuntimes } from "../../api/expertService";
const item = { id: "expert", name: "Expert", kind: "expert" } as never;
const confirm = () => screen.getByRole("button", { name: "mcp.expert.confirmInstall" });
const runtime = () => screen.getByRole("combobox", { name: "mcp.expert.selectRuntimePlaceholder" }) as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  clearLoopCache();
  api.workspaces.mockResolvedValue([{ id: "w1", name: "One" }, { id: "w2", name: "Two" }]);
  api.install.mockResolvedValue({ agentId: "installed" });
});
afterEach(cleanup);

describe("market installation runtime selection", () => {
  it.each([
    ["offline", "online", "mine", false],
    ["online", "offline", "", true],
  ])("refreshes cached %s status to %s on reopen", async (initial, next, selected, disabled) => {
    api.runtimes.mockResolvedValue([{ id: "mine", name: "Mine", status: initial }]);
    // Seed the same real cache that marketplace prefetch populates.
    await getLoopRuntimes("w1");
    const view = render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(api.runtimes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runtime().value).toBe(initial === "online" ? "mine" : ""));
    view.rerender(<ExpertAddToLoopModal item={null} onClose={vi.fn()} />);

    let resolveRefresh!: (rows: unknown[]) => void;
    api.runtimes.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    view.rerender(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(api.runtimes).toHaveBeenCalledTimes(3));
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    resolveRefresh([{ id: "mine", name: "Mine", status: next }]);
    await waitFor(() => {
      expect((confirm() as HTMLButtonElement).disabled).toBe(disabled);
      expect(runtime().value).toBe(selected);
      expect(runtime().querySelector('option[value="mine"]')?.hasAttribute("disabled")).toBe(disabled);
    });
    fireEvent.click(confirm());
    if (disabled) {
      expect(api.install).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(api.install).toHaveBeenCalledWith("expert", {
        workspaceId: "w1", runtimeId: "mine", idempotencyKey: "install-key",
      }));
    }
  });

  it("defaults to a ready owned runtime and installs with its exact ID", async () => {
    api.runtimes.mockResolvedValue([
      { id: "offline", name: "My offline runtime", status: "offline" },
      { id: "mine", name: "My online runtime", status: "online" },
    ]);
    render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(runtime().value).toBe("mine"));
    expect(runtime().querySelector('option[value="offline"]')?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm());
    await waitFor(() => expect(api.install).toHaveBeenCalledWith("expert", {
      workspaceId: "w1", runtimeId: "mine", idempotencyKey: "install-key",
    }));
  });

  it.each([[[]], [[{ id: "offline", name: "My offline runtime", status: "offline" }]]])(
    "keeps installation disabled when there is no ready owned runtime (%j)", async (rows) => {
      api.runtimes.mockResolvedValue(rows);
      render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
      await waitFor(() => expect(api.runtimes).toHaveBeenCalledWith("w1"));
      expect(runtime().value).toBe("");
      expect((confirm() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(confirm());
      expect(api.install).not.toHaveBeenCalled();
    },
  );

  it("clears the previous workspace runtime before the next list arrives", async () => {
    let resolveNext!: (rows: unknown[]) => void;
    api.runtimes.mockResolvedValueOnce([{ id: "mine-1", name: "One", status: "online" }])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(runtime().value).toBe("mine-1"));
    fireEvent.change(screen.getByRole("combobox", { name: "mcp.expert.selectWorkspacePlaceholder" }), { target: { value: "w2" } });
    expect(runtime().value).toBe("");
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    resolveNext([{ id: "mine-2", name: "Two", status: "online" }]);
    await waitFor(() => expect(runtime().value).toBe("mine-2"));
    fireEvent.click(confirm());
    await waitFor(() => expect(api.install).toHaveBeenCalledWith("expert", {
      workspaceId: "w2", runtimeId: "mine-2", idempotencyKey: "install-key",
    }));
  });
});
