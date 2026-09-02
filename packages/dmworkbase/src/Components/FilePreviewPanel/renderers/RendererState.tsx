import React, { memo } from "react";
import { useI18n } from "../../../i18n";
import { Loading } from "@octo/ui";
import "./RendererState.css";

export type RendererStateType = "loading" | "error" | "empty";

export interface RendererStateProps {
  /** 状态类型 */
  type: RendererStateType;
  /** 消息内容 */
  message?: string;
  /** 重试回调（仅 error 状态显示） */
  onRetry?: () => void;
  /** 自定义类名前缀 */
  className?: string;
}

const defaultMessageKeys: Record<RendererStateType, string> = {
  loading: "base.filePreview.loading",
  error: "base.filePreview.loadFailed",
  empty: "base.filePreview.empty",
};

/**
 * 渲染器通用状态组件
 * 统一处理 loading、error、empty 三种状态的 UI 展示
 */
export const RendererState = memo(function RendererState({
  type,
  message,
  onRetry,
  className,
}: RendererStateProps) {
  const { t } = useI18n();
  const displayMessage = message || t(defaultMessageKeys[type]);
  const baseClass = className || "wk-renderer-state";

  return (
    <div className={`${baseClass} ${baseClass}--${type}`}>
      {type === "loading" ? (
        <Loading text={displayMessage} layout="vertical" />
      ) : (
        <span className={`${baseClass}__message`}>{displayMessage}</span>
      )}
      {type === "error" && onRetry && (
        <button className={`${baseClass}__retry`} onClick={onRetry}>
          {t("base.filePreview.retry")}
        </button>
      )}
    </div>
  );
});

export default RendererState;
