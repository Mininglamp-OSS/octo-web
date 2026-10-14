import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloudUpload, Download } from "lucide-react";
import FileCard from "./index";

const meta: Meta<typeof FileCard> = {
  title: "Base/FileCard",
  component: FileCard,
  args: { name: "05-产品说明书.md", size: "62.5 KB" },
};
export default meta;
type Story = StoryObj<typeof FileCard>;

const actions = (english = false) => (
  <>
    <button
      className="wk-file-card-action"
      type="button"
      aria-label={english ? "Save to drive" : "保存到网盘"}
      title={english ? "Save to drive" : "保存到网盘"}
    >
      <CloudUpload />
    </button>
    <button
      className="wk-file-card-action"
      type="button"
      aria-label={english ? "Download" : "下载"}
      title={english ? "Download" : "下载"}
    >
      <Download />
    </button>
  </>
);
export const Default: Story = { args: { actions: actions() } };
export const AllVariants: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "var(--wk-sp-3)",
        gridTemplateColumns: "repeat(3, max-content)",
      }}
    >
      {[
        "05-产品说明书.md",
        "OctoBuddy-v02-20260914-1549.html",
        "超长文件名按字符换行abcdefghijk1234567890abcdefghijklmnopqrstuvwxyz.zip",
        "README",
        "archive.verylongextension",
      ].map((name) => (
        <React.Fragment key={name}>
          <FileCard
            name={name}
            size="423.1 KB"
            onRemove={() => {}}
            removeLabel="移除"
          />
          <FileCard name={name} size="423.1 KB" actions={actions()} />
          <FileCard name={name} size="423.1 KB" progress={42} />
        </React.Fragment>
      ))}
    </div>
  ),
};
export const English: Story = {
  args: {
    name: "Quarterly-report-2026-final-revision.pdf",
    actions: actions(true),
  },
};
export const States: Story = {
  render: () => {
    const [progress, setProgress] = useState<number | undefined>(0);
    return (
      <div>
        <FileCard
          name="Quarterly-report-2026-final.pdf"
          size="423.1 KB"
          progress={progress}
          actions={actions()}
        />
        <button
          onClick={() =>
            setProgress((value) =>
              value === undefined ? 0 : value >= 100 ? undefined : value + 25
            )
          }
        >
          Advance upload / reset
        </button>
      </div>
    );
  },
};
export const EdgeCases: Story = {
  args: { name: "a", size: "0 B", onRemove: () => {}, removeLabel: "Remove" },
};
