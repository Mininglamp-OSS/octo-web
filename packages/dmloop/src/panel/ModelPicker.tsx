import React, { useState } from "react";
import { Dropdown, Input, Toast } from "@douyinfe/semi-ui";
import { Plus } from "lucide-react";
import { useI18n } from "@octo/base";

/**
 * Agent 详情页模型选择（对齐 multica 的 model-picker 体验）：
 * 触发器 = 当前模型或「默认」（mono）；弹框 = 输入框 + 「使用自定义 '<输入>'」+ 底部「清除」。
 * 不接 daemon 的 list-models（CC 无法返回真实模型列表），仅保留手填/自定义/清除。
 */
export default function ModelPicker({
  value,
  onChange,
  canEdit = true,
}: {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  canEdit?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const trimmed = search.trim();
  const canCreate = trimmed.length > 0 && trimmed !== value;

  // 非 owner 只读：静态展示当前模型或「默认」，无弹框。
  if (!canEdit) {
    return <span className="loop-adp__ro loop-mono-text">{value || t("loop.agent.modelDefault")}</span>;
  }

  const commit = async (next: string) => {
    setOpen(false);
    setSearch("");
    if (next !== value) {
      try {
        await onChange(next);
      } catch {
        Toast.error(t("loop.toast.saveFailed"));
      }
    }
  };

  const menu = (
    <div className="loop-mdp__pop">
      <div className="loop-mdp__search">
        <Input
          autoFocus
          size="small"
          value={search}
          placeholder={t("loop.agent.modelSearchPlaceholder")}
          onChange={setSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) {
              e.preventDefault();
              void commit(trimmed);
            }
          }}
        />
      </div>
      {canCreate ? (
        <button type="button" className="loop-mdp__item" onClick={() => void commit(trimmed)}>
          <Plus size={14} className="loop-mdp__plus" />
          <span className="loop-mdp__custom">{t("loop.agent.modelCustomUse", { values: { value: trimmed } })}</span>
        </button>
      ) : (
        <p className="loop-mdp__hint">{t("loop.agent.modelInputHint")}</p>
      )}
      {value && (
        <>
          <div className="loop-mdp__sep" />
          <button type="button" className="loop-mdp__clear" onClick={() => void commit("")}>
            {t("loop.agent.modelClear")}
          </button>
        </>
      )}
    </div>
  );

  return (
    <Dropdown
      trigger="click"
      position="bottomRight"
      visible={open}
      onVisibleChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
      render={menu}
    >
      <button type="button" className="loop-adp__edit" aria-label={t("loop.agent.model")}>
        <span className="loop-adp__edit-val loop-mono-text">{value || t("loop.agent.modelDefault")}</span>
      </button>
    </Dropdown>
  );
}
