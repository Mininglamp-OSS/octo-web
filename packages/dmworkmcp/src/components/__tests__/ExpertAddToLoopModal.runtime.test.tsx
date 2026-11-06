// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
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
vi.mock("../../ui/LoopRuntimePicker", () => ({
  default: ({ groups, value, onChange, disabled, loading }: any) => (
    <select aria-label="mcp.expert.selectRuntimePlaceholder" value={value} disabled={disabled || loading} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {groups.flatMap((g: any) => g.items).map((r: any) => <option key={r.id} value={r.id} disabled={!r.available}>{r.name}</option>)}
    </select>
  ),
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
let container: HTMLDivElement;
const waitFor = vi.waitFor;
const confirm = () => Array.from(container.querySelectorAll("button"))
  .find((button) => button.textContent === "mcp.expert.confirmInstall")!;
const runtime = () => container.querySelector<HTMLSelectElement>(
  'select[aria-label="mcp.expert.selectRuntimePlaceholder"]'
)!;

// Match the package's React 17 renderer, including for rerenders and effects.
async function render(element: React.ReactElement) {
  await act(async () => { ReactDOM.render(element, container); });
}

async function clickConfirm() {
  await act(async () => { confirm().click(); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.clearAllMocks();
  clearLoopCache();
  api.workspaces.mockResolvedValue([{ id: "w1", name: "One" }, { id: "w2", name: "Two" }]);
  api.install.mockResolvedValue({ agentId: "installed" });
});
afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

describe("market installation runtime selection", () => {
  it.each([
    ["offline", "online", "mine", false],
    ["online", "offline", "", true],
  ])("refreshes cached %s status to %s on reopen", async (initial, next, selected, disabled) => {
    api.runtimes.mockResolvedValue([{ id: "mine", name: "Mine", status: initial }]);
    // Seed the same real cache that marketplace prefetch populates.
    await getLoopRuntimes("w1");
    await render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(api.runtimes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runtime().value).toBe(initial === "online" ? "mine" : ""));
    await render(<ExpertAddToLoopModal item={null} onClose={vi.fn()} />);

    let resolveRefresh!: (rows: unknown[]) => void;
    api.runtimes.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    await render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(api.runtimes).toHaveBeenCalledTimes(3));
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolveRefresh([{ id: "mine", name: "Mine", status: next }]); });
    await waitFor(() => {
      expect((confirm() as HTMLButtonElement).disabled).toBe(disabled);
      expect(runtime().value).toBe(selected);
      expect(runtime().querySelector('option[value="mine"]')?.hasAttribute("disabled")).toBe(disabled);
    });
    await clickConfirm();
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
    await render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(runtime().value).toBe("mine"));
    expect(runtime().querySelector('option[value="offline"]')?.hasAttribute("disabled")).toBe(true);
    await clickConfirm();
    await waitFor(() => expect(api.install).toHaveBeenCalledWith("expert", {
      workspaceId: "w1", runtimeId: "mine", idempotencyKey: "install-key",
    }));
  });

  it.each([[[]], [[{ id: "offline", name: "My offline runtime", status: "offline" }]]])(
    "keeps installation disabled when there is no ready owned runtime (%j)", async (rows) => {
      api.runtimes.mockResolvedValue(rows);
      await render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
      await waitFor(() => expect(api.runtimes).toHaveBeenCalledWith("w1"));
      expect(runtime().value).toBe("");
      expect((confirm() as HTMLButtonElement).disabled).toBe(true);
      await clickConfirm();
      expect(api.install).not.toHaveBeenCalled();
    },
  );

  it("never defaults or submits to failed online configurations or explicit non-owned runtimes", async () => {
    api.runtimes.mockResolvedValue([
      { id: "theirs", name: "Other machine", status: "online", can_bind: false },
      { id: "failed", name: "Broken profile", status: "online", can_bind: true, metadata: { runtime_profile_registration_error: true } },
    ]);
    await render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(runtime().querySelector('option[value="failed"]')).not.toBeNull());
    expect(runtime().value).toBe("");
    expect(runtime().querySelector('option[value="theirs"]')).toBeNull();
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    await clickConfirm();
    expect(api.install).not.toHaveBeenCalled();
  });

  it("clears the previous workspace runtime before the next list arrives", async () => {
    let resolveNext!: (rows: unknown[]) => void;
    api.runtimes.mockResolvedValueOnce([{ id: "mine-1", name: "One", status: "online" }])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    await render(<ExpertAddToLoopModal item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(runtime().value).toBe("mine-1"));
    act(() => {
      const workspace = container.querySelector<HTMLSelectElement>(
        'select[aria-label="mcp.expert.selectWorkspacePlaceholder"]'
      )!;
      workspace.value = "w2";
      Simulate.change(workspace);
    });
    expect(runtime().value).toBe("");
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolveNext([{ id: "mine-2", name: "Two", status: "online" }]); });
    await waitFor(() => expect(runtime().value).toBe("mine-2"));
    await clickConfirm();
    await waitFor(() => expect(api.install).toHaveBeenCalledWith("expert", {
      workspaceId: "w2", runtimeId: "mine-2", idempotencyKey: "install-key",
    }));
  });
});
