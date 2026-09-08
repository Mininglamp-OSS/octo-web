// @vitest-environment jsdom
//
// Per-file mocks + React 17 ReactDOM.render, matching this package's other
// component suites (dmworkmcp has no vitest config).
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const busHandlers: Record<string, Array<(payload?: unknown) => void>> = {};
function emitBus(event: string, payload?: unknown) {
  for (const handler of [...(busHandlers[event] ?? [])]) handler(payload);
}

const updateMcp = vi.fn();
const createMcp = vi.fn();
const publishPluginListing = vi.fn();

vi.mock("@dmwork/skillmarket", () => ({
  versionErrorKey: () => undefined,
}));

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  Dap: { shared: { track: vi.fn() } },
  WKApp: {
    mittBus: {
      on: (event: string, handler: (payload?: unknown) => void) => {
        (busHandlers[event] ??= []).push(handler);
      },
      off: (event: string, handler: (payload?: unknown) => void) => {
        busHandlers[event] = (busHandlers[event] ?? []).filter((fn) => fn !== handler);
      },
      emit: emitBus,
    },
  },
  WKInput: (p: Record<string, unknown>) => <input {...(p as object)} />,
  WKButton: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  WKModal: ({
    visible,
    children,
    footer,
  }: {
    visible?: boolean;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) => (visible ? <div>{children}{footer}</div> : null),
}));

vi.mock("@douyinfe/semi-ui", () => {
  const Select = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  (Select as unknown as Record<string, unknown>).Option = ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>;
  return {
    Select,
    Switch: () => <input type="checkbox" />,
    TextArea: (p: Record<string, unknown>) => <textarea {...(p as object)} />,
    Toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
  };
});

vi.mock("../../api/mcpService", () => ({
  buildConnectorReviewContent: vi.fn(),
  createMcp: (...a: unknown[]) => createMcp(...a),
  listConnectorCategories: () => Promise.resolve([]),
  probeMcpTools: vi.fn(),
  isProbeAvailable: () => false,
  updateMcp: (...a: unknown[]) => updateMcp(...a),
  uploadMcpIcon: vi.fn(),
}));
vi.mock("../../api/pluginReview", () => ({
  publishPluginListing: (...a: unknown[]) => publishPluginListing(...a),
  submitPluginReview: vi.fn(),
}));
vi.mock("../ReviewSubmitModal", () => ({ bumpPatch: (v: string) => v }));

import McpCreateModal from "../McpCreateModal";

let container: HTMLDivElement | null = null;

// Enough of an McpDetail to prefill the form so the pre-submit validation
// passes without driving every input. `detailToForm` seeds transport / url /
// command from `quickStart`; `category` is separately required.
const editing = {
  id: "mcp-old-space",
  name: "Old Space Connector",
  description: "desc",
  slogan: "slogan",
  version: "1.0.0",
  visibility: "private",
  category: "dev",
  tags: [],
  faqs: [],
  usageExamples: [],
  notes: [],
  tools: [],
  quickStart: {
    slug: "old-space-connector",
    // A remote transport, so no `command` is required.
    transport: "sse",
    url: "https://example.invalid/sse",
    args: [],
  },
} as never;

function buttons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll("button")] as HTMLButtonElement[];
}
function button(label: string): HTMLButtonElement {
  const found = buttons().find((b) => b.textContent === label);
  if (!found) {
    throw new Error(
      `no button labelled ${label}; have: ` +
        buttons().map((b) => JSON.stringify(b.textContent)).join(", ")
    );
  }
  return found;
}

// A private record: saving leaves a draft behind, so the secondary footer
// action renders as 保存草稿.
const SAVE = "skillMarket.plugin.actionSaveDraft";

// The form is a three-step wizard; the submit action only exists on the last
// step. In edit mode every step is already prefilled, so the step header can be
// clicked straight through.
async function gotoLastStep() {
  const tab = buttons().find((b) => (b.textContent ?? "").includes("stepDocs"));
  if (!tab) throw new Error("no step-3 header");
  await act(async () => {
    tab.click();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
  for (const key of Object.keys(busHandlers)) delete busHandlers[key];
  vi.clearAllMocks();
});

/**
 * `handleSubmit` chains an icon upload, the record write and a publish across
 * several awaits. A Space switch mid-chain must abandon it: the modal now
 * belongs to the new Space, so reporting the old Space's write into it — or
 * remembering the written plugin id for a later publish press — would be a
 * cross-Space state mutation.
 */
describe("McpCreateModal space-switch guard", () => {
  it("abandons an edit save whose write settles after a Space switch", async () => {
    let settle: (() => void) | undefined;
    updateMcp.mockImplementation(
      () => new Promise((resolve) => { settle = () => resolve(editing); })
    );
    const onSaved = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      ReactDOM.render(
        <McpCreateModal
          visible
          editing={editing}
          onClose={onClose}
          onSaved={onSaved}
        />,
        container
      );
    });

    await gotoLastStep();
    await act(async () => {
      button(SAVE).click();
    });
    expect(updateMcp).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitBus("space-changed", { space_id: "space-b", role: 1 });
    });
    await act(async () => {
      settle?.();
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still reports an edit save that settles inside the same Space", async () => {
    updateMcp.mockResolvedValue(editing);
    const onSaved = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      ReactDOM.render(
        <McpCreateModal
          visible
          editing={editing}
          onClose={onClose}
          onSaved={onSaved}
        />,
        container
      );
    });
    await gotoLastStep();
    await act(async () => {
      button(SAVE).click();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops listening once unmounted", async () => {
    await act(async () => {
      ReactDOM.render(
        <McpCreateModal visible onClose={vi.fn()} onSaved={vi.fn()} />,
        container
      );
    });

    act(() => {
      ReactDOM.unmountComponentAtNode(container!);
    });

    expect(busHandlers["space-changed"] ?? []).toHaveLength(0);
  });
});
