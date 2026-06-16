import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import MixedContent from "./index";

const meta: Meta<typeof MixedContent> = {
  title: "ui/message/MixedContent",
  component: MixedContent,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "720px", padding: "var(--wk-sp-5)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MixedContent>;

export const TextAndImages: Story = {
  args: {
    blocks: [
      { id: "t1", type: "text", content: "这是一条按顺序渲染的图文混排消息。" },
      {
        id: "i1",
        type: "image",
        src: "https://picsum.photos/900/520?random=richtext-1",
        alt: "preview",
      },
      {
        id: "t2",
        type: "text",
        content: "图片之后继续显示正文，保持在同一条消息里。",
      },
    ],
  },
};

export const MentionAndLink: Story = {
  args: {
    blocks: [
      {
        id: "t1",
        type: "text",
        content:
          "文字\n@哈 https://github.com/Mininglamp-OSS/octo-web/issues/355\n测试测试",
        mentions: [{ name: "@哈", uid: "ha" }],
      },
    ],
  },
};

export const TextAndFile: Story = {
  args: {
    blocks: [
      {
        id: "t1",
        type: "text",
        content: "这个 story 用来预览未来 file block 的展示。",
      },
      {
        id: "f1",
        type: "file",
        name: "产品需求说明.pdf",
        size: "2.4 MB",
        extension: "PDF",
        iconLabel: "PDF",
        url: "https://example.com/product.pdf",
      },
      {
        id: "t2",
        type: "text",
        content: "发送协议未打开前，文件仍会拆成独立消息发送。",
      },
    ],
    onFileDownload: () => alert("下载文件"),
  },
};
