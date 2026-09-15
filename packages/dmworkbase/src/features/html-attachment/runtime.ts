import { AttachmentError, type AttachmentSession } from "./types";

// Installed by the host; shared HTML code does not import or start WKApp.
let getSession: () => AttachmentSession | null = () => null;
let subscribe: (listener: () => void) => () => void = () => () => undefined;
let configured = false;

export function configureHtmlAttachmentRuntime(
  session: () => AttachmentSession | null,
  subscribeAuth?: (listener: () => void) => () => void
) {
  getSession = session;
  subscribe = subscribeAuth || (() => () => undefined);
  configured = true;
}

export function currentAttachmentSession(): AttachmentSession | null {
  return getSession();
}

export const requiresAttachmentSession = () => configured;

export function assertAttachmentSession(expected: AttachmentSession) {
  const current = currentAttachmentSession();
  if (
    !current ||
    current.uid !== expected.uid ||
    current.sessionId !== expected.sessionId ||
    current.token !== expected.token ||
    current.spaceId !== expected.spaceId
  ) {
    throw new AttachmentError("expired");
  }
}

export function subscribeAttachmentSession(listener: () => void): () => void {
  const unsubscribe = subscribe(listener);
  const foreground = () => {
    if (!document.hidden) listener();
  };
  window.addEventListener("storage", listener);
  window.addEventListener("focus", listener);
  window.addEventListener("pageshow", listener);
  document.addEventListener("visibilitychange", foreground);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("pageshow", listener);
    document.removeEventListener("visibilitychange", foreground);
  };
}

export function storedAttachmentSession(
  sessionId: string,
  spaceId: string,
  apiURL: string
): AttachmentSession | null {
  try {
    // localStorage is authoritative for revocation; sessionStorage can contain a
    // stale copy after another tab logs out. Never scan other login buckets.
    if (sessionStorage.getItem("octo.session.sid") !== sessionId) return null;
    const uid = localStorage.getItem(`uid${sessionId}`);
    const token = localStorage.getItem(`token${sessionId}`);
    const copiedUid = sessionStorage.getItem(`uid${sessionId}`);
    const copiedToken = sessionStorage.getItem(`token${sessionId}`);
    // Fresh chat tabs restore credentials from localStorage without copying
    // them into sessionStorage. Only a present, mismatched copy is stale.
    if (
      !uid ||
      !token ||
      (copiedUid !== null && copiedUid !== uid) ||
      (copiedToken !== null && copiedToken !== token)
    )
      return null;
    return { uid, token, sessionId, spaceId, apiURL };
  } catch {
    return null;
  }
}
