import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { IconLink } from "@douyinfe/semi-icons";
import SpaceItem from "./index";
import "../../theme/index.css";

const meta: Meta<typeof SpaceItem> = {
    title: "Space/SpaceItem",
    component: SpaceItem,
    parameters: { layout: "centered" },
    decorators: [
        (Story) => (
            <div style={{ width: 280, background: "var(--wk-bg-surface)", borderRadius: 12, padding: "4px 8px" }}>
                <Story />
            </div>
        ),
    ],
};
export default meta;
type Story = StoryObj<typeof SpaceItem>;

export const Default: Story = {
    args: { name: "Demo Space", meta: "12 成员" },
};

export const Selected: Story = {
    args: { name: "Demo Space", meta: "12 成员", selected: true },
};

export const NewUnread: Story = {
    args: { name: "产品团队", meta: "8 成员", unreadCount: 3, unreadTone: "new" },
};

export const TotalUnread: Story = {
    args: { name: "研发中心", meta: "20 成员", unreadCount: 30, unreadTone: "total" },
};

export const UnreadOverflow: Story = {
    args: { name: "客户成功", meta: "12 成员", unreadCount: 128, unreadTone: "new" },
};

export const WithActions: Story = {
    args: {
        name: "OctoSpace",
        meta: "8 成员",
        actions: (
            <button
                style={{
                    width: 22, height: 22, border: "none", background: "none",
                    cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", borderRadius: 4, color: "#999",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <IconLink size="small" />
            </button>
        ),
    },
};

export const List: Story = {
    render: () => {
        const spaces = [
            { id: "1", name: "Demo Space", meta: "12 成员", selected: true },
            { id: "2", name: "OctoSpace", meta: "8 成员" },
            { id: "3", name: "Octo", meta: "6 成员" },
            { id: "4", name: "test0311", meta: "3/10 成员" },
        ];
        return (
            <div style={{ width: 220, background: "var(--wk-bg-surface)", borderRadius: 14, padding: "8px" }}>
                {spaces.map((s) => (
                    <SpaceItem
                        key={s.id}
                        name={s.name}
                        meta={s.meta}
                        selected={s.selected}
                        actions={
                            <button
                                style={{
                                    width: 22, height: 22, border: "none", background: "none",
                                    cursor: "pointer", display: "flex", alignItems: "center",
                                    justifyContent: "center", borderRadius: 4, color: "#999",
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <IconLink size="small" />
                            </button>
                        }
                    />
                ))}
            </div>
        );
    },
};
