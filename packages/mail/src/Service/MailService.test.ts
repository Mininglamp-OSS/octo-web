import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  config: { apiURL: "" },
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@octo/base/src/Service/APIClient", () => ({
  default: { shared: api },
}));

import MailService, {
  MAIL_REQUEST_TIMEOUT_MS,
  resolveMailApiRoot,
} from "./MailService";

describe("MailService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.config.apiURL = "";
  });

  it("resolves a same-origin API URL without inheriting the OCTO API base path", () => {
    expect(resolveMailApiRoot("http://localhost:28080")).toBe(
      "http://localhost:28080/mail-api/webapi/v0"
    );
    expect(resolveMailApiRoot()).toBe("/mail-api/webapi/v0");
  });

  it("uses the configured OCTO origin for packaged desktop pages", () => {
    expect(resolveMailApiRoot("null", "https://octo.example.com/api/v1/")).toBe(
      "https://octo.example.com/v1/mail-gateway/webapi/v0"
    );
    expect(
      resolveMailApiRoot("file://", "https://octo.example.com/api/v1/")
    ).toBe("https://octo.example.com/v1/mail-gateway/webapi/v0");
  });

  it("lists mailboxes through the stable gateway path", async () => {
    api.get.mockResolvedValue({
      mailboxes: [{ id: "1", name: "Inbox", total: 2, unread: 1 }],
    });

    await expect(MailService.listMailboxes("42")).resolves.toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith("/mail-api/webapi/v0/mailboxes", {
      headers: { "X-Octo-Mailbox-ID": "42" },
      timeout: MAIL_REQUEST_TIMEOUT_MS,
    });
  });

  it("loads the authenticated mailbox identity", async () => {
    api.get.mockResolvedValue({ address: "agent@example.com" });

    await expect(MailService.getIdentity("42")).resolves.toEqual({
      address: "agent@example.com",
    });
    expect(api.get).toHaveBeenCalledWith("/mail-api/webapi/v0/identity", {
      headers: { "X-Octo-Mailbox-ID": "42" },
      timeout: MAIL_REQUEST_TIMEOUT_MS,
    });
  });

  it("manages mailbox aliases through account-scoped routes", async () => {
    api.get.mockResolvedValue({ addresses: [] });
    api.post.mockResolvedValue({
      id: "2",
      address: "alerts@example.com",
      primary: false,
    });

    await expect(MailService.listAddresses("42")).resolves.toEqual([]);
    await MailService.createAddress("42", "alerts");
    await MailService.deleteAddress("42", "2");

    const selected = {
      headers: { "X-Octo-Mailbox-ID": "42" },
      timeout: MAIL_REQUEST_TIMEOUT_MS,
    };
    expect(api.get).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/addresses",
      selected
    );
    expect(api.post).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/addresses",
      { localpart: "alerts" },
      selected
    );
    expect(api.delete).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/addresses/2",
      selected
    );
  });

  it("creates independent Agent mailboxes through the management route", async () => {
    api.get.mockResolvedValue({
      mailboxes: [],
      registeredCount: 0,
      maxMailboxes: 2,
      addressDomain: "example.com",
    });
    api.post.mockResolvedValue({
      id: "2",
      address: "support@example.com",
      connectState: "unconnected",
    });

    await expect(
      MailService.getAgentMailboxRegistrationView()
    ).resolves.toEqual({
      mailboxes: [],
      registeredCount: 0,
      maxMailboxes: 2,
      addressDomain: "example.com",
    });
    await MailService.createAgentMailbox("support");

    expect(api.get).toHaveBeenCalledWith("/mail-api/webapi/v0/agent-mailboxes");
    expect(api.post).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/agent-mailboxes",
      { localpart: "support" }
    );
  });

  it("rejects a mailbox view that omits its required limit", async () => {
    api.get.mockResolvedValue({
      mailboxes: [],
      registeredCount: 0,
      addressDomain: "example.com",
    });

    await expect(MailService.getAgentMailboxRegistrationView()).rejects.toThrow(
      "Invalid Agent mailbox registration response"
    );
  });

  it("deletes an additional Agent mailbox through the owner route", async () => {
    api.delete.mockResolvedValue(undefined);
    await MailService.deleteAgentMailbox("mail box");
    expect(api.delete).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/agent-mailboxes/mail%20box"
    );
  });

  it("loads and approves a Bot mailbox authorization", async () => {
    api.get.mockResolvedValue({ request: { botId: "bot-1" }, mailboxes: [] });
    api.post.mockResolvedValue({
      approved: true,
      mailboxId: "2",
      outboundMode: "automatic_send",
    });

    await MailService.getAgentAuthorization("ABCD EFGH", "space-1111");
    await MailService.approveAgentAuthorization(
      "ABCD EFGH",
      "2",
      "automatic_send",
      "space-1111"
    );

    expect(api.get).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/agent-auth/requests/ABCD%20EFGH",
      {
        headers: { "X-Space-ID": "space-1111" },
        suppressAuthExpiredLogout: true,
      }
    );
    expect(api.post).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/agent-auth/requests/ABCD%20EFGH/approve",
      { mailboxId: "2", outboundMode: "automatic_send" },
      {
        headers: { "X-Space-ID": "space-1111" },
        suppressAuthExpiredLogout: true,
      }
    );
  });

  it("revokes an Agent mailbox binding", async () => {
    await MailService.revokeAgentMailboxBinding("mail box");

    expect(api.delete).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/agent-mailboxes/mail%20box/binding"
    );
  });

  it("updates one connected mailbox automation mode", async () => {
    api.patch.mockResolvedValue({
      id: "mail box",
      address: "support@example.com",
      connectState: "connected",
      outboundMode: "automatic_send",
    });

    await expect(
      MailService.updateAgentMailboxAutomation("mail box", "automatic_send")
    ).resolves.toMatchObject({ outboundMode: "automatic_send" });
    expect(api.patch).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/agent-mailboxes/mail%20box/automation",
      { outboundMode: "automatic_send" }
    );
  });

  it("manages owner-scoped mailbox rules", async () => {
    api.get.mockResolvedValueOnce({ rules: [] }).mockResolvedValueOnce({
      executions: [],
    });
    api.post.mockResolvedValue({ id: "rule-1" });
    api.patch.mockResolvedValue({ id: "rule-1", enabled: false });
    const input = {
      name: "VIP mail",
      enabled: true,
      priority: 0,
      matchMode: "all" as const,
      conditions: [
        {
          field: "from" as const,
          operator: "contains" as const,
          value: "vip@example.com",
        },
        {
          field: "subject" as const,
          operator: "contains" as const,
          value: "urgent",
        },
      ],
      matchFrom: "vip@example.com",
      matchSubject: "urgent",
      forwardTargets: ["owner@example.com"],
    };

    await MailService.listMailRules("mail box");
    await MailService.createMailRule("mail box", input);
    await MailService.updateMailRule("mail box", "rule id", {
      enabled: false,
    });
    await MailService.deleteMailRule("mail box", "rule id");
    await MailService.listMailRuleExecutions("mail box", 12);

    const root = "/mail-api/webapi/v0/agent-mailboxes/mail%20box";
    expect(api.get).toHaveBeenNthCalledWith(1, `${root}/rules`);
    expect(api.post).toHaveBeenCalledWith(`${root}/rules`, input);
    expect(api.patch).toHaveBeenCalledWith(`${root}/rules/rule%20id`, {
      enabled: false,
    });
    expect(api.delete).toHaveBeenCalledWith(`${root}/rules/rule%20id`);
    expect(api.get).toHaveBeenNthCalledWith(2, `${root}/rule-executions`, {
      param: { limit: 12 },
    });
  });

  it("loads delivery detail for a message", async () => {
    api.get.mockResolvedValue({
      messageId: "E 1",
      status: "sending",
      delivered: 0,
      total: 1,
      recipients: [],
    });

    await MailService.getMessageDelivery("42", "E 1");

    expect(api.get).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/messages/E%201/delivery",
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("downloads an attachment through the account-scoped MIME part route", async () => {
    api.get.mockResolvedValue(new Blob(["report"]));

    await MailService.downloadAttachment("42", "E 1", "1.2");

    expect(api.get).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/messages/E%201/attachments/1.2",
      {
        responseType: "blob",
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("forwards message query filters and cancellation", async () => {
    const signal = new AbortController().signal;
    api.get.mockResolvedValue({
      messages: [],
      total: 0,
      offset: 30,
      limit: 30,
    });

    await MailService.listMessages({
      mailboxContextId: "42",
      mailbox: "Inbox",
      search: "invoice",
      limit: 30,
      offset: 30,
      signal,
    });

    expect(api.get).toHaveBeenCalledWith("/mail-api/webapi/v0/messages", {
      param: {
        mailbox: "Inbox",
        search: "invoice",
        limit: 30,
        offset: 30,
      },
      headers: { "X-Octo-Mailbox-ID": "42" },
      signal,
      timeout: MAIL_REQUEST_TIMEOUT_MS,
    });
  });

  it("encodes message ids for mutation routes", async () => {
    api.patch.mockResolvedValue({ updated: "E 1" });

    await MailService.updateKeywords("42", "E 1", ["\\Seen"], []);

    expect(api.patch).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/messages/E%201",
      { addKeywords: ["\\Seen"], removeKeywords: [] },
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("persists a message star through the account-scoped keyword route", async () => {
    api.patch.mockResolvedValue({ updated: "E 1" });

    await MailService.updateKeywords("42", "E 1", ["\\Flagged"], []);

    expect(api.patch).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/messages/E%201",
      { addKeywords: ["\\Flagged"], removeKeywords: [] },
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("keeps send payloads unchanged", async () => {
    api.post.mockResolvedValue({ submissionIds: ["s1"], messageId: "E1" });
    const payload = {
      to: ["agent@example.com"],
      cc: [],
      bcc: [],
      subject: "Status",
      text: "Done",
      attachments: [],
    };

    await MailService.sendMessage("42", payload);

    expect(api.post).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/messages",
      payload,
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("saves a composed message through the real drafts route", async () => {
    api.post.mockResolvedValue({ id: "E1" });
    const payload = {
      to: ["agent@example.com"],
      subject: "Draft subject",
      text: "Draft body",
    };

    await MailService.createDraft("42", payload);

    expect(api.post).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/drafts",
      payload,
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("updates and version-confirms a policy draft", async () => {
    api.patch.mockResolvedValue({ id: "E2", draftVersion: 2 });
    api.post.mockResolvedValue({ submissionIds: ["s1"], messageId: "E3" });
    const payload = {
      to: ["agent@example.com"],
      subject: "Reviewed draft",
      text: "Approved wording",
      draftVersion: 1,
    };

    await expect(
      MailService.updateDraft("42", "E 1", payload)
    ).resolves.toEqual({ id: "E2", draftVersion: 2 });
    await MailService.sendDraft("42", "E2", 2);

    expect(api.patch).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/drafts/E%201",
      payload,
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
    expect(api.post).toHaveBeenCalledWith(
      "/mail-api/webapi/v0/drafts/E2/send",
      { draftVersion: 2 },
      {
        headers: { "X-Octo-Mailbox-ID": "42" },
        timeout: MAIL_REQUEST_TIMEOUT_MS,
      }
    );
  });

  it("rejects a Draft replacement response without its new version", async () => {
    api.patch.mockResolvedValue({ id: "E2" });

    await expect(
      MailService.updateDraft("42", "E1", {
        to: ["agent@example.com"],
        subject: "Reviewed draft",
        text: "Approved wording",
        draftVersion: 1,
      })
    ).rejects.toThrow("Invalid Draft update response");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("keeps mailbox management on the owner context", async () => {
    api.get.mockResolvedValue({ mailboxes: [], maxMailboxes: 2 });

    await MailService.listAgentMailboxes();

    expect(api.get).toHaveBeenCalledWith("/mail-api/webapi/v0/agent-mailboxes");
    expect(api.get).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Octo-Mailbox-ID": "42" }),
      })
    );
  });
});
