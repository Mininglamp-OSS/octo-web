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
  downloadAttachment: vi.fn(),
  sendMessage: vi.fn(),
  updateDraft: vi.fn(),
  sendDraft: vi.fn(),
  emit: vi.fn(),
  modalConfirm: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: state.t }),
  modalConfirm: state.modalConfirm,
  WKApp: {
    mittBus: { emit: state.emit },
    routeRight: { pop: vi.fn() },
  },
}));

vi.mock("../Service/MailService", () => ({
  default: {
    downloadAttachment: state.downloadAttachment,
    sendMessage: state.sendMessage,
    updateDraft: state.updateDraft,
    sendDraft: state.sendDraft,
    createDraft: vi.fn(),
    forward: vi.fn(),
    replyAll: vi.fn(),
    reply: vi.fn(),
  },
}));

import ComposerFeature from "./ComposerFeature";
import { requestMailWorkspaceSwitch } from "../bridge/mailboxContext";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const draft: MessageDetail = {
  id: "E1",
  mailbox: "Drafts",
  subject: "Draft with attachment",
  from: "bot@mail.imocto.cn",
  to: ["owner@example.com"],
  preview: "Draft",
  receivedAt: "2026-08-10T10:00:00Z",
  size: 128,
  keywords: [],
  unread: false,
  bodyText: "Please review",
  attachments: [
    {
      partId: "1.2",
      filename: "report.txt",
      contentType: "text/plain",
      size: 12,
    },
  ],
};

describe("ComposerFeature safety boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.sendMessage.mockResolvedValue({
      submissionIds: ["S1"],
      messageId: "E2",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps Draft save and send disabled when an existing attachment cannot load", async () => {
    state.downloadAttachment.mockRejectedValue(new Error("attachment failed"));

    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={draft}
      />
    );

    await waitFor(() =>
      expect(state.downloadAttachment).toHaveBeenCalledWith("42", "E1", "1.2")
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "mail.actions.save",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)
    );
    expect(
      (
        screen.getByRole("button", {
          name: "mail.actions.send",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(state.updateDraft).not.toHaveBeenCalled();
    expect(state.sendDraft).not.toHaveBeenCalled();
  });

  it("does not offer Draft save while existing attachments are still loading", async () => {
    const attachment = deferred<Blob>();
    const proceed = vi.fn();
    state.downloadAttachment.mockReturnValue(attachment.promise);

    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={draft}
      />
    );

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);

    expect(requestMailWorkspaceSwitch(proceed)).toBe(false);
    expect(state.modalConfirm).toHaveBeenCalledTimes(1);
    const confirmation = state.modalConfirm.mock.calls[0][0];
    expect(confirmation.okText).toBe("mail.actions.discard");
    expect(confirmation.cancelText).toBe("mail.actions.continueEditing");
    expect(confirmation.onCancel).toBeUndefined();
    expect(state.updateDraft).not.toHaveBeenCalled();
    expect(proceed).not.toHaveBeenCalled();

    attachment.resolve(new Blob(["report data"], { type: "text/plain" }));
    await waitFor(() => expect(screen.getByText(/report\.txt/)).toBeTruthy());
    await waitFor(() => expect(fileInput.disabled).toBe(false));
  });

  it("waits for a newly selected attachment before sending or navigating", async () => {
    const readers: Array<{
      result: string | ArrayBuffer | null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null;
    }> = [];
    class DeferredFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL() {
        readers.push(this);
      }
    }
    vi.stubGlobal("FileReader", DeferredFileReader);

    render(
      <ComposerFeature
        mode="new"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
      />
    );
    fireEvent.change(screen.getByLabelText("mail.compose.to"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("mail.compose.body"), {
      target: { value: "Hello" },
    });

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["report data"], "report.txt", { type: "text/plain" }),
        ],
      },
    });

    expect(readers).toHaveLength(1);
    const send = screen.getByRole("button", {
      name: "mail.actions.send",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const proceed = vi.fn();
    expect(requestMailWorkspaceSwitch(proceed)).toBe(false);
    expect(proceed).not.toHaveBeenCalled();
    fireEvent.click(send);
    expect(state.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      readers[0]!.result = "data:text/plain;base64,cmVwb3J0IGRhdGE=";
      readers[0]!.onload?.(
        new ProgressEvent("load") as ProgressEvent<FileReader>
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(send.disabled).toBe(false));
    expect(screen.getByText(/report\.txt/)).toBeTruthy();
    fireEvent.click(send);
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledTimes(1));
    expect(state.sendMessage.mock.calls[0]?.[1]?.attachments).toEqual([
      {
        filename: "report.txt",
        contentType: "text/plain",
        content: "cmVwb3J0IGRhdGE=",
      },
    ]);
  });

  it("does not replace a Draft when its attachment list is truncated", async () => {
    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={{ ...draft, attachmentsTruncated: true }}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("mail.attachment.incompleteDraft")).toBeTruthy()
    );
    expect(state.downloadAttachment).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "mail.actions.save",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "mail.actions.send",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(state.updateDraft).not.toHaveBeenCalled();
    expect(state.sendDraft).not.toHaveBeenCalled();
  });

  it("opens an HTML-only Draft as readable plain text", () => {
    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={{
          ...draft,
          bodyText: "",
          bodyHtml: "<p>Hello</p><p>Owner</p>",
          attachments: [],
        }}
      />
    );

    expect(
      (screen.getByLabelText("mail.compose.body") as HTMLTextAreaElement).value
    ).toBe("Hello\nOwner");
  });

  it("preserves an HTML Draft when its body text was not edited", async () => {
    state.updateDraft.mockResolvedValue({ id: "E2", draftVersion: 1 });
    state.sendDraft.mockResolvedValue({ submissionIds: ["S1"], messageId: "E3" });
    const bodyHtml = "<p>Hello</p><p><strong>Owner</strong></p>";

    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={{
          ...draft,
          bodyText: "",
          bodyHtml,
          attachments: [],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.send" }));
    await waitFor(() => expect(state.updateDraft).toHaveBeenCalledTimes(1));
    expect(state.updateDraft.mock.calls[0]?.[2]).toMatchObject({
      text: "Hello\nOwner",
      html: bodyHtml,
    });
  });

  it("clears stale HTML when the owner edits the plain-text body", async () => {
    state.updateDraft.mockResolvedValue({ id: "E2", draftVersion: 1 });
    state.sendDraft.mockResolvedValue({ submissionIds: ["S1"], messageId: "E3" });

    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={{
          ...draft,
          bodyText: "",
          bodyHtml: "<p>Hello <strong>Owner</strong></p>",
          attachments: [],
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("mail.compose.body"), {
      target: { value: "Updated text" },
    });

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.send" }));
    await waitFor(() => expect(state.updateDraft).toHaveBeenCalledTimes(1));
    expect(state.updateDraft.mock.calls[0]?.[2]).toMatchObject({
      text: "Updated text",
      html: "",
    });
  });

  it("keeps an ambiguously submitted Draft immutable across retries", async () => {
    state.updateDraft.mockResolvedValueOnce({ id: "E2", draftVersion: 2 });
    state.sendDraft
      .mockRejectedValueOnce({ status: 503, code: "service_unavailable" })
      .mockResolvedValueOnce({ submissionIds: ["S1"], messageId: "E4" });

    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={{
          ...draft,
          id: "message-E1",
          attachments: [],
          agentDraft: {
            outcome: "owner_confirmation_required",
            status: "pending_confirmation",
            draftType: "agent_pending_confirmation",
            draftId: "draft-E1",
            draftSubject: draft.subject,
            draftVersion: 1,
          },
        }}
      />
    );

    const send = screen.getByRole("button", {
      name: "mail.actions.send",
    });
    fireEvent.click(send);
    await waitFor(() => expect(state.sendDraft).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((send as HTMLButtonElement).disabled).toBe(false)
    );

    fireEvent.click(send);
    await waitFor(() => expect(state.sendDraft).toHaveBeenCalledTimes(2));

    expect(state.updateDraft.mock.calls[0]?.[1]).toBe("draft-E1");
    expect(state.updateDraft.mock.calls[0]?.[2]?.draftVersion).toBe(1);
    expect(state.sendDraft.mock.calls[0]).toEqual(["42", "E2", 2]);
    expect(state.updateDraft).toHaveBeenCalledTimes(1);
    expect(state.sendDraft.mock.calls[1]).toEqual(["42", "E2", 2]);
    expect(
      (screen.getByLabelText("mail.compose.body") as HTMLTextAreaElement)
        .disabled
    ).toBe(true);
  });

  it("unlocks a Draft after a definite server rejection", async () => {
    state.updateDraft
      .mockResolvedValueOnce({ id: "E2", draftVersion: 2 })
      .mockResolvedValueOnce({ id: "E3", draftVersion: 3 });
    state.sendDraft
      .mockRejectedValueOnce({ status: 422, code: "no_recipients" })
      .mockResolvedValueOnce({ submissionIds: ["S1"], messageId: "E4" });

    render(
      <ComposerFeature
        mode="edit-draft"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        source={{ ...draft, attachments: [] }}
      />
    );

    const send = screen.getByRole("button", { name: "mail.actions.send" });
    fireEvent.click(send);
    await waitFor(() => expect(state.sendDraft).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("mail.compose.body") as HTMLTextAreaElement)
          .disabled
      ).toBe(false)
    );

    fireEvent.change(screen.getByLabelText("mail.compose.body"), {
      target: { value: "Please review again" },
    });
    fireEvent.click(send);
    await waitFor(() => expect(state.sendDraft).toHaveBeenCalledTimes(2));
    expect(state.updateDraft).toHaveBeenCalledTimes(2);
    expect(state.updateDraft.mock.calls[1]?.[1]).toBe("E2");
    expect(state.updateDraft.mock.calls[1]?.[2]?.draftVersion).toBe(2);
  });

  it("locks the send action immediately after success until the composer closes", async () => {
    vi.useFakeTimers();
    const sent = deferred<{ submissionIds: string[]; messageId: string }>();
    const onClose = vi.fn();
    state.sendMessage.mockReturnValue(sent.promise);

    render(
      <ComposerFeature
        mode="new"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        onClose={onClose}
      />
    );
    fireEvent.change(screen.getByLabelText("mail.compose.to"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("mail.compose.body"), {
      target: { value: "Hello" },
    });

    fireEvent.click(screen.getByRole("button", { name: "mail.actions.send" }));
    await act(async () => {
      sent.resolve({ submissionIds: ["S1"], messageId: "E2" });
      await sent.promise;
    });

    const sendButton = screen.getByRole("button", {
      name: "mail.actions.send",
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.click(sendButton);
    expect(state.sendMessage).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(450));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("vetoes workspace navigation while send completion is unknown", async () => {
    vi.useFakeTimers();
    const sent = deferred<{ submissionIds: string[]; messageId: string }>();
    state.sendMessage.mockReturnValue(sent.promise);
    render(
      <ComposerFeature
        mode="new"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
      />
    );
    fireEvent.change(screen.getByLabelText("mail.compose.to"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("mail.compose.body"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "mail.actions.send" }));

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    const proceed = vi.fn();
    expect(requestMailWorkspaceSwitch(proceed)).toBe(false);
    expect(proceed).not.toHaveBeenCalled();
    expect(state.modalConfirm).not.toHaveBeenCalled();

    await act(async () => {
      sent.resolve({ submissionIds: ["S1"], messageId: "E2" });
      await sent.promise;
    });

    expect(requestMailWorkspaceSwitch(proceed)).toBe(false);
    expect(proceed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(450));
  });

  it("cancels the delayed close when the composer unmounts", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const view = render(
      <ComposerFeature
        mode="new"
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText("mail.compose.to"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("mail.compose.body"), {
      target: { value: "Hello" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "mail.actions.send" })
      );
      await Promise.resolve();
    });

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    view.unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(onClose).not.toHaveBeenCalled();
  });
});
