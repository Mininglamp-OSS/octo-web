import type { Meta, StoryObj } from "@storybook/react-vite";
import React, { useState, useRef, useEffect } from "react";
import "./index.css";

/**
 * MessageInput 的纯 UI Mock 版本
 * 用于 Storybook 展示，不依赖 WKSDK 和业务逻辑
 */

interface MockMessageInputProps {
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  onSend?: (text: string) => void;
  toolbar?: React.ReactNode;
  topView?: React.ReactNode;
  hideMention?: boolean;
  hasPendingAttachments?: boolean;
}

const MockMessageInput: React.FC<MockMessageInputProps> = ({
  placeholder = "输入消息...",
  disabled = false,
  maxLength = 5000,
  onSend,
  toolbar,
  topView,
  hasPendingAttachments = false,
}) => {
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (text.trim() && onSend) {
      onSend(text);
      setText("");
      if (editorRef.current) {
        editorRef.current.innerText = "";
      }
    }
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const content = e.currentTarget.innerText || "";
    if (content.length <= maxLength) {
      setText(content);
    }
  };

  return (
    <div
      className={`wk-message-input-mock ${disabled ? "disabled" : ""} ${
        expanded ? "expanded" : ""
      }`}
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--wk-color-border-1, #e0e0e0)",
        borderRadius: 8,
        background: "var(--wk-color-bg-1, #fff)",
        overflow: "hidden",
      }}
    >
      {topView && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--wk-color-border-1, #e0e0e0)",
            background: "var(--wk-color-bg-2, #f5f5f5)",
          }}
        >
          {topView}
        </div>
      )}

      {hasPendingAttachments && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--wk-color-border-1, #e0e0e0)",
            background: "var(--wk-color-bg-2, #f5f5f5)",
            display: "flex",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 4,
              background: "var(--wk-color-bg-3, #eee)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            📎
          </div>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 4,
              background: "var(--wk-color-bg-3, #eee)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            🖼️
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          padding: "8px 12px",
          gap: 8,
        }}
      >
        <div
          ref={editorRef}
          contentEditable={!disabled}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          data-placeholder={placeholder}
          style={{
            flex: 1,
            minHeight: expanded ? 120 : 40,
            maxHeight: expanded ? 300 : 120,
            overflowY: "auto",
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--wk-color-bg-2, #f5f5f5)",
            outline: "none",
            fontSize: 14,
            lineHeight: 1.5,
            color: disabled
              ? "var(--wk-color-text-3, #999)"
              : "var(--wk-color-text-0, #333)",
            cursor: disabled ? "not-allowed" : "text",
          }}
          suppressContentEditableWarning
        />

        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              width: 32,
              height: 32,
              border: "none",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--wk-color-text-2, #666)",
            }}
            title={expanded ? "收起" : "展开"}
          >
            {expanded ? "↙" : "↗"}
          </button>

          <button
            onClick={handleSend}
            disabled={disabled || !text.trim()}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 6,
              background:
                disabled || !text.trim()
                  ? "var(--wk-color-bg-3, #e0e0e0)"
                  : "var(--wk-color-primary, #1890ff)",
              color:
                disabled || !text.trim()
                  ? "var(--wk-color-text-3, #999)"
                  : "#fff",
              cursor: disabled || !text.trim() ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            发送
          </button>
        </div>
      </div>

      {toolbar && (
        <div
          style={{
            padding: "4px 12px 8px",
            borderTop: "1px solid var(--wk-color-border-1, #e0e0e0)",
          }}
        >
          {toolbar}
        </div>
      )}

      {text.length > maxLength * 0.9 && (
        <div
          style={{
            padding: "4px 12px",
            fontSize: 12,
            color:
              text.length >= maxLength
                ? "var(--wk-color-error, #f5222d)"
                : "var(--wk-color-warning, #faad14)",
            textAlign: "right",
          }}
        >
          {text.length} / {maxLength}
        </div>
      )}
    </div>
  );
};

// 添加 placeholder 样式
const PlaceholderStyle = () => (
  <style>{`
    [contenteditable][data-placeholder]:empty:before {
      content: attr(data-placeholder);
      color: var(--wk-color-text-3, #999);
      pointer-events: none;
    }
  `}</style>
);

const MockMessageInputWithStyle: React.FC<MockMessageInputProps> = (props) => (
  <>
    <PlaceholderStyle />
    <MockMessageInput {...props} />
  </>
);

const meta: Meta<typeof MockMessageInputWithStyle> = {
  title: "Base/MessageInput",
  component: MockMessageInputWithStyle,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
消息输入框组件，支持富文本编辑、@提及、斜杠命令等功能。

**功能：**
- 富文本输入（基于 TipTap）
- @提及成员
- 斜杠命令菜单
- 语音输入
- 输入框展开/收起
- 字数限制（5000字）

**注意：** 此 Story 使用 Mock 组件展示 UI 效果，实际组件依赖 WKSDK。
        `,
      },
    },
  },
  argTypes: {
    placeholder: {
      control: "text",
      description: "输入框占位文字",
    },
    disabled: {
      control: "boolean",
      description: "是否禁用输入框",
    },
    maxLength: {
      control: "number",
      description: "最大字数限制",
    },
    hideMention: {
      control: "boolean",
      description: "是否隐藏 @提及功能",
    },
    hasPendingAttachments: {
      control: "boolean",
      description: "是否有待发送的附件",
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 500, padding: 20 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof MockMessageInputWithStyle>;

// 默认状态
export const Default: Story = {
  args: {
    placeholder: "输入消息...",
    disabled: false,
    maxLength: 5000,
    onSend: (text) => console.log("发送消息:", text),
  },
};

// 禁用状态
export const Disabled: Story = {
  args: {
    placeholder: "输入框已禁用",
    disabled: true,
  },
};

// 有待发送附件
export const WithPendingAttachments: Story = {
  args: {
    placeholder: "输入消息...",
    hasPendingAttachments: true,
    onSend: (text) => console.log("发送消息:", text),
  },
};

// 带工具栏
export const WithToolbar: Story = {
  args: {
    placeholder: "输入消息...",
    toolbar: (
      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid #ddd",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          📎 附件
        </button>
        <button
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid #ddd",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          😊 表情
        </button>
        <button
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid #ddd",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          🎤 语音
        </button>
      </div>
    ),
    onSend: (text) => console.log("发送消息:", text),
  },
};

// 带顶部视图（如引用回复）
export const WithTopView: Story = {
  args: {
    placeholder: "输入消息...",
    topView: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 12, color: "#666" }}>
          <span style={{ color: "#1890ff" }}>回复 @Alice:</span>{" "}
          这是一条被引用的消息内容...
        </div>
        <button
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>
    ),
    onSend: (text) => console.log("发送消息:", text),
  },
};

// 字数限制警告
export const NearMaxLength: Story = {
  args: {
    placeholder: "输入消息...",
    maxLength: 100,
    onSend: (text) => console.log("发送消息:", text),
  },
  parameters: {
    docs: {
      description: {
        story: "当输入接近最大字数时显示字数统计",
      },
    },
  },
};

// 深色模式预览
export const DarkMode: Story = {
  args: {
    placeholder: "输入消息...",
    onSend: (text) => console.log("发送消息:", text),
  },
  decorators: [
    (Story) => (
      <div
        data-theme="dark"
        style={{
          width: 500,
          padding: 20,
          background: "#1f1f1f",
          borderRadius: 8,
          // 模拟深色模式变量
          // @ts-ignore
          "--wk-color-bg-0": "#141414",
          "--wk-color-bg-1": "#1f1f1f",
          "--wk-color-bg-2": "#2a2a2a",
          "--wk-color-bg-3": "#3a3a3a",
          "--wk-color-border-1": "#434343",
          "--wk-color-text-0": "#fff",
          "--wk-color-text-2": "#a0a0a0",
          "--wk-color-text-3": "#666",
          "--wk-color-primary": "#177ddc",
        }}
      >
        <Story />
      </div>
    ),
  ],
};
