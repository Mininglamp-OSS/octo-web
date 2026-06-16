import React, { useState, useCallback, useEffect } from "react";
import { Toast, Spin } from "@douyinfe/semi-ui";
import {
  IconPlus,
  IconKey,
  IconCopy,
  IconEdit,
  IconDelete,
  IconRefresh,
} from "@douyinfe/semi-icons";
import WKModal, { wkConfirm } from "../WKModal";
import WKButton from "../WKButton";
import { useI18n } from "../../i18n";
import SecretsService, { SecretListItem } from "../../Service/SecretsService";
import { extractErrorMsg } from "../../Service/APIClient";
import SecretEditModal from "./SecretEditModal";
import { formatRelativeFromNow } from "./relativeTime";
import "./SecretsSettings.css";

export interface SecretsSettingsPanelProps {
  onClose: () => void;
  /** 深链落地：打开即弹新增弹窗，并按需预填名字/类型/明文 */
  initialCreate?: boolean;
  prefillName?: string;
  prefillValue?: string;
}

type EditTarget =
  | { mode: "create"; prefillName?: string; prefillValue?: string }
  | { mode: "edit"; secret: SecretListItem }
  | null;

/**
 * 密钥管理主面板（YUJ-3539）—— 设置 →「密钥 / Secrets」一级入口落地页。
 *
 * 卡片列表：每条 secret 一卡，展示自然语言名字 + kind 胶囊 + 掩码 + 时间元信息，
 * 操作含编辑名字 / 更新 key / 删除 / 复制引用名。右上「+ 新增密钥」。
 * 空状态引导用户去聊天里用自然语言引用。
 */
export default function SecretsSettingsPanel({
  onClose,
  initialCreate,
  prefillName,
  prefillValue,
}: SecretsSettingsPanelProps) {
  const { t, format } = useI18n();
  const [items, setItems] = useState<SecretListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 深链/防手滑预填只用于「打开面板时」自动弹出的那一次新增（一次性）。
  // 之后用户在面板里手动点「+ 新增密钥」走 startCreate()，绝不复用上一次的明文，
  // 避免把粘贴进来的旧 key 误存到一个新名字下（codex review P2）。
  const [editTarget, setEditTarget] = useState<EditTarget>(
    initialCreate
      ? { mode: "create", prefillName, prefillValue }
      : null
  );

  /** 手动新增：永远是干净的空表单，不带任何预填明文。 */
  const startCreate = useCallback(() => setEditTarget({ mode: "create" }), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const list = await SecretsService.shared.list();
      setItems(list);
    } catch (e) {
      setError(true);
      Toast.error(extractErrorMsg(e) || t("base.secrets.error.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 复制引用名（不是复制 key）——呼应聊天里「用我的 XX 密钥」的引用方式。
  const handleCopyName = useCallback(
    async (displayName: string) => {
      try {
        await navigator.clipboard.writeText(displayName);
        Toast.success(t("base.secrets.toast.nameCopied"));
      } catch {
        Toast.error(t("base.secrets.error.copyFailed"));
      }
    },
    [t]
  );

  const handleDelete = useCallback(
    (secret: SecretListItem) => {
      wkConfirm({
        title: t("base.secrets.delete.title"),
        content: t("base.secrets.delete.content", { values: { name: secret.display_name } }),
        okText: t("base.secrets.delete.confirm"),
        okType: "danger",
        onOk: async () => {
          // 删除本身失败 → 报错并 rethrow（保留确认弹窗，允许重试）。
          try {
            await SecretsService.shared.remove(secret.secret_id);
          } catch (e) {
            Toast.error(extractErrorMsg(e) || t("base.secrets.error.deleteFailed"));
            throw e;
          }
          // 删除已成功：即便随后的列表刷新短暂失败，也不能反过来报「删除失败」、
          // 也不要把弹窗卡住让用户二次删除一个已不存在的 secret（codex review P2）。
          Toast.success(t("base.secrets.toast.deleted"));
          void load();
        },
      });
    },
    [t, load]
  );

  const renderMeta = (secret: SecretListItem) => {
    const created = t("base.secrets.meta.created", {
      values: { time: format.date(secret.created_at) },
    });
    const lastUsed = secret.last_used_at
      ? t("base.secrets.meta.lastUsed", {
          values: { time: formatRelativeFromNow(secret.last_used_at, format) },
        })
      : t("base.secrets.meta.neverUsed");
    return `${created} · ${lastUsed}`;
  };

  return (
    <WKModal
      visible
      title={null}
      onCancel={onClose}
      options={{ closeOnEsc: true, maskClosable: true, closable: false }}
      footer={null}
      size="lg"
      className="wk-secrets-modal"
    >
      <div className="wk-secrets">
        {/* 头部：标题 + 副标题 + 新增 */}
        <div className="wk-secrets__header">
          <div className="wk-secrets__heading">
            <h2 className="wk-secrets__title">
              <IconKey className="wk-secrets__title-icon" />
              {t("base.secrets.title")}
            </h2>
            <p className="wk-secrets__subtitle">{t("base.secrets.subtitle")}</p>
          </div>
          <WKButton
            variant="primary"
            icon={<IconPlus />}
            onClick={() => startCreate()}
          >
            {t("base.secrets.addButton")}
          </WKButton>
        </div>

        {/* 列表主体 */}
        {loading ? (
          <div className="wk-secrets__state">
            <Spin size="large" />
          </div>
        ) : error ? (
          <div className="wk-secrets__state">
            <p className="wk-secrets__state-text">{t("base.secrets.error.loadFailed")}</p>
            <WKButton variant="secondary" onClick={() => void load()}>
              {t("base.secrets.retry")}
            </WKButton>
          </div>
        ) : items.length === 0 ? (
          <div className="wk-secrets__empty">
            <div className="wk-secrets__empty-icon">
              <IconKey size="extra-large" />
            </div>
            <p className="wk-secrets__empty-text">{t("base.secrets.empty")}</p>
            <WKButton
              variant="primary"
              icon={<IconPlus />}
              onClick={() => startCreate()}
            >
              {t("base.secrets.empty.action")}
            </WKButton>
          </div>
        ) : (
          <ul className="wk-secrets__list">
            {items.map((secret) => (
              <li key={secret.secret_id} className="wk-secrets__card">
                <div className="wk-secrets__card-main">
                  <div className="wk-secrets__card-titlerow">
                    <span className="wk-secrets__card-name">{secret.display_name}</span>
                    <span
                      className={`wk-secrets__chip wk-secrets__chip--${secret.kind}`}
                    >
                      {secret.kind === "llm"
                        ? t("base.secrets.kind.llm")
                        : t("base.secrets.kind.external")}
                    </span>
                  </div>
                  <div className="wk-secrets__card-maskrow">
                    <code className="wk-secrets__mask">{secret.masked}</code>
                    <button
                      type="button"
                      className="wk-secrets__copyref"
                      onClick={() => handleCopyName(secret.display_name)}
                      title={t("base.secrets.action.copyName")}
                    >
                      <IconCopy size="small" />
                      {t("base.secrets.action.copyName")}
                    </button>
                  </div>
                  <div className="wk-secrets__card-meta">{renderMeta(secret)}</div>
                </div>
                <div className="wk-secrets__card-actions">
                  <button
                    type="button"
                    className="wk-secrets__icon-btn"
                    onClick={() => setEditTarget({ mode: "edit", secret })}
                    title={t("base.secrets.action.edit")}
                    aria-label={t("base.secrets.action.edit")}
                  >
                    <IconEdit />
                  </button>
                  <button
                    type="button"
                    className="wk-secrets__icon-btn"
                    onClick={() => setEditTarget({ mode: "edit", secret })}
                    title={t("base.secrets.action.updateKey")}
                    aria-label={t("base.secrets.action.updateKey")}
                  >
                    <IconRefresh />
                  </button>
                  <button
                    type="button"
                    className="wk-secrets__icon-btn wk-secrets__icon-btn--danger"
                    onClick={() => handleDelete(secret)}
                    title={t("base.secrets.action.delete")}
                    aria-label={t("base.secrets.action.delete")}
                  >
                    <IconDelete />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editTarget && (
        <SecretEditModal
          secret={editTarget.mode === "edit" ? editTarget.secret : undefined}
          existing={items}
          prefillName={editTarget.mode === "create" ? editTarget.prefillName : undefined}
          prefillValue={editTarget.mode === "create" ? editTarget.prefillValue : undefined}
          onClose={() => setEditTarget(null)}
          onSaved={() => void load()}
        />
      )}
    </WKModal>
  );
}
