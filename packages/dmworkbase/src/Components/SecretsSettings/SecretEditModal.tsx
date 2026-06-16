import React, { useState, useCallback, useEffect, useRef } from "react";
import { Toast } from "@douyinfe/semi-ui";
import {
  IconKey,
  IconLock,
  IconEyeOpened,
  IconEyeClosed,
} from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import { useI18n } from "../../i18n";
import SecretsService, {
  SecretKind,
  SecretListItem,
} from "../../Service/SecretsService";
import { extractErrorMsg } from "../../Service/APIClient";
import "./SecretsSettings.css";

export interface SecretEditModalProps {
  /** 编辑模式传入现有项；新增模式不传 */
  secret?: SecretListItem;
  /** 现有列表（用于实时重名校验，排除自身） */
  existing: SecretListItem[];
  /** 深链/防手滑预填的明文（仅本地预填，绝不自动发送/保存） */
  prefillValue?: string;
  /** 深链预填名字 */
  prefillName?: string;
  /** 深链预填类型 */
  prefillKind?: SecretKind;
  onClose: () => void;
  /** 保存成功回调，父级据此刷新列表 */
  onSaved: () => void;
}

/**
 * 新增 / 编辑密钥弹窗 —— 本 feature 的核心安全交互（YUJ-3539）。
 *
 * 安全约束：
 *  - 密钥值 write-only：默认密文遮挡（type=password），仅提供「小眼睛」做输入自检；
 *  - 保存后永不回显原值：编辑模式下值输入框为空，旁注「已设置 ••••尾4，要更换请输入新值」；
 *  - 明文只在「本弹窗 → SecretsService → 后端」直链上出现，不经任何聊天流。
 */
export default function SecretEditModal({
  secret,
  existing,
  prefillValue,
  prefillName,
  prefillKind,
  onClose,
  onSaved,
}: SecretEditModalProps) {
  const { t } = useI18n();
  const isEdit = !!secret;

  const [name, setName] = useState<string>(secret?.display_name ?? prefillName ?? "");
  const [kind, setKind] = useState<SecretKind>(secret?.kind ?? prefillKind ?? "llm");
  const [value, setValue] = useState<string>(isEdit ? "" : prefillValue ?? "");
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 打开即聚焦名字输入，语音/键盘用户更顺手
    nameInputRef.current?.focus();
  }, []);

  // 实时重名校验（前端预判，最终以后端唯一性为准）。编辑时排除自身。
  const normalized = SecretsService.normalizeName(name);
  const duplicate =
    normalized.length > 0 &&
    existing.some(
      (s) =>
        s.secret_id !== secret?.secret_id &&
        SecretsService.normalizeName(s.display_name) === normalized
    );

  const nameValid = name.trim().length > 0 && !duplicate;
  // 编辑模式允许只改名（value 可空）；新增模式必须填值。
  const valueValid = isEdit ? true : value.trim().length > 0;
  const canSubmit = nameValid && valueValid && !saving;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      if (isEdit && secret) {
        const req: { display_name?: string; key?: string; kind?: SecretKind } = {};
        if (name.trim() !== secret.display_name) req.display_name = name.trim();
        if (kind !== secret.kind) req.kind = kind;
        if (value.trim().length > 0) req.key = value.trim();
        await SecretsService.shared.update(secret.secret_id, req);
        Toast.success(t("base.secrets.toast.updated"));
      } else {
        await SecretsService.shared.create({
          display_name: name.trim(),
          kind,
          key: value.trim(),
        });
        Toast.success(t("base.secrets.toast.created"));
      }
      onSaved();
      onClose();
    } catch (e) {
      // 409 / duplicate → 提示换名；其余回显后端 msg 兜底通用错误
      const err = e as { status?: number; code?: string };
      if (err?.status === 409 || (err?.code ?? "").includes("duplicate")) {
        Toast.error(t("base.secrets.error.duplicate"));
      } else {
        Toast.error(extractErrorMsg(e) || t("base.secrets.error.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  }, [canSubmit, isEdit, secret, name, kind, value, onSaved, onClose, t]);

  return (
    <WKModal
      visible
      title={isEdit ? t("base.secrets.edit.title") : t("base.secrets.create.title")}
      onCancel={onClose}
      options={{ closeOnEsc: true, maskClosable: false }}
      footer={
        <>
          <WKButton variant="ghost" onClick={onClose} disabled={saving}>
            {t("base.common.cancel")}
          </WKButton>
          <WKButton
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={saving}
          >
            {t("base.common.save")}
          </WKButton>
        </>
      }
      className="wk-secrets-modal"
    >
      <div className="wk-secrets-form">
        {/* 名字 */}
        <div className="wk-secrets-form__field">
          <label className="wk-secrets-form__label">
            {t("base.secrets.field.name")}
            <span className="wk-secrets-form__required">*</span>
          </label>
          <input
            ref={nameInputRef}
            className="wk-secrets-form__input"
            type="text"
            value={name}
            placeholder={t("base.secrets.field.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={duplicate}
          />
          {duplicate && (
            <div className="wk-secrets-form__error">
              {t("base.secrets.error.duplicate")}
            </div>
          )}
        </div>

        {/* 类型 */}
        <div className="wk-secrets-form__field">
          <label className="wk-secrets-form__label">
            {t("base.secrets.field.kind")}
          </label>
          <div className="wk-secrets-form__kind">
            <button
              type="button"
              className={`wk-secrets-form__kind-option${kind === "llm" ? " is-active" : ""}`}
              onClick={() => setKind("llm")}
            >
              <IconKey size="small" />
              {t("base.secrets.kind.llm")}
            </button>
            <button
              type="button"
              className={`wk-secrets-form__kind-option${kind === "external" ? " is-active" : ""}`}
              onClick={() => setKind("external")}
            >
              {t("base.secrets.kind.external")}
            </button>
          </div>
        </div>

        {/* 密钥值（write-only） */}
        <div className="wk-secrets-form__field">
          <label className="wk-secrets-form__label">
            {t("base.secrets.field.value")}
            {!isEdit && <span className="wk-secrets-form__required">*</span>}
          </label>
          {isEdit && (
            <div className="wk-secrets-form__hint">
              {t("base.secrets.edit.valueSet", {
                values: { last4: secret?.last4 ?? "" },
              })}
            </div>
          )}
          <div className="wk-secrets-form__value-wrap">
            <input
              className="wk-secrets-form__input wk-secrets-form__input--value"
              type={revealed ? "text" : "password"}
              value={value}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                isEdit
                  ? t("base.secrets.field.valuePlaceholderEdit")
                  : t("base.secrets.field.valuePlaceholder")
              }
              onChange={(e) => setValue(e.target.value)}
            />
            <button
              type="button"
              className="wk-secrets-form__reveal"
              onClick={() => setRevealed((v) => !v)}
              aria-label={
                revealed
                  ? t("base.secrets.field.hideValue")
                  : t("base.secrets.field.showValue")
              }
              title={
                revealed
                  ? t("base.secrets.field.hideValue")
                  : t("base.secrets.field.showValue")
              }
            >
              {revealed ? <IconEyeClosed /> : <IconEyeOpened />}
            </button>
          </div>
        </div>

        {/* 安全说明 */}
        <div className="wk-secrets-form__security">
          <IconLock size="small" className="wk-secrets-form__security-icon" />
          <span>{t("base.secrets.security.note")}</span>
        </div>
      </div>
    </WKModal>
  );
}
