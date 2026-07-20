import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import MeInfoPanel from "./MeInfoPanel";
import "./index.css";

interface MeInfoPreviewProps {
    name: string;
    shortNo: string;
    gender: string;
    realname: string;
    isRealnameVerified: boolean;
    editingName?: boolean;
    savingName?: boolean;
    uploadingAvatar?: boolean;
    showExperimentalFeatures?: boolean;
}

function PreviewAvatar({ text }: { text: string }) {
    return <div className="wk-meinfo-story-avatar">{text}</div>
}

function MeInfoPreview({
    name,
    shortNo,
    gender,
    realname,
    isRealnameVerified,
    editingName,
    savingName,
    uploadingAvatar,
    showExperimentalFeatures,
}: MeInfoPreviewProps) {
    return <div className="wk-meinfo">
        <MeInfoPanel
            avatar={<PreviewAvatar text={name.slice(0, 1) || "M"} />}
            avatarMini={<PreviewAvatar text={name.slice(0, 1) || "M"} />}
            displayName={name}
            isRealnameVerified={isRealnameVerified}
            shortNo={shortNo}
            profileTitle="Profile"
            preferencesTitle="Preferences"
            securityTitle="Account security"
            avatarLabel="Avatar"
            nameLabel="Name"
            shortNoLabel="OCTO ID"
            qrcodeLabel="My QR code"
            genderLabel="Gender"
            realnameLabel="Real-name verification"
            experimentalFeaturesLabel="Experimental features"
            avatarActionLabel="Change avatar"
            editNameLabel="Edit name"
            namePlaceholder="Set name"
            notSetLabel="Not set"
            saveLabel="Save"
            cancelLabel="Cancel"
            nameValue={name}
            nameDraft={name}
            genderValue={gender}
            realnameValue={realname}
            showExperimentalFeatures={!!showExperimentalFeatures}
            editingName={!!editingName}
            savingName={!!savingName}
            uploadingAvatar={!!uploadingAvatar}
            onChooseAvatar={() => undefined}
            onStartEditName={() => undefined}
            onNameDraftChange={() => undefined}
            onCancelName={() => undefined}
            onSaveName={() => undefined}
            onShortNoTap={() => undefined}
            onShowQrCode={() => undefined}
            onShowGender={() => undefined}
            onRealnameClick={() => undefined}
            onShowExperimentalFeatures={() => undefined}
        />
    </div>
}

const meta: Meta<typeof MeInfoPreview> = {
    title: "Business/MeInfo",
    component: MeInfoPreview,
    parameters: {
        docs: {
            description: {
                component: "MeInfo profile detail pilot, covering the identity header, inline name editing, sibling modal entry rows, security status, and lab-mode entry.",
            },
        },
    },
    args: {
        name: "Alice Chen",
        shortNo: "octo_1001",
        gender: "Female",
        realname: "Verified · 2026-07",
        isRealnameVerified: true,
        editingName: false,
        savingName: false,
        uploadingAvatar: false,
        showExperimentalFeatures: false,
    },
    decorators: [
        (Story) => <div className="wk-meinfo-story-frame">
            <Story />
        </div>,
    ],
};

export default meta;
type Story = StoryObj<typeof MeInfoPreview>;

export const Default: Story = {
    name: "Default",
};

export const Unverified: Story = {
    name: "Unverified",
    args: {
        isRealnameVerified: false,
        realname: "Verify",
    },
};

export const EditingName: Story = {
    name: "Editing name",
    args: {
        editingName: true,
    },
};

export const SavingName: Story = {
    name: "Saving name",
    args: {
        editingName: true,
        savingName: true,
    },
};

export const UploadingAvatar: Story = {
    name: "Uploading avatar",
    args: {
        uploadingAvatar: true,
    },
};

export const LabEnabled: Story = {
    name: "Lab enabled",
    args: {
        showExperimentalFeatures: true,
    },
};

export const LongText: Story = {
    name: "Long text",
    args: {
        name: "A very long verified display name that should wrap cleanly without pushing controls out of the panel",
        shortNo: "octo_extremely_long_identifier_000000000000000001",
        gender: "Female",
        realname: "Verified · 2026-07",
        showExperimentalFeatures: true,
    },
};
