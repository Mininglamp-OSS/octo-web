// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDetail } from "../bridge/types";

const state = vi.hoisted(() => ({
  getMessage: vi.fn(),
  getThread: vi.fn(),
  sendDraft: vi.fn(),
  restoreNotJunk: vi.fn(),
  emit: vi.fn(),
  modalConfirm: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: state.t, locale: "en-US" }),
  modalConfirm: state.modalConfirm,
  WKApp: {
    mittBus: { emit: state.emit },
    routeRight: { pop: vi.fn(), push: vi.fn() },
  },
}));

vi.mock("../Service/MailService", () => ({
  default: {
    getMessage: state.getMessage,
    getThread: state.getThread,
    getMessageDelivery: vi.fn(),
    updateKeywords: vi.fn(),
    restoreNotJunk: state.restoreNotJunk,
    deleteMessage: vi.fn(),
    sendDraft: state.sendDraft,
    getRawMessage: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

import MessageDetailFeature from "./MessageDetailFeature";

const draft: MessageDetail = {
  id: "E1",
  mailbox: "Drafts",
  subject: "Owner review",
  from: "bot@mail.imocto.cn",
  to: ["customer@example.com"],
  preview: "Please review",
  receivedAt: "2026-08-11T00:00:00Z",
  size: 128,
  keywords: [],
  unread: false,
  bodyText: "Please review",
  attachments: [],
  agentDraft: {
    outcome: "owner_confirmation_required",
    status: "pending_confirmation",
    draftType: "agent_pending_confirmation",
    draftId: "E1",
    draftSubject: "Owner review",
    draftVersion: 1,
  },
};

describe("MessageDetailFeature action errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getMessage.mockReset();
    state.sendDraft.mockReset();
    state.restoreNotJunk.mockReset();
    state.modalConfirm.mockReset();
    state.getThread.mockReset();
    state.getMessage.mockResolvedValue(draft);
  });

  afterEach(() => cleanup());

  it("shows a failed Draft send after the message has loaded", async () => {
    state.sendDraft.mockRejectedValue({ msg: "send failed" });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.sendDraft" })
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "send failed"
    );
    await waitFor(() => expect(state.sendDraft).toHaveBeenCalledTimes(1));
  });

  it("offers an owner-confirmed restore action only in Junk", async () => {
    const junkMessage: MessageDetail = {
      ...draft,
      mailbox: "Junk",
      from: "sender@example.com",
      agentDraft: undefined,
    };
    state.getMessage.mockResolvedValue(junkMessage);
    state.restoreNotJunk.mockResolvedValue({
      updated: "E1",
      senderAddress: "sender@example.com",
    });
    const onRestoredFromJunk = vi.fn();

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="junk"
        embedded
        onRestoredFromJunk={onRestoredFromJunk}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.notJunk" })
    );
    expect(state.restoreNotJunk).not.toHaveBeenCalled();
    expect(state.modalConfirm).toHaveBeenCalledTimes(1);
    const confirmation = state.modalConfirm.mock.calls[0][0];
    expect(confirmation.title).toBe("mail.confirm.notJunkTitle");

    await confirmation.onOk();

    expect(state.restoreNotJunk).toHaveBeenCalledWith("42", "E1");
    expect(onRestoredFromJunk).toHaveBeenCalledTimes(1);
    expect(state.emit).toHaveBeenCalledWith("mail-refresh");
  });

  it("keeps the Junk message when restoring it fails", async () => {
    const failure = { msg: "restore failed" };
    state.getMessage.mockResolvedValue({
      ...draft,
      mailbox: "Junk",
      from: "sender@example.com",
      agentDraft: undefined,
    });
    state.restoreNotJunk.mockRejectedValue(failure);
    const onRestoredFromJunk = vi.fn();

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="junk"
        embedded
        onRestoredFromJunk={onRestoredFromJunk}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.notJunk" })
    );
    const confirmation = state.modalConfirm.mock.calls[0][0];

    await act(async () => {
      await expect(confirmation.onOk()).rejects.toBe(failure);
    });

    expect(await screen.findByText("Owner review")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "restore failed"
    );
    expect(onRestoredFromJunk).not.toHaveBeenCalled();
    expect(state.emit).not.toHaveBeenCalledWith("mail-refresh");
  });

  it("does not show the restore action outside Junk", async () => {
    state.getMessage.mockResolvedValue({ ...draft, agentDraft: undefined });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="inbox"
      />
    );

    await screen.findByText("Owner review");
    expect(
      screen.queryByRole("button", { name: "mail.actions.notJunk" })
    ).toBeNull();
  });

  it("sends the explicit Agent Draft id instead of the message id", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      id: "message-E1",
      agentDraft: {
        ...draft.agentDraft!,
        draftId: "draft-E1",
      },
    });
    state.sendDraft.mockResolvedValue({
      submissionIds: ["S1"],
      messageId: "E2",
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="message-E1"
        mailboxRole="drafts"
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.sendDraft" })
    );

    await waitFor(() =>
      expect(state.sendDraft).toHaveBeenCalledWith("42", "draft-E1", 1)
    );
  });

  it("keeps the original Draft sendable but blocks editing a truncated attachment list", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      attachmentsTruncated: true,
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(
      (await screen.findByRole("button", {
        name: "mail.actions.editDraft",
      })) as HTMLButtonElement
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", {
        name: "mail.actions.sendDraft",
      }) as HTMLButtonElement
    ).toHaveProperty("disabled", false);
  });

  it("keeps the current message when one thread member fails to load", async () => {
    state.getMessage
      .mockResolvedValueOnce({ ...draft, threadId: "T1" })
      .mockRejectedValueOnce(new Error("member unavailable"));
    state.getThread.mockResolvedValue({
      id: "T1",
      messages: [
        { ...draft, id: "E1" },
        { ...draft, id: "E2" },
      ],
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("Owner review")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.getMessage).toHaveBeenCalledTimes(2);
  });

  it("caps full-message thread fan-out", async () => {
    state.getMessage.mockImplementation(async (_mailboxId, id) => ({
      ...draft,
      id,
      threadId: "T1",
    }));
    state.getThread.mockResolvedValue({
      id: "T1",
      messages: Array.from({ length: 50 }, (_, index) => ({
        ...draft,
        id: `E${index + 1}`,
      })),
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("Owner review")).toBeTruthy();
    await waitFor(() => expect(state.getMessage).toHaveBeenCalledTimes(20));
  });

  it("does not reparse HTML bodies when unrelated view state changes", async () => {
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    const htmlDraft = {
      ...draft,
      bodyText: undefined,
      bodyHtml: "<p>Please review</p>",
      threadId: "T1",
    };
    state.getMessage.mockImplementation(async (_mailboxContextId, id) => ({
      ...htmlDraft,
      id,
    }));
    state.getThread.mockResolvedValue({
      id: "T1",
      messages: [
        { ...htmlDraft, id: "E1" },
        { ...htmlDraft, id: "E2" },
      ],
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    await screen.findByText("Owner review");
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: /mail.reader.threadCount/ })
    );
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
