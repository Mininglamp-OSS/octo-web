import { useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import {
  attachmentIdentity,
  isBrowserHtmlAttachment,
  type HtmlAttachment,
} from "../../features/html-attachment/types";
import { openHtmlAttachment } from "../../features/html-attachment/handoff";
import { downloadHtmlAttachment } from "./downloadAttachment";
import { attachmentErrorMessage } from "./useHtmlAttachment";

export function useHtmlAttachmentActions(
  file: HtmlAttachment | null,
  bytes?: Uint8Array<ArrayBuffer>
) {
  const identity = file ? attachmentIdentity(file) : "";
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const operation = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setPending(false);
    setError(undefined);
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [identity]);
  const report = (cause: unknown) => {
    const message = attachmentErrorMessage(cause);
    setError(message);
    Toast.error(message);
  };
  const download = async () => {
    if (!file || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(undefined);
    try {
      await downloadHtmlAttachment({ ...file }, controller.signal, bytes);
    } catch (cause) {
      if (!controller.signal.aborted && activeIdentity.current === identity)
        report(cause);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  };
  const open = () => {
    if (!file) return;
    try {
      openHtmlAttachment(file);
    } catch (cause) {
      report(cause);
    }
  };
  return {
    enabled: !!file && isBrowserHtmlAttachment(file),
    pending,
    error,
    download,
    open,
  };
}
