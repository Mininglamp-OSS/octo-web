import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import Loading from "./index";
import type { LoadingSize } from "./types";

const meta: Meta<typeof Loading> = {
  title: "Octo UI/Loading",
  component: Loading,
  parameters: {
    docs: {
      description: {
        component:
          "Loading primitive matched to Web Component Overview: 270-degree purple conic arc, rounded deep-end dot, 0.8s rotation, 16/24/40px sizes, and ring-only/horizontal/vertical layouts.",
      },
    },
  },
  argTypes: {
    size: { control: "radio", options: ["sm", "md", "lg"] },
    layout: { control: "radio", options: ["inline", "vertical"] },
  },
};

export default meta;
type Story = StoryObj<typeof Loading>;

const sizes: LoadingSize[] = ["sm", "md", "lg"];

const Cell = ({
  children,
  caption,
}: {
  children: ReactNode;
  caption: string;
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "calc(var(--wk-sp-3) + var(--wk-sp-0-5))",
    }}
  >
    {children}
    <span
      style={{
        color: "var(--wk-text-legacy-tertiary)",
        fontSize: "var(--wk-text-size-sm)",
        lineHeight: "var(--wk-sp-4)",
      }}
    >
      {caption}
    </span>
  </div>
);

export const Playground: Story = {
  args: {
    size: "md",
    text: "Loading",
    layout: "inline",
  },
};

export const DesignVariants: Story = {
  name: "Design Variants",
  render: () => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "calc(var(--wk-sp-8) + var(--wk-sp-1)) calc(var(--wk-sp-12) + var(--wk-sp-2))",
        alignItems: "flex-start",
        padding: "calc(var(--wk-sp-6) + var(--wk-sp-1))",
        border: "1px solid var(--wk-border-default)",
        borderRadius: "calc(var(--wk-r-md) + var(--wk-sp-1))",
        background: "var(--wk-bg-surface)",
      }}
    >
      {sizes.map((size) => (
        <Cell
          key={`ring-${size}`}
          caption={`${
            size === "sm" ? "小" : size === "md" ? "中" : "大"
          } · 纯环 ${size === "sm" ? 16 : size === "md" ? 24 : 40}`}
        >
          <Loading size={size} />
        </Cell>
      ))}
      {sizes.map((size) => (
        <Cell
          key={`inline-${size}`}
          caption={`${
            size === "sm" ? "小" : size === "md" ? "中" : "大"
          } · 水平`}
        >
          <Loading size={size} text="描述文案" />
        </Cell>
      ))}
      {sizes.map((size) => (
        <Cell
          key={`vertical-${size}`}
          caption={`${
            size === "sm" ? "小" : size === "md" ? "中" : "大"
          } · 垂直`}
        >
          <Loading size={size} layout="vertical" text="描述文案" />
        </Cell>
      ))}
    </div>
  ),
};
