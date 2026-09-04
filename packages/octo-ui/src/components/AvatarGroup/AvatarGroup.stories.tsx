import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import Avatar from "../Avatar";
import AvatarGroup from "./index";

const meta: Meta<typeof AvatarGroup> = {
  title: "Octo UI/AvatarGroup",
  component: AvatarGroup,
  parameters: {
    docs: {
      description: {
        component:
          "Layout-only avatar group. It shows at most three avatars, uses an 8px overlap, and never renders a separating border or +N item.",
      },
    },
  },
  argTypes: {
    size: { control: "radio", options: [16, 20] },
    max: { control: "radio", options: [1, 2, 3] },
  },
};

export default meta;
type Story = StoryObj<typeof AvatarGroup>;

const avatars = [
  <Avatar key="one" alt="刘一" fallbackText="刘一" tone={0} />,
  <Avatar key="two" alt="张三" fallbackText="张三" tone={1} />,
  <Avatar key="three" alt="王五" fallbackText="王五" tone={8} />,
  <Avatar key="four" alt="李四" fallbackText="李四" tone={6} />,
];

const Case = ({ title, children }: { title: string; children: ReactNode }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--wk-sp-3)",
    }}
  >
    <span style={{ minWidth: "var(--wk-sp-10)" }}>{title}</span>
    {children}
  </div>
);

export const Playground: Story = {
  args: {
    children: avatars,
    size: 16,
    max: 3,
    label: "Participants",
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--wk-sp-4)" }}>
      <Case title="16px">
        <AvatarGroup size={16} label="16px participants">
          {avatars}
        </AvatarGroup>
      </Case>
      <Case title="20px">
        <AvatarGroup size={20} label="20px participants">
          {avatars}
        </AvatarGroup>
      </Case>
    </div>
  ),
};

export const Counts: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--wk-sp-4)" }}>
      {[1, 2, 3, 4].map((count) => (
        <Case key={count} title={`${count} item`}>
          <AvatarGroup size={20} label={`${count} participants`}>
            {avatars.slice(0, count)}
          </AvatarGroup>
        </Case>
      ))}
    </div>
  ),
};

export const MixedKinds: Story = {
  render: () => (
    <AvatarGroup size={20} label="Mixed people and groups">
      <Avatar alt="刘一" fallbackText="刘一" tone={0} />
      <Avatar alt="架构讨论" fallbackText="架构讨论" kind="group" tone={8} />
      <Avatar alt="Unnamed group" kind="group" tone={9} />
    </AvatarGroup>
  ),
};
