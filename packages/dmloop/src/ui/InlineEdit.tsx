import React, { useEffect, useRef, useState } from "react";
import { Input, InputNumber } from "@douyinfe/semi-ui";
import { Pencil } from "lucide-react";
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
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void | Promise<void>;
  kind?: Kind;
  mono?: boolean;
  min?: number;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const composing = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

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
