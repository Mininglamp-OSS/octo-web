import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSessionSid, setSessionSid } from "../../Service/SessionScope";
import {
  configureHtmlAttachmentRuntime,
  currentAttachmentSession,
  storedAttachmentSession,
} from "./runtime";

describe("HTML attachment login restoration", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setSessionSid("");
    localStorage.setItem("uids", "u");
    localStorage.setItem("tokens", "token");
    configureHtmlAttachmentRuntime(() =>
      storedAttachmentSession(getSessionSid(), "space", "/api/v1/")
    );
  });
  afterEach(() => {
    setSessionSid("");
    sessionStorage.clear();
    localStorage.clear();
  });

  it("uses the chat host's localStorage-only restoration without copying credentials", () => {
    expect(currentAttachmentSession()).toEqual({
      uid: "u",
      token: "token",
      sessionId: "s",
      spaceId: "space",
      apiURL: "/api/v1/",
    });
    expect(sessionStorage.getItem("octo.session.sid")).toBe("s");
    expect(sessionStorage.getItem("uids")).toBeNull();
    expect(sessionStorage.getItem("tokens")).toBeNull();
  });

  it.each(["uids", "tokens"])(
    "accepts an absent %s copy but rejects a stale one",
    (key) => {
      setSessionSid("s");
      sessionStorage.setItem("uids", "u");
      sessionStorage.setItem("tokens", "token");
      sessionStorage.removeItem(key);
      expect(currentAttachmentSession()?.uid).toBe("u");
      sessionStorage.setItem(key, "stale");
      expect(currentAttachmentSession()).toBeNull();
    }
  );

  it("requires the selected sid and never adopts another login bucket", () => {
    setSessionSid("other");
    expect(storedAttachmentSession("s", "space", "/api/v1/")).toBeNull();
    expect(currentAttachmentSession()).toBeNull();
  });

  it.each(["uids", "tokens"])(
    "revokes access when authoritative %s is removed",
    (key) => {
      setSessionSid("s");
      sessionStorage.setItem("uids", "u");
      sessionStorage.setItem("tokens", "token");
      expect(currentAttachmentSession()?.uid).toBe("u");
      localStorage.removeItem(key);
      expect(currentAttachmentSession()).toBeNull();
    }
  );
});
