// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpertItem } from "../mock/expertMock";

const mock = vi.hoisted(() => ({
  expert: vi.fn(),
  team: vi.fn(),
  workspaces: vi.fn(),
  runtimes: vi.fn(),
  key: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  useI18n: () => {},
  t: (key: string) => key,
  WKModal: ({ children, footer, onCancel }: any) => (
    <div>
      {children}
      {footer}
      <button onClick={onCancel}>close</button>
    </div>
  ),
  WKButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: mock.success, error: mock.error },
  Select: ({ optionList, value, onChange, placeholder, disabled }: any) => (
    <select
      aria-label={placeholder}
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" />
      {optionList.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../api/expertService", () => ({
  installExpertToLoop: mock.expert,
  installSquadToLoop: mock.team,
  getLoopWorkspaces: mock.workspaces,
  getLoopRuntimes: mock.runtimes,
  createLoopInstallationKey: mock.key,
}));

import ExpertAddToLoopModal from "./ExpertAddToLoopModal";

let container: HTMLDivElement;
const expert = { id: "expert-1", kind: "agent", name: "Expert" } as ExpertItem;
const team = { id: "team-1", kind: "squad", name: "Team" } as ExpertItem;

async function show(item: ExpertItem | null) {
  await act(async () => {
    ReactDOM.render(
      <ExpertAddToLoopModal item={item} onClose={mock.close} />,
      container
    );
  });
}

function confirmButton() {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "mcp.expert.confirmInstall"
  )!;
}

async function confirm() {
  await act(async () => {
    confirmButton().click();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  let serial = 0;
  mock.key.mockImplementation(() => `operation-${++serial}`);
  mock.workspaces.mockResolvedValue([{ id: "workspace-1", name: "Workspace" }]);
  mock.runtimes.mockResolvedValue([
    { id: "runtime-1", name: "Runtime" },
    { id: "runtime-2", name: "Other" },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

describe("expert marketplace recruitment operation", () => {
  it.each([expert, team])(
    "recruits $kind through its Service with an operation key",
    async (item) => {
      await show(item);
      await confirm();
      const install = item.kind === "squad" ? mock.team : mock.expert;
      expect(install).toHaveBeenCalledWith(item.id, {
        workspaceId: "workspace-1",
        runtimeId: "runtime-1",
        idempotencyKey: "operation-1",
      });
      expect(mock.success).toHaveBeenCalledTimes(1);
      expect(mock.close).toHaveBeenCalledTimes(1);
    }
  );

  it("retains a failed operation's key when retrying and reopening the dialog", async () => {
    mock.expert
      .mockRejectedValueOnce(new Error("uncertain outcome"))
      .mockResolvedValueOnce({ agentId: "created" });
    await show(expert);
    await confirm();
    expect(mock.close).not.toHaveBeenCalled();
    expect(mock.success).not.toHaveBeenCalled();
    await show(null);
    await show(expert);
    await confirm();
    expect(mock.expert.mock.calls[0]).toEqual(mock.expert.mock.calls[1]);
    expect(mock.key).toHaveBeenCalledTimes(1);
    expect(mock.success).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh key for a new recruitment after success", async () => {
    await show(expert);
    await confirm();
    await show(null);
    await show(expert);
    await confirm();
    expect(mock.expert.mock.calls[0][1].idempotencyKey).toBe("operation-1");
    expect(mock.expert.mock.calls[1][1].idempotencyKey).toBe("operation-2");
  });

  it("uses separate operations when the target runtime changes", async () => {
    mock.expert.mockRejectedValue(new Error("failed"));
    await show(expert);
    await confirm();
    await act(async () => {
      const select = container.querySelector(
        'select[aria-label="mcp.expert.selectRuntimePlaceholder"]'
      ) as HTMLSelectElement;
      select.value = "runtime-2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await confirm();
    expect(mock.expert.mock.calls[0][1].idempotencyKey).toBe("operation-1");
    expect(mock.expert.mock.calls[1][1]).toEqual({
      workspaceId: "workspace-1",
      runtimeId: "runtime-2",
      idempotencyKey: "operation-2",
    });
  });

  it("blocks duplicate clicks while an installation is in flight", async () => {
    let finish!: () => void;
    mock.expert.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await show(expert);
    const button = confirmButton();
    act(() => {
      button.click();
      button.click();
    });
    expect(mock.expert).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
  });

  it("does not close a different target when an earlier request completes", async () => {
    let finish!: () => void;
    mock.expert.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await show(expert);
    act(() => {
      confirmButton().click();
    });
    await show(null);
    await show(team);
    await act(async () => {
      finish();
    });
    expect(mock.close).not.toHaveBeenCalled();
    expect(mock.success).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(false);
  });
});
