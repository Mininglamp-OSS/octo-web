import React, { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, ScanLine } from "lucide-react";
import { Dropdown, Toast } from "@douyinfe/semi-ui";
import IconClick from "../../../Components/IconClick";
import { i18n, useI18n } from "../../../i18n";
import { captureForComposer } from "./capture";
import type { ScreenshotHost } from "./contract";
import type { ScreenshotConversationPort } from "./port";
import { screenshotSettingsStore, type ScreenshotSettings } from "./settings";

export interface ScreenshotToolbarProps {
  host: ScreenshotHost;
  conversation: ScreenshotConversationPort;
  scopeKey(): string;
}

export function ScreenshotToolbar({ host, conversation, scopeKey }: ScreenshotToolbarProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<ScreenshotSettings>(() => screenshotSettingsStore.get());
  const [menuVisible, setMenuVisible] = useState(false);
  const active = useRef<ReturnType<typeof captureForComposer>>();
  const living = useRef(true);
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ conversation, scopeKey });
  latest.current = { conversation, scopeKey };
  useEffect(() => screenshotSettingsStore.subscribe(setSettings), []);
  useEffect(() => {
    living.current = true;
    return () => { living.current = false; active.current?.cancel(); };
  }, []);
  const start = async () => {
    if (active.current || typeof host.captureScreenshot !== "function") return;
    const channelKey = () => {
      const channel = latest.current.conversation.channel();
      return `${channel.channelType}:${channel.channelID}`;
    };
    const channel = channelKey();
    const scope = scopeKey();
    const isCurrent = () => living.current && container.current?.isConnected === true &&
      latest.current.conversation === conversation && channelKey() === channel && latest.current.scopeKey() === scope;
    const operation = captureForComposer(host, {
      // randomUUID is secure-context only and would throw before the busy state is set.
      requestId: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36),
      locale: i18n.getLocale() === "en-US" ? "en-US" : "zh-CN",
      // Read the store rather than the render state: the menu may have been toggled since the last paint.
      hideChatWindow: screenshotSettingsStore.get().hideChatWindow,
    }, {
      isCurrent,
      // "upload" keeps the capture out of the editor: the "paste" path inserts an inline node at the
      // live Tiptap selection, which replaces selected draft text or an inline attachment.
      add: file => conversation.addPendingAttachments([file], "upload"),
      focus: () => conversation.messageInputContext()?.focus(),
    });
    active.current = operation;
    setBusy(true);
    try {
      const result = await operation.result;
      if (isCurrent() && result.status === "error") Toast.error(t(`screenshot.${result.code}`));
      if (isCurrent() && result.status === "attachment-error") Toast.error(result.message);
    } finally {
      if (active.current === operation) active.current = undefined;
      if (living.current) setBusy(false);
    }
  };
  if (typeof host.captureScreenshot !== "function") return null;
  const label = t(busy ? "screenshot.capturing" : "screenshot.action");
  // Unlike the voice-mode menu, which acts on a transient pick, this item writes the preference back.
  const menu = <Dropdown.Menu style={{ width: 200 }}>
    <Dropdown.Item onClick={() => screenshotSettingsStore.set({ hideChatWindow: !settings.hideChatWindow })}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 14, display: "inline-flex" }}>{settings.hideChatWindow ? <Check size={14} /> : null}</span>
        {t("screenshot.hideWindow")}
      </span>
    </Dropdown.Item>
  </Dropdown.Menu>;
  return <div ref={container} aria-busy={busy}>
    <Dropdown trigger="hover" position="topRight" spacing={4} visible={menuVisible}
      onVisibleChange={setMenuVisible} render={menu}>
      <div>
        <IconClick size="sm" title={label} aria-label={label} disabled={busy}
          data-testid="input-screenshot-btn" onClick={() => { void start(); }}
          icon={busy ? <LoaderCircle size={18} /> : <ScanLine size={18} />} />
      </div>
    </Dropdown>
  </div>;
}
