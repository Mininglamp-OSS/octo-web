// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import MailAddressManagementView, {
  type MailAddressManagementViewProps,
} from ".";

describe("MailAddressManagementView automation mode", () => {
  const containers: Array<{ container: HTMLElement; root: Root }> = [];

  afterEach(() => {
    for (const { container, root } of containers) {
      act(() => root.unmount());
      container.remove();
    }
    containers.length = 0;
  });

  it("shows an independent mode control only for connected mailboxes", () => {
    const onAutomationChange = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    containers.push({ container, root });
    document.body.appendChild(container);

    act(() => {
      root.render(<MailAddressManagementView {...props(onAutomationChange)} />);
    });

    const selectors = Array.from(container.querySelectorAll("select"));
    expect(selectors).toHaveLength(2);
    expect(selectors.map((select) => select.value)).toEqual([
      "manual_confirmation",
      "automatic_send",
    ]);

    act(() => {
      selectors[0]!.value = "automatic_send";
      selectors[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      selectors[1]!.value = "manual_confirmation";
      selectors[1]!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAutomationChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "manual" }),
      "automatic_send"
    );
    expect(onAutomationChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "auto" }),
      "manual_confirmation"
    );
  });

  it("disables mailbox creation at the server-provided Space limit", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    containers.push({ container, root });
    document.body.appendChild(container);
    const limitedProps = props(vi.fn());
    limitedProps.maxMailboxes = limitedProps.mailboxes.length;
    limitedProps.localpart = "another";

    act(() => {
      root.render(<MailAddressManagementView {...limitedProps} />);
    });

    const input = container.querySelector("input");
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("mail.addresses.create")
    );
    expect(input?.disabled).toBe(true);
    expect(createButton?.disabled).toBe(true);
  });
});

function props(
  onAutomationChange: MailAddressManagementViewProps["onAutomationChange"]
): MailAddressManagementViewProps {
  return {
    mailboxes: [
      {
        id: "manual",
        address: "manual@example.test",
        connectState: "connected",
        outboundMode: "manual_confirmation",
      },
      {
        id: "auto",
        address: "auto@example.test",
        connectState: "connected",
        outboundMode: "automatic_send",
      },
      {
        id: "unconnected",
        address: "unconnected@example.test",
        connectState: "unconnected",
        outboundMode: "manual_confirmation",
      },
    ],
    loading: false,
    submitting: false,
    error: "",
    actionError: "",
    localpart: "",
    domain: "example.test",
    maxMailboxes: 4,
    copiedId: "",
    createdMailbox: null,
    setupPrompt: "",
    promptCopied: false,
    disconnectingId: "",
    deletingId: "",
    updatingAutomationId: "",
    pendingConfirmation: null,
    currentMailboxId: "manual",
    t: (key) =>
      ({
        "mail.agentMailboxes.manualReviewMode": "人工确认",
        "mail.agentMailboxes.automaticSendMode": "自动发信",
        "mail.agentMailboxes.outboundMode": "发信模式",
      }[key] ?? key),
    onLocalpartChange: vi.fn(),
    onCreate: vi.fn(),
    onCopy: vi.fn(),
    onCopySetupPrompt: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDelete: vi.fn(),
    onAutomationChange,
    onConfirmPendingAction: vi.fn(),
    onCancelPendingAction: vi.fn(),
    onSelectMailbox: vi.fn(),
    onManageRules: vi.fn(),
    onCloseSetup: vi.fn(),
    onRefresh: vi.fn(),
  };
}
