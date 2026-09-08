// @vitest-environment jsdom
//
// dmworkmcp has no vitest config (no jsdom env, no `@octo/base` alias), hence
// the pragma above and the per-file `vi.mock`s below — same shape as
// McpDetailModal.inlineDelete.test.tsx. React is pinned to 17 here, so this
// drives ReactDOM.render + react-dom/test-utils act rather than RTL.
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// Real subscription bookkeeping rather than a bare spy: this suite has to
// INVOKE the `space-changed` handler the modal registered.
const busHandlers: Record<string, Array<(payload?: unknown) => void>> = {};
function emitBus(event: string, payload?: unknown) {
  for (const handler of [...(busHandlers[event] ?? [])]) handler(payload);
}

const updateExpertVisibility = vi.fn();
const publishPluginListing = vi.fn();

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
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

vi.mock("../../api/expertService", () => ({
  updateExpertVisibility: (...a: unknown[]) => updateExpertVisibility(...a),
}));
vi.mock("../../api/pluginReview", () => ({
  publishPluginListing: (...a: unknown[]) => publishPluginListing(...a),
}));
vi.mock("lucide-react", () => ({
  AlertCircle: () => null,
  Bot: () => null,
  UserRound: () => null,
  Users: () => null,
}));

import ExpertEditModal from "../ExpertEditModal";

let container: HTMLDivElement | null = null;

const item = {
  id: "expert-old-space",
  name: "Old Space Expert",
  visibility: "private",
  version: "1.0.0",
} as never;

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find(
    (b) => b.textContent === label
  );
  if (!found) {
    const have = [...container!.querySelectorAll("button")]
      .map((b) => JSON.stringify(b.textContent))
      .join(", ");
    throw new Error(`no button labelled ${label}; have: ${have}`);
  }
  return found as HTMLButtonElement;
}

// Declaring 组织可见 on a private record means the save leaves a draft behind
// pending review, so the secondary action renders as 保存草稿 rather than 保存.
const SAVE = "skillMarket.plugin.actionSaveDraft";

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
 * `submit` is a multi-`await` mutation chain: the visibility write, then
 * optionally the publish, then `onSaved` / `onClose`. A Space switch landing
 * between those awaits must abandon the chain — the modal now belongs to the
 * new Space, so reporting the old Space's write into it (or closing it) is a
 * cross-Space state mutation. Mirrors the generation guard `ReviewSubmitModal`
 * uses for target switches.
 */
describe("ExpertEditModal space-switch guard", () => {
  it("abandons a save whose write settles after a Space switch", async () => {
    let settle: (() => void) | undefined;
    updateExpertVisibility.mockImplementation(
      () => new Promise<void>((resolve) => { settle = () => resolve(); })
    );
    const onSaved = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      ReactDOM.render(
        <ExpertEditModal
          item={item}
          onClose={onClose}
          onSaved={onSaved}
          onEditContent={vi.fn()}
        />,
        container
      );
    });

    // Declaring a different audience is what makes the save button live.
    await act(async () => {
      (container!.querySelector(
        'input[name="expert-edit-visibility"][value="space"]'
      ) as HTMLInputElement).click();
    });

    await act(async () => {
      button(SAVE).click();
    });
    expect(updateExpertVisibility).toHaveBeenCalledTimes(1);

    // The user leaves the Space while the write is still in flight.
    await act(async () => {
      emitBus("space-changed", { space_id: "space-b", role: 1 });
    });
    await act(async () => {
      settle?.();
    });

    // Neither the success report nor the close may land on the new Space's modal.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still reports a save that settles inside the same Space", async () => {
    updateExpertVisibility.mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      ReactDOM.render(
        <ExpertEditModal
          item={item}
          onClose={onClose}
          onSaved={onSaved}
          onEditContent={vi.fn()}
        />,
        container
      );
    });
    await act(async () => {
      (container!.querySelector(
        'input[name="expert-edit-visibility"][value="space"]'
      ) as HTMLInputElement).click();
    });
    await act(async () => {
      button(SAVE).click();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops listening once unmounted", async () => {
    await act(async () => {
      ReactDOM.render(
        <ExpertEditModal
          item={item}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onEditContent={vi.fn()}
        />,
        container
      );
    });

    act(() => {
      ReactDOM.unmountComponentAtNode(container!);
    });

    expect(busHandlers["space-changed"] ?? []).toHaveLength(0);
  });
});
