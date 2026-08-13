// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getAgentAuthorization: vi.fn(),
  approveAgentAuthorization: vi.fn(),
  getUserProfile: vi.fn(),
  currentSpaceId: "space-a",
  t: vi.fn((key: string) => key),
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: state.t }),
  UserService: { getUserProfile: state.getUserProfile },
  WKApp: {
    shared: {
      get currentSpaceId() {
        return state.currentSpaceId;
      },
    },
  },
}));

vi.mock("../Service/MailService", () => ({
  default: {
    getAgentAuthorization: state.getAgentAuthorization,
    approveAgentAuthorization: state.approveAgentAuthorization,
  },
}));

import {
  MAIL_AUTHORIZATION_RESOLVED_EVENT,
  resolveMailAuthorizeSearch,
} from "../authorizationSession";
import MailAuthorizationPage from "./MailAuthorizationPage";

const initialSearch =
  "?code=ABCD-1234&mailbox=bot%40mail.imocto.cn&space_id=space-a";

const authorization = {
  request: {
    userCode: "ABCD-1234",
    botId: "bot-1",
    botProfile: "Mailbox Bot",
    status: "pending" as const,
    requestedAt: "2026-08-11T00:00:00Z",
    expiresAt: "2099-08-11T01:00:00Z",
    outboundMode: "manual_confirmation" as const,
  },
  mailboxes: [
    {
      id: "42",
      address: "bot@mail.imocto.cn",
      connectState: "unconnected" as const,
      outboundMode: "manual_confirmation" as const,
    },
  ],
};

describe("MailAuthorizationPage return target lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentSpaceId = "space-a";
    window.history.replaceState(null, "", `/mail/authorize${initialSearch}`);
    sessionStorage.clear();
    resolveMailAuthorizeSearch(
      "/mail/authorize",
      initialSearch,
      sessionStorage
    );
    state.getUserProfile.mockResolvedValue({ name: "Mailbox Bot" });
    state.approveAgentAuthorization.mockResolvedValue({
      approved: true,
      mailboxId: "42",
      outboundMode: "manual_confirmation",
    });
  });

  afterEach(() => cleanup());

  it("keeps the return target while owner approval is still pending", async () => {
    const resolved = vi.fn();
    state.getAgentAuthorization.mockResolvedValue(authorization);
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    render(<MailAuthorizationPage initialSearch={initialSearch} />);

    await waitFor(() =>
      expect(state.getAgentAuthorization).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(state.getUserProfile).toHaveBeenCalledWith("bot-1", undefined, {
        suppressAuthExpiredLogout: true,
      })
    );
    expect(resolved).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("octo.mail.authorize.pending-search")).toBe(
      initialSearch
    );
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("keeps the return target through the React StrictMode effect replay", async () => {
    const resolved = vi.fn();
    state.getAgentAuthorization.mockResolvedValue(authorization);
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    render(
      <React.StrictMode>
        <MailAuthorizationPage initialSearch={initialSearch} />
      </React.StrictMode>
    );

    await waitFor(() =>
      expect(state.getAgentAuthorization).toHaveBeenCalledTimes(2)
    );
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("hands an expired session to the host without clearing either return target", async () => {
    const resolved = vi.fn();
    const sessionExpired = vi.fn();
    state.getAgentAuthorization.mockRejectedValue({
      status: 401,
      code: "err.shared.auth.token_expired",
    });
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
    sessionStorage.setItem(
      "octo.docs.standaloneReturn",
      `/mail/authorize${initialSearch}`
    );

    render(
      <MailAuthorizationPage
        initialSearch={initialSearch}
        onSessionExpired={sessionExpired}
      />
    );

    await waitFor(() => expect(sessionExpired).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("octo.mail.authorize.pending-search")).toBe(
      initialSearch
    );
    expect(sessionStorage.getItem("octo.docs.standaloneReturn")).toBe(
      `/mail/authorize${initialSearch}`
    );
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("clears the host return target after a terminal non-login error", async () => {
    const resolved = vi.fn();
    state.getAgentAuthorization.mockRejectedValue({ status: 403 });
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    render(<MailAuthorizationPage initialSearch={initialSearch} />);

    await waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
    expect(sessionStorage.length).toBe(0);
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("clears both return targets when an already exchanged request loads", async () => {
    const resolved = vi.fn();
    state.getAgentAuthorization.mockResolvedValue({
      ...authorization,
      request: { ...authorization.request, status: "exchanged" },
    });
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    render(<MailAuthorizationPage initialSearch={initialSearch} />);

    await waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
    expect(sessionStorage.length).toBe(0);
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("hands an approval 401 to the same expired-session recovery", async () => {
    const resolved = vi.fn();
    const sessionExpired = vi.fn();
    state.getAgentAuthorization.mockResolvedValue(authorization);
    state.approveAgentAuthorization.mockRejectedValue({
      status: 401,
      code: "err.shared.auth.token_expired",
    });
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    render(
      <MailAuthorizationPage
        initialSearch={initialSearch}
        onSessionExpired={sessionExpired}
      />
    );
    await screen.findByRole("button", { name: "mail.authorization.approve" });
    fireEvent.click(
      screen.getByRole("button", { name: "mail.authorization.approve" })
    );

    await waitFor(() =>
      expect(state.approveAgentAuthorization).toHaveBeenCalledTimes(1)
    );
    expect(sessionExpired).toHaveBeenCalledTimes(1);
    expect(resolved).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("octo.mail.authorize.pending-search")).toBe(
      initialSearch
    );
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("clears pending authorization state when the page is left normally", async () => {
    const resolved = vi.fn();
    state.getAgentAuthorization.mockResolvedValue(authorization);
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    const view = render(
      <MailAuthorizationPage initialSearch={initialSearch} />
    );
    await waitFor(() =>
      expect(state.getAgentAuthorization).toHaveBeenCalledTimes(1)
    );
    view.unmount();

    await waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
    expect(sessionStorage.length).toBe(0);
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("does not preselect automatic sending merely because the Agent requested it", async () => {
    state.getAgentAuthorization.mockResolvedValue({
      ...authorization,
      request: {
        ...authorization.request,
        outboundMode: "automatic_send",
      },
    });

    render(<MailAuthorizationPage initialSearch={initialSearch} />);

    const manual = await screen.findByRole("radio", { name: /manualReviewTitle/ });
    const automatic = screen.getByRole("radio", { name: /automaticSendTitle/ });
    expect((manual as HTMLInputElement).checked).toBe(true);
    expect((automatic as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("mail.authorization.requestedAutomatic")).toBeTruthy();
  });

  it("requires explicit confirmation when the link targets another Space", async () => {
    state.currentSpaceId = "space-b";
    state.getAgentAuthorization.mockResolvedValue(authorization);

    render(<MailAuthorizationPage initialSearch={initialSearch} />);

    const approve = await screen.findByRole("button", {
      name: "mail.authorization.approve",
    });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /mail.authorization.spaceMismatchConfirmation/,
      })
    );
    expect((approve as HTMLButtonElement).disabled).toBe(false);
  });

  it("fails closed when the server echoes a different grant", async () => {
    state.getAgentAuthorization.mockResolvedValue(authorization);
    state.approveAgentAuthorization.mockResolvedValue({
      approved: true,
      mailboxId: "different-mailbox",
      outboundMode: "manual_confirmation",
    });

    render(<MailAuthorizationPage initialSearch={initialSearch} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "mail.authorization.approve",
      })
    );

    expect(
      await screen.findByText("mail.authorization.approvalMismatch")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "mail.authorization.approve" })
    ).toBeTruthy();
  });

  it("does not destroy the OCTO session for an unclassified Mail 401", async () => {
    const resolved = vi.fn();
    const sessionExpired = vi.fn();
    state.getAgentAuthorization.mockRejectedValue({
      status: 401,
      code: "unauthorized",
      msg: "mail authorization failed",
    });
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);

    render(
      <MailAuthorizationPage
        initialSearch={initialSearch}
        onSessionExpired={sessionExpired}
      />
    );

    await waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
    expect(sessionExpired).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, resolved);
  });

  it("rejects an authorization request whose deadline has passed", async () => {
    state.getAgentAuthorization.mockResolvedValue({
      ...authorization,
      request: {
        ...authorization.request,
        expiresAt: "2000-01-01T00:00:00Z",
      },
    });

    render(<MailAuthorizationPage initialSearch={initialSearch} />);

    expect(await screen.findByText("mail.authorization.expired")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "mail.authorization.approve" })
    ).toBeNull();
  });
});
