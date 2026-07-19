import React from "react";
import { Input, Spin } from "@douyinfe/semi-ui";
import { IconEdit } from "@douyinfe/semi-icons";
import Sections from "../../../Components/Sections";
import WKButton from "../../../Components/WKButton";
import AiBadge from "../../../Components/AiBadge";
import RealnameVerifiedBadge from "../../../Components/RealnameVerifiedBadge";
import type { UserInfoMetaItem } from "../../../Components/UserInfo/UserInfoMetaList";
import ProfileDetailShell, {
  ProfileDetailFooter,
  ProfileDetailHeader,
} from "../ProfileDetailShell";
import "./index.css";

type UserInfoViewSections = React.ComponentProps<typeof Sections>["sections"];

export interface UserInfoViewLabels {
  remark: string;
  remarkPlaceholder: string;
  editRemark: string;
  cancel: string;
  save: string;
  notSet: string;
}

export interface UserInfoViewFooter {
  action?: React.ReactNode;
  hint?: React.ReactNode;
}

export interface UserInfoViewProps {
  loading: boolean;
  avatar: React.ReactNode;
  displayName: React.ReactNode;
  isBot: boolean;
  isRealnameVerified: boolean;
  metaItems: UserInfoMetaItem[];
  showRemarkEditor: boolean;
  editingRemark: boolean;
  remark: string;
  remarkDraft: string;
  savingRemark: boolean;
  sections: UserInfoViewSections;
  footerAction?: React.ReactNode;
  footerHint?: React.ReactNode;
  labels: UserInfoViewLabels;
  onRemarkDraftChange: (value: string) => void;
  onStartEditRemark: () => void;
  onCancelEditRemark: () => void;
  onSaveRemark: () => void;
}

function UserInfoView({
  loading,
  avatar,
  displayName,
  isBot,
  isRealnameVerified,
  metaItems,
  showRemarkEditor,
  editingRemark,
  remark,
  remarkDraft,
  savingRemark,
  sections,
  footerAction,
  footerHint,
  labels,
  onRemarkDraftChange,
  onStartEditRemark,
  onCancelEditRemark,
  onSaveRemark,
}: UserInfoViewProps) {
  const hasFooter = !!footerAction || !!footerHint;

  return (
    <ProfileDetailShell
      className={`wk-userinfo ${hasFooter ? "wk-userinfo--with-footer" : ""}`}
      contentClassName="wk-userinfo-content"
      loadingClassName="wk-userinfo-loading"
      loading={loading}
      loadingNode={<Spin />}
      footer={
        <ProfileDetailFooter
          className="wk-userInfo-footer"
          actionClassName="wk-userinfo-footer-sendbutton"
          hintClassName="wk-userinfo-footer-external-hint"
          action={footerAction}
          hint={footerHint}
        />
      }
    >
      <ProfileDetailHeader
        className="wk-userinfo-header"
        avatarClassName="wk-userinfo-user-avatar"
        titleClassName="wk-userinfo-user-info-name"
        avatar={avatar}
        title={displayName}
        badges={
          <>
            {isBot && <AiBadge />}
            {isRealnameVerified && <RealnameVerifiedBadge />}
          </>
        }
        metaItems={metaItems}
      />
      {showRemarkEditor && (
        <div className="wk-userinfo-remark-section">
          <div className="wk-userinfo-remark-row">
            <div className="wk-userinfo-remark-main">
              <div className="wk-userinfo-remark-label">{labels.remark}</div>
              {editingRemark ? (
                <div className="wk-userinfo-remark-editor">
                  <Input
                    value={remarkDraft}
                    onChange={onRemarkDraftChange}
                    placeholder={labels.remarkPlaceholder}
                    maxLength={30}
                  />
                  <div className="wk-userinfo-remark-actions">
                    <WKButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={savingRemark}
                      onClick={onCancelEditRemark}
                    >
                      {labels.cancel}
                    </WKButton>
                    <WKButton
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={savingRemark}
                      onClick={onSaveRemark}
                    >
                      {labels.save}
                    </WKButton>
                  </div>
                </div>
              ) : (
                <div className="wk-userinfo-remark-value">
                  {remark || (
                    <span className="wk-userinfo-remark-empty">
                      {labels.notSet}
                    </span>
                  )}
                </div>
              )}
            </div>
            {!editingRemark && (
              <button
                type="button"
                className="wk-userinfo-remark-edit"
                onClick={onStartEditRemark}
                aria-label={labels.editRemark}
                title={labels.editRemark}
              >
                <IconEdit />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="wk-userinfo-sections">
        <Sections sections={sections} />
      </div>
    </ProfileDetailShell>
  );
}

export default UserInfoView;
export { UserInfoView };
