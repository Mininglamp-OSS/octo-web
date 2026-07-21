import { Input, Spin } from "@douyinfe/semi-ui";
import { Camera, Check, ChevronRight, Edit3, QrCode } from "lucide-react";
import React from "react";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import WKButton from "../WKButton";

interface MeInfoSectionProps {
    title: React.ReactNode;
    children: React.ReactNode;
}

interface MeInfoNavRowProps {
    title: React.ReactNode;
    value?: React.ReactNode;
    right?: React.ReactNode;
    showChevron?: boolean;
    onClick?: () => void;
}

export interface MeInfoPanelProps {
    avatar: React.ReactNode;
    avatarMini?: React.ReactNode;
    displayName: React.ReactNode;
    isRealnameVerified: boolean;
    shortNo?: React.ReactNode;
    profileTitle: React.ReactNode;
    preferencesTitle: React.ReactNode;
    securityTitle: React.ReactNode;
    avatarLabel: string;
    nameLabel: React.ReactNode;
    shortNoLabel: React.ReactNode;
    qrcodeLabel: React.ReactNode;
    genderLabel: React.ReactNode;
    realnameLabel: React.ReactNode;
    experimentalFeaturesLabel: React.ReactNode;
    avatarActionLabel: string;
    editNameLabel: string;
    namePlaceholder: string;
    notSetLabel: React.ReactNode;
    saveLabel: React.ReactNode;
    cancelLabel: React.ReactNode;
    nameValue: string;
    nameDraft: string;
    genderValue: React.ReactNode;
    realnameValue: React.ReactNode;
    showExperimentalFeatures: boolean;
    editingName: boolean;
    savingName: boolean;
    uploadingAvatar: boolean;
    onChooseAvatar: () => void;
    onStartEditName: () => void;
    onNameDraftChange: (value: string) => void;
    onCancelName: () => void;
    onSaveName: () => void;
    onShortNoTap: () => void;
    onShowQrCode: () => void;
    onShowGender: () => void;
    onRealnameClick: () => void;
    onShowExperimentalFeatures: () => void;
}

function MeInfoSection({ title, children }: MeInfoSectionProps) {
    return <section className="wk-meinfo-section">
        <div className="wk-meinfo-section-title">{title}</div>
        <div className="wk-meinfo-section-rows">{children}</div>
    </section>
}

function MeInfoNavRow({ title, value, right, showChevron = true, onClick }: MeInfoNavRowProps) {
    const content = <>
        <span className="wk-meinfo-row-main">
            <span className="wk-meinfo-row-label">{title}</span>
            {value !== undefined && <span className="wk-meinfo-row-value">{value}</span>}
        </span>
        <span className="wk-meinfo-row-side">
            {right}
            {onClick && showChevron && <ChevronRight size={16} aria-hidden="true" />}
        </span>
    </>
    if (onClick) {
        return <button type="button" className="wk-meinfo-row wk-meinfo-row--button" onClick={onClick}>
            {content}
        </button>
    }
    return <div className="wk-meinfo-row">{content}</div>
}

export default function MeInfoPanel({
    avatar,
    avatarMini,
    displayName,
    isRealnameVerified,
    shortNo,
    profileTitle,
    preferencesTitle,
    securityTitle,
    avatarLabel,
    nameLabel,
    shortNoLabel,
    qrcodeLabel,
    genderLabel,
    realnameLabel,
    experimentalFeaturesLabel,
    avatarActionLabel,
    editNameLabel,
    namePlaceholder,
    notSetLabel,
    saveLabel,
    cancelLabel,
    nameValue,
    nameDraft,
    genderValue,
    realnameValue,
    showExperimentalFeatures,
    editingName,
    savingName,
    uploadingAvatar,
    onChooseAvatar,
    onStartEditName,
    onNameDraftChange,
    onCancelName,
    onSaveName,
    onShortNoTap,
    onShowQrCode,
    onShowGender,
    onRealnameClick,
    onShowExperimentalFeatures,
}: MeInfoPanelProps) {
    const displayedName = displayName || notSetLabel
    const displayedNameValue = nameValue || notSetLabel
    return <div className="wk-meinfo-panel">
        <div className="wk-meinfo-header">
            <button
                type="button"
                className="wk-meinfo-avatar-button"
                onClick={onChooseAvatar}
                aria-label={avatarActionLabel}
                title={avatarActionLabel}
            >
                {avatar}
                <span className="wk-meinfo-avatar-overlay" aria-hidden="true">
                    <Camera size={18} />
                </span>
                {uploadingAvatar && <span className="wk-meinfo-avatar-loading" aria-hidden="true">
                    <Spin size="small" />
                </span>}
            </button>
            <div className="wk-meinfo-header-main">
                <div className="wk-meinfo-display-name">
                    <span className="wk-meinfo-display-name-text">{displayedName}</span>
                    {isRealnameVerified && <RealnameVerifiedBadge />}
                </div>
                <div className="wk-meinfo-header-meta">
                    <span>{shortNoLabel}</span>
                    <span className="wk-meinfo-header-meta-value">{shortNo || notSetLabel}</span>
                </div>
            </div>
        </div>

        <MeInfoSection title={profileTitle}>
            <MeInfoNavRow
                title={avatarLabel}
                right={<span className="wk-meinfo-avatar-mini">{avatarMini || avatar}</span>}
                showChevron={false}
                onClick={onChooseAvatar}
            />
            <div className={`wk-meinfo-row wk-meinfo-row--editable${editingName ? " wk-meinfo-row--editing" : ""}`}>
                <span className="wk-meinfo-row-main">
                    <span className="wk-meinfo-row-label">{nameLabel}</span>
                    {editingName ? <span className="wk-meinfo-name-editor">
                        <Input
                            value={nameDraft}
                            onChange={onNameDraftChange}
                            placeholder={namePlaceholder}
                            maxLength={20}
                            disabled={savingName}
                        />
                        <span className="wk-meinfo-name-actions">
                            <WKButton
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={savingName}
                                onClick={onCancelName}
                            >
                                {cancelLabel}
                            </WKButton>
                            <WKButton
                                type="button"
                                variant="primary"
                                size="sm"
                                loading={savingName}
                                onClick={onSaveName}
                            >
                                {saveLabel}
                            </WKButton>
                        </span>
                    </span> : <span className="wk-meinfo-row-value">{displayedNameValue}</span>}
                </span>
                {!editingName && <button
                    type="button"
                    className="wk-meinfo-icon-action"
                    onClick={onStartEditName}
                    aria-label={editNameLabel}
                    title={editNameLabel}
                >
                    <Edit3 size={16} />
                </button>}
            </div>
            <MeInfoNavRow title={shortNoLabel} value={shortNo || notSetLabel} onClick={onShortNoTap} />
            <MeInfoNavRow title={qrcodeLabel} right={<QrCode size={16} aria-hidden="true" />} onClick={onShowQrCode} />
        </MeInfoSection>

        <MeInfoSection title={preferencesTitle}>
            <MeInfoNavRow title={genderLabel} value={genderValue} onClick={onShowGender} />
        </MeInfoSection>

        <MeInfoSection title={securityTitle}>
            <MeInfoNavRow
                title={realnameLabel}
                value={realnameValue}
                right={isRealnameVerified ? <Check size={16} aria-hidden="true" /> : undefined}
                onClick={isRealnameVerified ? undefined : onRealnameClick}
            />
        </MeInfoSection>

        {showExperimentalFeatures && <MeInfoSection title={experimentalFeaturesLabel}>
            <MeInfoNavRow title={experimentalFeaturesLabel} onClick={onShowExperimentalFeatures} />
        </MeInfoSection>}
    </div>
}

export { MeInfoPanel };
