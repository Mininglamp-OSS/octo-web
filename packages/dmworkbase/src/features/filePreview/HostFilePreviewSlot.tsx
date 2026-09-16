import React, { useLayoutEffect, useRef, useState } from "react";
import { Button, Spin } from "@douyinfe/semi-ui";
import { IconClose, IconRefresh } from "@douyinfe/semi-icons";
import { useI18n } from "../../i18n";
import {
  subscribeHostAttachmentClosed,
  subscribeHostAttachmentPreview,
  updateHostAttachmentLayout,
  subscribeHostAttachmentState,
  releaseHostAttachmentPreview,
  type HostAttachmentState,
} from "./attachmentHost";
import type { HostFilePreviewLayout } from "./hostPreviewLayout";

export function measureHostPreviewSlot(element: HTMLElement): HostFilePreviewLayout["bounds"] | null {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return null;
    if (node !== element) {
      const clip = node.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
  }
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The message page owns layout; the native surface occupies only this slot. */
export function HostFilePreviewSlot({
  requestId, failed, onClose, onRetry,
}: { requestId: string; failed?: boolean; onClose: () => void; onRetry?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { t } = useI18n();
  const [status, setStatus] = useState<HostAttachmentState>();
  const error = failed ? t("base.messageFile.previewFailed") :
    status?.requestId === requestId && status.phase === "error"
      ? (typeof status.error === "string" && status.error.length <= 1000 && status.error) ||
        t("base.messageFile.previewFailed") : undefined;
  useLayoutEffect(() => subscribeHostAttachmentState((next) => {
    if (next.requestId === requestId) setStatus(next);
  }), [requestId]);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      // StrictMode replays effects without removing the slot.
      queueMicrotask(() => {
        if (!element?.isConnected) releaseHostAttachmentPreview(requestId);
      });
    };
  }, [requestId]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let last = "";
    let trackUntil = 0;
    const report = () => {
      frame = 0;
      const bounds = failed ? null : measureHostPreviewSlot(element);
      const layout: HostFilePreviewLayout = {
        version: 1, requestId, visible: !!bounds,
        bounds: bounds ?? { x: 0, y: 0, width: 0, height: 0 },
      };
      const signature = JSON.stringify(layout);
      if (signature !== last) {
        last = signature;
        void updateHostAttachmentLayout(layout).catch(() => {});
      }
      if (performance.now() < trackUntil) frame = requestAnimationFrame(report);
    };
    const schedule = () => {
      // Panel movement can change position without changing its measured size.
      trackUntil = performance.now() + 350;
      if (!frame) frame = requestAnimationFrame(report);
    };
    const resize = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      resize.observe(node);
      mutations.observe(node, { attributes: true, attributeFilter: ["style", "class", "hidden", "aria-hidden"] });
    }
    const unsubscribePreview = subscribeHostAttachmentPreview(() => {
      last = "";
      schedule();
    });
    const unsubscribeClose = subscribeHostAttachmentClosed((closedId) => {
      if (closedId === requestId) closeRef.current();
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      unsubscribePreview();
      unsubscribeClose();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      void updateHostAttachmentLayout({
        version: 1, requestId, visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 },
      }).catch(() => {});
    };
  }, [requestId, failed]);

  return <div ref={ref} data-host-file-preview-slot={requestId} style={{
    flex: "1 1 0", width: "100%", height: "100%", minWidth: 0, minHeight: 0,
    position: "relative", background: "var(--semi-color-bg-0)",
  }}>
    <Button theme="borderless" type="tertiary" icon={<IconClose />}
      title={t("base.filePreview.close")} aria-label={t("base.filePreview.close")}
      onClick={onClose} style={{
        position: "absolute", top: "var(--wk-sp-2)", right: "var(--wk-sp-2)",
        width: "var(--wk-sp-8)", height: "var(--wk-sp-8)",
      }} />
    <div role={error ? "alert" : "status"} style={{
      height: "100%", display: "grid", placeContent: "center",
      gap: "var(--wk-sp-3)", padding: "var(--wk-sp-6)",
      textAlign: "center", overflowWrap: "anywhere", color: "var(--semi-color-text-1)",
    }}>
      {error ? <><span>{error}</span>{onRetry && <Button theme="borderless" type="tertiary"
        icon={<IconRefresh />} title={t("base.filePreview.retry")}
        aria-label={t("base.filePreview.retry")} onClick={onRetry} />}</> :
        <Spin aria-label={t("base.filePreview.loading")} />}
    </div>
  </div>;
}
