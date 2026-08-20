import { Button } from "@octo/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";

import { showJoinSuccessToast, JoinSuccessToastOptions } from "./index";
import "../../theme/index.css";
import "./index.css";

/**
 * dmwork-web#1065 — Storybook for 加入成功 toast
 *
 * 场景：
 * - 同 Space / 单 Space：常规 toast
 * - 跨 Space：双行 + 「切换过去」action
 * - 点击 action：currentSpaceId 变化（由 onSwitch 回调处理）
 */
const meta: Meta<typeof PreviewHarness> = {
    title: "Space/JoinSuccessToast",
    component: PreviewHarness,
    parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof PreviewHarness>;

function PreviewHarness(props: JoinSuccessToastOptions & { label: string }) {
    const { label, ...opts } = props;
    const [switchedTo, setSwitchedTo] = React.useState<string | null>(null);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Button
                type="primary"
                onClick={() => {
                    showJoinSuccessToast({
                        ...opts,
                        onSwitch: () => setSwitchedTo(opts.spaceName),
                    });
                }}
            >
                {label}
            </Button>
            <div style={{ color: "#5A5C70", fontSize: 12 }}>
                {switchedTo
                    ? `✅ onSwitch fired → currentSpaceId would move to ${switchedTo}`
                    : "点击按钮弹出 toast；若包含「切换过去」，点击后这里会出现回调结果。"}
            </div>
        </div>
    );
}

export const SingleSpace: Story = {
    name: "同 Space / 单 Space — 常规 toast",
    args: {
        entityName: "Demo Space",
        spaceName: "Demo Space",
        crossSpace: false,
        label: "Show regular toast",
    },
};

export const CrossSpace: Story = {
    name: "跨 Space — 双行 + 切换按钮",
    args: {
        entityName: "项目 A",
        spaceName: "ExampleCorp",
        crossSpace: true,
        label: "Show cross-space toast",
    },
};

export const CrossSpaceLongName: Story = {
    name: "跨 Space — 超长空间名换行",
    args: {
        entityName: "超长名字群聊一二三四五六七八",
        spaceName: "ExampleCorp 科技工程部门",
        crossSpace: true,
        label: "Show cross-space toast (long)",
    },
};
