import type { Meta, StoryObj } from "@storybook/react";
import JoinApprovalResult from "./index";

const meta: Meta<typeof JoinApprovalResult> = {
    title: "Web/JoinApprovalResult",
    component: JoinApprovalResult,
    parameters: {
        layout: "fullscreen",
    },
};

export default meta;
type Story = StoryObj<typeof JoinApprovalResult>;

/**
 * NEED_APPROVAL：首次申请，审批已提交，等待管理员处理。
 */
export const NeedApproval: Story = {
    args: {
        status: "need_approval",
        onDismiss: () => console.log("dismiss"),
    },
};

/**
 * Pending：已有申请在审批中，无需重复提交。
 */
export const AlreadyPending: Story = {
    args: {
        status: "pending",
        onDismiss: () => console.log("dismiss"),
    },
};
