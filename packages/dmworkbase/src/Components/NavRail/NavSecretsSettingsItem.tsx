import React, { useState, useEffect, useCallback } from "react";
import WKApp from "../../App";
import SecretsSettingsPanel from "../SecretsSettings/SecretsSettingsPanel";
import { useI18n } from "../../i18n";

/**
 * 设置面板里的「密钥 / Secrets」一级入口（YUJ-3539），与语音设置平级。
 *
 * 同时承接聊天反向跳转的深链：监听 mittBus 的 `wk:open-secrets` 事件，
 * 由聊天里的「去添加密钥」按钮 / 防手滑提示触发，打开本面板（可带预填）。
 */
export interface OpenSecretsPayload {
  /** 打开即弹新增弹窗 */
  create?: boolean;
  /** 预填名字（如从「帮我配 Claude 密钥」推断出的「Claude 密钥」） */
  name?: string;
  /** 防手滑本地预填的明文（绝不自动发送/保存） */
  value?: string;
}

export default function NavSecretsSettingsItem() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<OpenSecretsPayload>({});
  // 每次 open 自增，用作面板的 React key：即便面板已经开着，新的深链事件
  // 也会让面板 remount、重跑初始化逻辑，从而按新 payload 打开/预填新增弹窗
  // （否则 SecretsSettingsPanel 的 useState 初始化只在首次挂载跑一次）。codex review P2。
  const [openSeq, setOpenSeq] = useState(0);

  const open = useCallback((p: OpenSecretsPayload = {}) => {
    setPayload(p);
    setVisible(true);
    setOpenSeq((n) => n + 1);
  }, []);

  /**
   * 关闭即清掉缓存的 payload —— 里面可能含防手滑预填的明文 key，
   * 一次性用完就别留在 React state 里（codex review P2）。
   */
  const close = useCallback(() => {
    setVisible(false);
    setPayload({});
  }, []);

  useEffect(() => {
    const handler = (p?: OpenSecretsPayload) => open(p ?? {});
    WKApp.mittBus.on("wk:open-secrets", handler);
    return () => {
      WKApp.mittBus.off("wk:open-secrets", handler);
    };
  }, [open]);

  return (
    <>
      <li
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
      >
        {t("base.navRail.settingsPanel.secrets")}
      </li>
      {visible && (
        <SecretsSettingsPanel
          key={openSeq}
          onClose={close}
          initialCreate={payload.create}
          prefillName={payload.name}
          prefillValue={payload.value}
        />
      )}
    </>
  );
}
