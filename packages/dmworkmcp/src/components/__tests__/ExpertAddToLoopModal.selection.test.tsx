// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ install: vi.fn(), runtimes: vi.fn() }));
vi.mock("@octo/base", () => ({
  useI18n: () => undefined,
  t: (key: string, options?: { values: Record<string, string> }) =>
    options ? `${options.values.name} (${options.values.status})` : key,
  WKModal: ({ children, footer }: any) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  WKButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
// Exercise the production picker and Semi popup, without replacing option DOM.
// Import the component directly to avoid unrelated modules in Semi's barrel.
vi.mock("@douyinfe/semi-ui", async () => {
  const Select = (await import("@douyinfe/semi-ui/lib/es/select")).default;
  const Dropdown = (await import("@douyinfe/semi-ui/lib/es/dropdown")).default;
  return {
    Dropdown: (props: any) =>
      React.createElement(Dropdown as any, { ...props, motion: false }),
    // jsdom does not complete CSS animations; keep real selection behavior.
    Select: (props: any) =>
      React.createElement(Select as any, { ...props, motion: false }),
    Toast: { success: vi.fn(), error: vi.fn() },
  };
});
vi.mock("../../api/expertService", () => ({
  getLoopWorkspaces: async () => [{ id: "workspace", name: "Workspace" }],
  getLoopRuntimes: api.runtimes,
  installExpertToLoop: api.install,
  installSquadToLoop: api.install,
  createLoopInstallationKey: () => "install-key",
}));
import ExpertAddToLoopModal from "../ExpertAddToLoopModal";

const ownedRuntimes = [
  {
    id: "runtime-A",
    name: "Codex (localhost)",
    status: "online",
    daemonId: "be44a7fd",
    deviceInfo: "localhost",
    provider: "codex",
  },
  {
    id: "runtime-B",
    name: "Claude (localhost)",
    status: "online",
    daemonId: "be44a7fd",
    deviceInfo: "localhost",
    provider: "claude",
  },
  {
    id: "runtime-C",
    name: "Codex (localhost)",
    status: "online",
    daemonId: "d5a751d2",
    deviceInfo: "localhost",
    provider: "codex",
  },
  {
    id: "runtime-D",
    name: "Codex (localhost)",
    status: "offline",
    daemonId: "d5a751d2",
    deviceInfo: "localhost",
    profileId: "profile",
    provider: "codex",
  },
];
let container: HTMLDivElement;
const item = { id: "expert", name: "Expert", kind: "expert" } as never;
const options = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const selected = () =>
  options().filter((option) => option.getAttribute("aria-selected") === "true");
const runtime = () =>
  container.querySelectorAll<HTMLElement>('[role="combobox"]')[1];
async function openRuntime() {
  act(() => {
    Simulate.click(runtime());
  });
  await vi.waitFor(() => expect(options()).toHaveLength(4));
}

beforeEach(() => {
  api.runtimes.mockReset().mockResolvedValue(ownedRuntimes);
  api.install.mockReset().mockResolvedValue({ agentId: "installed" });
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

it("marks only the selected runtime when names repeat, and installs the newly chosen ID", async () => {
  const close = vi.fn();
  await act(async () => {
    ReactDOM.render(
      <ExpertAddToLoopModal item={item} onClose={close} />,
      container
    );
  });
  await vi.waitFor(() => expect(runtime().textContent).toContain("be44a7fd"));
  await openRuntime();
  expect(selected()).toEqual([options()[0]]);
  expect(options()[0].getAttribute("aria-label")).toContain("be44a7fd");
  expect(options()[2].getAttribute("aria-label")).toContain("d5a751d2");
  expect(options()[3].getAttribute("aria-disabled")).toBe("true");

  // Scrolling must not make another equal-name option appear selected.
  act(() => {
    Simulate.scroll(options()[0].parentElement!);
  });
  expect(selected()).toEqual([options()[0]]);
  act(() => {
    Simulate.click(options()[2]);
  });
  await vi.waitFor(() =>
    expect(runtime().getAttribute("aria-expanded")).toBe("false")
  );
  expect(runtime().textContent).toContain("d5a751d2");
  await openRuntime();
  await vi.waitFor(() => expect(selected()).toEqual([options()[2]]));

  // Parent rerenders recreate the option labels; selection must remain correct.
  await act(async () => {
    ReactDOM.render(
      <ExpertAddToLoopModal item={item} onClose={close} />,
      container
    );
  });
  expect(selected()).toEqual([options()[2]]);
  act(() => {
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mcp.expert.confirmInstall"
    )!;
    confirm.click();
  });
  await vi.waitFor(() =>
    expect(api.install).toHaveBeenCalledWith("expert", {
      workspaceId: "workspace",
      runtimeId: "runtime-C",
      idempotencyKey: "install-key",
    })
  );
});

it("keeps unavailable configurations collapsed and supports keyboard selection and Escape", async () => {
  await act(async () => {
    ReactDOM.render(
      <ExpertAddToLoopModal item={item} onClose={vi.fn()} />,
      container
    );
  });
  await vi.waitFor(() => expect(runtime().textContent).toContain("be44a7fd"));
  await openRuntime();
  const details = document.querySelector("details")!;
  expect(details.open).toBe(false);
  act(() => {
    (details.querySelector("summary") as HTMLElement).click();
  });
  expect(details.open).toBe(true);
  expect(options()[3].hasAttribute("disabled")).toBe(true);
  act(() => {
    options()[0].focus();
    Simulate.keyDown(options()[0], { key: "End" });
  });
  expect(document.activeElement).toBe(options()[2]);
  act(() => {
    Simulate.keyDown(options()[2], { key: "Escape" });
  });
  await vi.waitFor(() =>
    expect(runtime().getAttribute("aria-expanded")).toBe("false")
  );
  expect(document.activeElement).toBe(runtime());
});

const sharedRuntime = {
  id: "shared",
  name: "Shared Codex",
  status: "online",
  provider: "codex",
  daemonId: "team-machine",
  deviceInfo: "Team machine",
  canBind: false,
  visibility: "workspace",
};
const privateRuntime = {
  ...sharedRuntime,
  id: "private",
  visibility: "private",
};
const scopeButton = (scope: string) =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".wk-loop-runtime-picker__scope button"
    )
  ).find((b) => b.textContent === `mcp.runtimePicker.${scope}`)!;
const confirm = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === "mcp.expert.confirmInstall"
  )!;
const renderModal = async () => {
  await act(async () => {
    ReactDOM.render(
      <ExpertAddToLoopModal item={item} onClose={vi.fn()} />,
      container
    );
  });
};

it("defaults to Mine, preserves the owned selection in All, and only installs an explicitly chosen shared runtime", async () => {
  api.runtimes.mockImplementation((_workspace, opts) =>
    Promise.resolve(
      opts.scope === "all"
        ? [sharedRuntime, privateRuntime, ...ownedRuntimes]
        : ownedRuntimes
    )
  );
  await renderModal();
  await vi.waitFor(() => expect(runtime().textContent).toContain("be44a7fd"));
  await openRuntime();
  expect(scopeButton("mine").getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[data-provider="codex"]')).not.toBeNull();
  expect(document.querySelector('[data-provider="claude"]')).not.toBeNull();
  act(() => {
    scopeButton("all").click();
  });
  await vi.waitFor(() => expect(options()).toHaveLength(6));
  expect(runtime().textContent).toContain("be44a7fd");
  expect(selected()).toHaveLength(1);
  expect(
    options()
      .find((o) => o.textContent?.includes("mcp.runtimePicker.notOwned"))
      ?.hasAttribute("disabled")
  ).toBe(true);
  const shared = options().find(
    (o) =>
      o.getAttribute("aria-label")?.includes("Team machine") &&
      !o.hasAttribute("disabled")
  )!;
  act(() => {
    shared.click();
  });
  await act(async () => {
    confirm().click();
  });
  expect(api.install).toHaveBeenCalledWith("expert", {
    workspaceId: "workspace",
    runtimeId: "shared",
    idempotencyKey: "install-key",
  });
});

it("does not default to another machine when Mine is empty and clears a shared selection when returning to Mine", async () => {
  api.runtimes.mockImplementation((_workspace, opts) =>
    Promise.resolve(opts.scope === "all" ? [sharedRuntime] : [])
  );
  await renderModal();
  await act(async () => {
    runtime().click();
  });
  act(() => {
    scopeButton("all").click();
  });
  await vi.waitFor(() => expect(options()).toHaveLength(1));
  expect(selected()).toHaveLength(0);
  expect(confirm().disabled).toBe(true);
  act(() => {
    options()[0].click();
  });
  expect(confirm().disabled).toBe(false);
  act(() => {
    runtime().click();
  });
  await vi.waitFor(() => expect(scopeButton("mine")).toBeTruthy());
  act(() => {
    scopeButton("mine").click();
  });
  expect(confirm().disabled).toBe(true);
  expect(runtime().textContent).toContain(
    "mcp.expert.selectRuntimePlaceholder"
  );
  expect(api.install).not.toHaveBeenCalled();
});

it("ignores an All response after switching back and keeps scope controls usable while loading", async () => {
  let resolveAll!: (rows: unknown[]) => void;
  api.runtimes.mockImplementation((_workspace, opts) =>
    opts.scope === "all"
      ? new Promise((resolve) => {
          resolveAll = resolve;
        })
      : Promise.resolve(ownedRuntimes)
  );
  await renderModal();
  await openRuntime();
  act(() => {
    scopeButton("all").click();
  });
  await vi.waitFor(() => expect(resolveAll).toBeTypeOf("function"));
  expect(confirm().disabled).toBe(true);
  act(() => {
    scopeButton("mine").click();
  });
  await act(async () => {
    resolveAll([sharedRuntime]);
  });
  expect(scopeButton("mine").getAttribute("aria-pressed")).toBe("true");
  expect(runtime().textContent).toContain("be44a7fd");
  expect(options()).toHaveLength(4);
});

it("shows All errors without treating an incomplete list as Mine and allows retry", async () => {
  api.runtimes.mockImplementation((_workspace, opts) =>
    opts.scope === "all"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(ownedRuntimes)
  );
  await renderModal();
  await openRuntime();
  act(() => {
    scopeButton("all").click();
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "mcp.runtimePicker.loadFailed"
    )
  );
  expect(confirm().disabled).toBe(true);
  act(() => {
    scopeButton("mine").click();
  });
  expect(confirm().disabled).toBe(false);
  api.runtimes.mockResolvedValue([sharedRuntime, ...ownedRuntimes]);
  act(() => {
    scopeButton("all").click();
  });
  await vi.waitFor(() => expect(options()).toHaveLength(5));
  expect(runtime().textContent).toContain("be44a7fd");
});
