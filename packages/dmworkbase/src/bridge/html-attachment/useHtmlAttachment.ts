import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentIdentity,
  AttachmentError,
  type HtmlAttachment,
} from "../../features/html-attachment/types";
import {
  assertAttachmentSession,
  currentAttachmentSession,
  subscribeAttachmentSession,
} from "../../features/html-attachment/runtime";
import { loadHtmlAttachment } from "./readAttachment";
import { t } from "../../i18n";

export function attachmentErrorMessage(error: unknown): string {
  return t(
    `base.htmlAttachment.${
      error instanceof AttachmentError ? error.code : "downloadFailed"
    }`
  );
}

export function useHtmlAttachment(file: HtmlAttachment, enabled = true) {
  const identity = attachmentIdentity(file);
  const session = currentAttachmentSession();
  const scope = `${session?.uid || ""}:${session?.sessionId || ""}:${
    session?.spaceId || ""
  }`;
  const key = `${scope}:${identity}`;
  const snapshot = useRef(file);
  snapshot.current = file;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    bytes?: Uint8Array<ArrayBuffer>;
    error?: unknown;
    loading: boolean;
  }>({ key: "", loading: true });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const captured = currentAttachmentSession();
    setState({ key, loading: true });
    const checkSession = () => {
      if (!captured) return;
      try {
        assertAttachmentSession(captured);
      } catch (error) {
        controller.abort();
        setState({ key, loading: false, error });
      }
    };
    const unsubscribe = subscribeAttachmentSession(checkSession);
    void loadHtmlAttachment(snapshot.current, captured, controller.signal)
      .then((bytes) => {
        if (!controller.signal.aborted) {
          if (captured) assertAttachmentSession(captured);
          setState({ key, bytes, loading: false });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, error, loading: false });
      });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [key, revision, enabled]);
  const current = state.key === key ? state : { key, loading: true };
  const content = useMemo(
    () =>
      current.bytes ? new TextDecoder("utf-8").decode(current.bytes) : null,
    [current.bytes]
  );
  return {
    bytes: current.bytes,
    content,
    loading: enabled && current.loading,
    tooLarge:
      current.error instanceof AttachmentError &&
      current.error.code === "tooLarge",
    expired:
      current.error instanceof AttachmentError &&
      current.error.code === "expired",
    error: current.error ? attachmentErrorMessage(current.error) : null,
    reload: () => setRevision((value) => value + 1),
  };
}
