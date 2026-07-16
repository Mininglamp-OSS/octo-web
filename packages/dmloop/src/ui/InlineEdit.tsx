import React, { useEffect, useRef, useState } from "react";
import { Input, InputNumber, Toast } from "@douyinfe/semi-ui";
import { Pencil } from "lucide-react";
import { useI18n } from "@octo/base";
import AutoGrowTextarea from "./AutoGrowTextarea";

type Kind = "text" | "textarea" | "number";

/**
 * 就地编辑属性值（对标 multica inspector）：
 * 展示态 hover 显示灰底 + 小铅笔；点击进入编辑态（单行 Input / 多行 AutoGrowTextarea / 数字 InputNumber）。
 * 空值仍以占位文案展示且可编辑。Enter（多行 Cmd/Ctrl+Enter）或失焦提交，Esc 取消；输入法组合期不劫持回车。
 * 下拉/输入沿用 Semi + loop 皮肤（符合「下拉/选择器不重写」约定）。
 */
export default function InlineEdit({
  value,
  placeholder,
  onSave,
  kind = "text",
  mono = false,
  min,
  ariaLabel,
  canEdit = true,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void | Promise<void>;
  kind?: Kind;
  mono?: boolean;
  min?: number;
  ariaLabel?: string;
  canEdit?: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const composing = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // 非 owner 只读：渲染纯文本值（空则占位），无 hover 铅笔、不可点。
  if (!canEdit) {
    const empty = value.trim() === "";
    return (
      <span className={`loop-adp__ro${empty ? " loop-adp__ro--empty" : ""}${mono ? " loop-mono-text" : ""}`}>
        {empty ? placeholder : value}
      </span>
    );
  }

  const commit = async () => {
    if (busy) return;
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    try {
      setBusy(true);
      await onSave(next);
      setEditing(false);
    } catch {
      // 保存失败：提示用户并保留编辑态与草稿，便于重试（对齐同面板其它保存的错误反馈）。
      Toast.error(t("loop.toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    const empty = value.trim() === "";
    return (
      <button
        type="button"
        className={`loop-adp__edit${empty ? " loop-adp__edit--empty" : ""}${mono ? " loop-mono-text" : ""}`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        aria-label={ariaLabel}
      >
        <span className="loop-adp__edit-val">{empty ? placeholder : value}</span>
        <Pencil size={12} className="loop-adp__edit-ico" aria-hidden />
      </button>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (composing.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === "Enter") {
      if (kind === "textarea" && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      void commit();
    }
  };

  if (kind === "textarea") {
    return (
      <AutoGrowTextarea
        className="loop-field-textarea loop-field-textarea--auto loop-adp__edit-input"
        value={draft}
        onChange={setDraft}
        placeholder={placeholder}
        autoFocus
        disabled={busy}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />
    );
  }

  if (kind === "number") {
    return (
      <InputNumber
        className="loop-adp__edit-input"
        value={draft === "" ? undefined : Number(draft)}
        min={min}
        size="small"
        autofocus
        disabled={busy}
        style={{ width: 96 }}
        onChange={(v) => setDraft(v == null ? "" : String(v))}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <Input
      className="loop-adp__edit-input"
      value={draft}
      placeholder={placeholder}
      size="small"
      autoFocus
      disabled={busy}
      onChange={setDraft}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    />
  );
}
