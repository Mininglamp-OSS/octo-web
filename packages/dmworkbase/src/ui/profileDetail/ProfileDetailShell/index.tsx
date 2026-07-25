import React from "react";
import "./index.css";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface ProfileDetailMetaItem {
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface ProfileDetailShellProps {
  className?: string;
  contentClassName?: string;
  loadingClassName?: string;
  loading: boolean;
  loadingNode: React.ReactNode;
  closeLabel?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
}

export function ProfileDetailShell({
  className,
  contentClassName,
  loadingClassName,
  loading,
  loadingNode,
  closeLabel,
  footer,
  children,
  onClose,
}: ProfileDetailShellProps) {
  return (
    <div className={cx("wk-profile-detail", className)}>
      {onClose && (
        <div className="wk-profile-detail-route-header">
          <button
            type="button"
            className="wk-profile-detail-route-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <span
              className="wk-profile-detail-route-close-icon"
              aria-hidden="true"
            />
          </button>
        </div>
      )}
      {loading ? (
        <div className={cx("wk-profile-detail-loading", loadingClassName)}>
          {loadingNode}
        </div>
      ) : (
        <>
          <div className={cx("wk-profile-detail-scroll", contentClassName)}>
            {children}
          </div>
          {footer}
        </>
      )}
    </div>
  );
}

export interface ProfileDetailHeaderProps {
  className?: string;
  avatarClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  avatar: React.ReactNode;
  title: React.ReactNode;
  badges?: React.ReactNode;
  subtitle?: React.ReactNode;
  metaItems?: ProfileDetailMetaItem[];
  status?: React.ReactNode;
}

export function ProfileDetailHeader({
  className,
  avatarClassName,
  titleClassName,
  subtitleClassName,
  avatar,
  title,
  badges,
  subtitle,
  metaItems = [],
  status,
}: ProfileDetailHeaderProps) {
  const visibleMetaItems = metaItems.filter((item) => {
    return item.value !== undefined && item.value !== null && item.value !== "";
  });

  return (
    <div className={cx("wk-profile-detail-header", className)}>
      <div className={cx("wk-profile-detail-avatar", avatarClassName)}>
        {avatar}
      </div>
      <div className="wk-profile-detail-heading">
        <div className={cx("wk-profile-detail-title", titleClassName)}>
          <span className="wk-profile-detail-title-text">{title}</span>
          {badges}
        </div>
        {subtitle && (
          <div className={cx("wk-profile-detail-subtitle", subtitleClassName)}>
            {subtitle}
          </div>
        )}
        {visibleMetaItems.length > 0 && (
          <ul className="wk-profile-detail-meta-list">
            {visibleMetaItems.map((item, index) => (
              <li key={index} className="wk-profile-detail-meta-item">
                <span className="wk-profile-detail-meta-label">
                  {item.label}
                </span>
                <span className="wk-profile-detail-meta-value">
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
        )}
        {status}
      </div>
    </div>
  );
}

export interface ProfileDetailFooterProps {
  className?: string;
  actionClassName?: string;
  hintClassName?: string;
  action?: React.ReactNode;
  hint?: React.ReactNode;
}

export function ProfileDetailFooter({
  className,
  actionClassName,
  hintClassName,
  action,
  hint,
}: ProfileDetailFooterProps) {
  if (!action && !hint) {
    return null;
  }

  return (
    <div className={cx("wk-profile-detail-footer", className)}>
      {hint ? (
        <div className={cx("wk-profile-detail-footer-hint", hintClassName)}>
          {hint}
        </div>
      ) : (
        <div className={cx("wk-profile-detail-footer-action", actionClassName)}>
          {action}
        </div>
      )}
    </div>
  );
}

export default ProfileDetailShell;
