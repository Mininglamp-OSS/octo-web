// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMailbox } from "../bridge/types";
import type { MailAddressManagementViewProps } from "../ui/MailAddressManagementView";

const state = vi.hoisted(() => ({
  emit: vi.fn(),
  t: vi.fn(
    (key: string, _options?: { values?: Record<string, unknown> }): string =>
      key
  ),
  sanitizeShellSpaceId: vi.fn((value: string) => value),
  getRegistration: vi.fn(),
  createMailbox: vi.fn(),
  revokeBinding: vi.fn(),
  updateAutomation: vi.fn(),
  deleteMailbox: vi.fn(),
  shared: { currentSpaceId: "space-a" },
  viewProps: null as MailAddressManagementViewProps | null,
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: state.t }),
  UserService: { getUserProfile: vi.fn() },
  WKApp: {
    shared: state.shared,
    mittBus: { emit: state.emit },
    routeRight: { replaceToRoot: vi.fn(), push: vi.fn() },
  },
}));

vi.mock("@octo/base/src/Utils/spaceId", () => ({
  sanitizeShellSpaceId: state.sanitizeShellSpaceId,
}));

vi.mock("../Service/MailService", () => ({
  default: {
    getAgentMailboxRegistrationView: state.getRegistration,
    createAgentMailbox: state.createMailbox,
    revokeAgentMailboxBinding: state.revokeBinding,
    updateAgentMailboxAutomation: state.updateAutomation,
    deleteAgentMailbox: state.deleteMailbox,
  },
}));

vi.mock("../ui/MailAddressManagementView", () => ({
  default: (props: MailAddressManagementViewProps) => {
    state.viewProps = props;
    return null;
  },
}));

import MailAddressManagementFeature from "./MailAddressManagementFeature";
import {
  getAgentMailboxContext,
  replaceAgentMailboxContext,
  resetAgentMailboxContextForTests,
} from "../bridge/mailboxContext";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const mailboxA: AgentMailbox = {
  id: "mailbox-a",
  address: "support@mail.example.test",
  connectState: "connected",
  outboundMode: "manual_confirmation",
  deletable: true,
};

const mailboxB: AgentMailbox = {
  id: "mailbox-b",
  address: "sales@mail.example.test",
  connectState: "connected",
  outboundMode: "manual_confirmation",
};

describe("MailAddressManagementFeature", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentMailboxContextForTests();
    state.shared.currentSpaceId = "space-a";
    state.t.mockImplementation((key: string) => key);
    state.sanitizeShellSpaceId.mockImplementation((value: string) => value);
    state.viewProps = null;
    state.getRegistration.mockResolvedValue({
      mailboxes: [],
      registeredCount: 0,
      maxMailboxes: 2,
      addressDomain: "mail.example.test",
    });
    state.createMailbox.mockResolvedValue({
      id: "mailbox-1",
      address: "support@mail.example.test",
      connectState: "unconnected",
      outboundMode: "manual_confirmation",
    });
    container = document.createElement("div");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    resetAgentMailboxContextForTests();
  });

  it("refreshes the sidebar after creating a mailbox", async () => {
    await act(async () => {
      root.render(<MailAddressManagementFeature />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => state.viewProps?.onLocalpartChange("support"));
    await act(async () => {
      state.viewProps?.onCreate();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.createMailbox).toHaveBeenCalledWith("support");
    expect(state.emit).toHaveBeenCalledWith("mail-refresh");
  });

  it("switches from the existing OpenClaw prompt to the CLI prompt", async () => {
    await act(async () => {
      root.render(<MailAddressManagementFeature />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => state.viewProps?.onConnect(mailboxB));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.viewProps).toMatchObject({
      createdMailbox: mailboxB,
      setupMethod: "openclaw",
      setupPrompt: "mail.agentMailboxes.setupPrompt",
    });

    act(() => state.viewProps?.onSetupMethodChange("cli"));
    expect(state.viewProps).toMatchObject({
      createdMailbox: mailboxB,
      setupMethod: "cli",
      setupPrompt: "mail.agentMailboxes.cliSetupPrompt",
    });

    await act(async () => {
      state.viewProps?.onCopySetupPrompt();
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "mail.agentMailboxes.cliSetupPrompt"
    );
  });

  it("uses the shell-safe Space id for both setup prompts", async () => {
    state.shared.currentSpaceId = "space;id";
    state.sanitizeShellSpaceId.mockReturnValue("<space-id>");
    state.t.mockImplementation((key, options) => {
      if (
        key === "mail.agentMailboxes.setupPrompt" ||
        key === "mail.agentMailboxes.cliSetupPrompt"
      ) {
        return `${key}:${String(options?.values?.spaceId)}`;
      }
      return key;
    });

    await act(async () => {
      root.render(<MailAddressManagementFeature />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => state.viewProps?.onConnect(mailboxB));
    expect(state.sanitizeShellSpaceId).toHaveBeenCalledWith("space;id");
    expect(state.viewProps?.setupPrompt).toBe(
      "mail.agentMailboxes.setupPrompt:<space-id>"
    );

    act(() => state.viewProps?.onSetupMethodChange("cli"));
    expect(state.viewProps?.setupPrompt).toBe(
      "mail.agentMailboxes.cliSetupPrompt:<space-id>"
    );
  });

  it("ignores a stale copy result after switching setup methods", async () => {
    const clipboardWrite = deferred<void>();
    vi.mocked(navigator.clipboard.writeText).mockReturnValue(
      clipboardWrite.promise
    );

    await act(async () => {
      root.render(<MailAddressManagementFeature />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => state.viewProps?.onConnect(mailboxB));
    act(() => {
      state.viewProps?.onCopySetupPrompt();
      state.viewProps?.onSetupMethodChange("cli");
    });

    await act(async () => {
      clipboardWrite.resolve();
      await clipboardWrite.promise;
    });

    expect(state.viewProps).toMatchObject({
      setupMethod: "cli",
      promptCopied: false,
    });

    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
    await act(async () => {
      state.viewProps?.onCopySetupPrompt();
      await Promise.resolve();
    });
    expect(state.viewProps?.promptCopied).toBe(true);
  });

  it.each(["disconnect", "automation", "delete"] as const)(
    "does not let a stale %s response restore the previous Space context",
    async (operation) => {
      const response = deferred<unknown>();
      state.getRegistration.mockResolvedValue({
        mailboxes: [mailboxA],
        registeredCount: 1,
        maxMailboxes: 2,
        addressDomain: "mail.example.test",
      });
      state.revokeBinding.mockReturnValue(response.promise);
      state.updateAutomation.mockReturnValue(response.promise);
      state.deleteMailbox.mockReturnValue(response.promise);
      replaceAgentMailboxContext({ spaceId: "space-a", mailbox: mailboxA });

      await act(async () => {
        root.render(<MailAddressManagementFeature />);
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        if (operation === "disconnect") {
          state.viewProps?.onDisconnect(mailboxA);
        } else if (operation === "automation") {
          state.viewProps?.onAutomationChange(mailboxA, "automatic_send");
        } else {
          state.viewProps?.onDelete(mailboxA);
        }
      });
      act(() => state.viewProps?.onConfirmPendingAction());

      if (operation === "disconnect") {
        expect(state.revokeBinding).toHaveBeenCalledWith(mailboxA.id);
      } else if (operation === "automation") {
        expect(state.updateAutomation).toHaveBeenCalledWith(
          mailboxA.id,
          "automatic_send"
        );
      } else {
        expect(state.deleteMailbox).toHaveBeenCalledWith(mailboxA.id);
      }

      state.shared.currentSpaceId = "space-b";
      act(() =>
        replaceAgentMailboxContext({ spaceId: "space-b", mailbox: mailboxB })
      );
      await act(async () => {
        response.resolve(
          operation === "automation"
            ? { ...mailboxA, outboundMode: "automatic_send" }
            : undefined
        );
        await response.promise;
        await Promise.resolve();
      });

      expect(getAgentMailboxContext()).toEqual({
        spaceId: "space-b",
        mailbox: mailboxB,
      });
    }
  );

  it.each(["automation-first", "disconnect-first"] as const)(
    "keeps operation-owned mailbox fields when %s responses complete out of order",
    async (completionOrder) => {
      const disconnectResponse = deferred<void>();
      const automationResponse = deferred<AgentMailbox>();
      state.getRegistration.mockResolvedValue({
        mailboxes: [mailboxA],
        registeredCount: 1,
        maxMailboxes: 2,
        addressDomain: "mail.example.test",
      });
      state.revokeBinding.mockReturnValue(disconnectResponse.promise);
      state.updateAutomation.mockReturnValue(automationResponse.promise);
      replaceAgentMailboxContext({ spaceId: "space-a", mailbox: mailboxA });

      await act(async () => {
        root.render(<MailAddressManagementFeature />);
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => state.viewProps?.onDisconnect(mailboxA));
      act(() => state.viewProps?.onConfirmPendingAction());
      act(() =>
        state.viewProps?.onAutomationChange(mailboxA, "automatic_send")
      );
      act(() => state.viewProps?.onConfirmPendingAction());

      const resolveAutomation = async () => {
        await act(async () => {
          automationResponse.resolve({
            ...mailboxA,
            connectState: "connected",
            outboundMode: "automatic_send",
          });
          await automationResponse.promise;
          await Promise.resolve();
        });
      };
      const resolveDisconnect = async () => {
        await act(async () => {
          disconnectResponse.resolve();
          await disconnectResponse.promise;
          await Promise.resolve();
        });
      };

      if (completionOrder === "automation-first") {
        await resolveAutomation();
        await resolveDisconnect();
      } else {
        await resolveDisconnect();
        await resolveAutomation();
      }

      expect(state.viewProps?.mailboxes[0]).toMatchObject({
        id: mailboxA.id,
        connectState: "unconnected",
        outboundMode: "automatic_send",
      });
      expect(getAgentMailboxContext()?.mailbox).toMatchObject({
        id: mailboxA.id,
        connectState: "unconnected",
        outboundMode: "automatic_send",
      });
    }
  );
});
