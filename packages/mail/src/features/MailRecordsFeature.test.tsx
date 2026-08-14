// @vitest-environment jsdom

import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDetail } from "../bridge/types";

const state = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  workspace: {} as Record<string, unknown>,
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en-US" }),
  WKApp: {
    mittBus: {
      on: vi.fn((event: string, handler: () => void) =>
        state.handlers.set(event, handler)
      ),
      off: vi.fn((event: string) => state.handlers.delete(event)),
    },
  },
}));

vi.mock("../bridge/useMailWorkspace", () => ({
  default: () => state.workspace,
}));

vi.mock("../ui/MailRecordsView", () => ({
  default: () => null,
}));

vi.mock("./MailReaderEmpty", () => ({
  default: () => null,
}));

vi.mock("./MessageDetailFeature", () => ({
  default: ({
    onCompose,
  }: {
    onCompose: (mode: "edit-draft", source: MessageDetail) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onCompose("edit-draft", {
          id: "E1",
          mailbox: "Drafts",
          subject: "Existing draft",
          from: "bot@mail.imocto.cn",
          to: ["owner@example.com"],
          preview: "Existing draft",
          receivedAt: "2026-08-12T00:00:00Z",
          size: 64,
          keywords: [],
          unread: false,
        })
      }
    >
      edit draft
    </button>
  ),
}));

vi.mock("./ComposerFeature", () => ({
  default: ({ source }: { source?: MessageDetail }) => {
    const [subject] = useState(source?.subject || "");
    return <input aria-label="composer subject" value={subject} readOnly />;
  },
}));

import MailRecordsFeature from "./MailRecordsFeature";
import {
  registerAgentMailboxSwitchGuard,
  resetAgentMailboxContextForTests,
} from "../bridge/mailboxContext";

describe("MailRecordsFeature composer sessions", () => {
  beforeEach(() => {
    resetAgentMailboxContextForTests();
    state.handlers.clear();
    state.workspace = {
      mailboxContextId: "mailbox-1",
      identity: { address: "bot@mail.imocto.cn" },
      mailboxes: [
        { id: "drafts", name: "Drafts", role: "drafts", total: 1, unread: 0 },
      ],
      selectedMailbox: "Drafts",
      messages: [{ id: "E1" }],
      selectedMessageId: "E1",
      selectMailbox: vi.fn(),
      selectMessage: vi.fn(),
      markMessageRead: vi.fn(),
      reload: vi.fn(),
      setSearch: vi.fn(),
      setUnreadOnly: vi.fn(),
      toggleStar: vi.fn(),
      setPage: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    resetAgentMailboxContextForTests();
  });

  it("starts a clean composer when Compose replaces an edited Draft", () => {
    render(<MailRecordsFeature initialRole="drafts" />);

    fireEvent.click(screen.getByRole("button", { name: "edit draft" }));
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("Existing draft");

    act(() => state.handlers.get("mail-compose")?.());
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("");
  });

  it("waits for dirty-composer approval before starting global Compose", () => {
    render(<MailRecordsFeature initialRole="drafts" />);
    fireEvent.click(screen.getByRole("button", { name: "edit draft" }));

    let proceed: (() => boolean) | undefined;
    registerAgentMailboxSwitchGuard((next) => {
      proceed = next;
      return false;
    });
    act(() => state.handlers.get("mail-compose")?.());
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("Existing draft");

    act(() => proceed?.());
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("");
  });

  it("keeps the current Composer while an in-flight operation vetoes replacement", () => {
    render(<MailRecordsFeature initialRole="drafts" />);
    fireEvent.click(screen.getByRole("button", { name: "edit draft" }));

    const guard = vi.fn(() => false);
    registerAgentMailboxSwitchGuard(guard);
    act(() => state.handlers.get("mail-compose")?.());

    expect(guard).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("Existing draft");
  });

  it("guards reader-driven Composer replacement too", () => {
    let proceed: (() => boolean) | undefined;
    registerAgentMailboxSwitchGuard((next) => {
      proceed = next;
      return false;
    });
    render(<MailRecordsFeature initialRole="drafts" initialCompose />);

    fireEvent.click(screen.getByRole("button", { name: "edit draft" }));
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("");

    act(() => proceed?.());
    expect(
      (screen.getByLabelText("composer subject") as HTMLInputElement).value
    ).toBe("Existing draft");
  });
});
