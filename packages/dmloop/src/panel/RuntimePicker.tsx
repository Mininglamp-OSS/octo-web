import React, { useMemo, useState } from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import { Cloud, Monitor, Lock, Check } from "lucide-react";
import { useI18n } from "@octo/base";
import type { RuntimeDevice } from "../api/types";
import { ProviderLogo } from "../ui/providerLogo";

type Filter = "mine" | "all";

/**
 * Agent 详情页运行时下拉（对齐 multica 的 runtime-picker）：
 * 触发器 = Monitor/Cloud 图标 + 运行时名（mono）+ 右侧在线点；
 * 弹框 = Mine/All 筛选（仅当存在他人 runtime）+ 富行（ProviderLogo + 名字/徽章 + 归属人/设备 + 在线点 + 选中勾）。
 * 保留 Semi Dropdown 皮肤，仅自定义 render 内容（符合「下拉不重写」约定）。
 */
export default function RuntimePicker({
  value,
  runtimes,
  currentUserId,
  onChange,
}: {
  value: string;
  runtimes: RuntimeDevice[];
  currentUserId: string | null;
  onChange: (runtimeId: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("mine");

  const selected = runtimes.find((r) => r.id === value) ?? null;
  const TriggerIcon = selected?.runtime_mode === "cloud" ? Cloud : Monitor;

  // 锁定：他人拥有且非工作区可见的 runtime，不可被本用户绑定。
  const isLocked = (r: RuntimeDevice): boolean => {
    if (!currentUserId) return false;
    if (r.owner_id === currentUserId) return false;
    return r.visibility !== "workspace";
  };

  const hasOtherRuntimes = runtimes.some((r) => r.owner_id !== currentUserId);

  const filtered = useMemo(() => {
    const list =
      filter === "mine" && currentUserId
        ? runtimes.filter((r) => r.owner_id === currentUserId)
        : runtimes;
    // 我的优先 → 可用优先。
    return [...list].sort((a, b) => {
      const aMine = a.owner_id === currentUserId;
      const bMine = b.owner_id === currentUserId;
      if (aMine !== bMine) return aMine ? -1 : 1;
      const aLocked = isLocked(a);
      const bLocked = isLocked(b);
      if (aLocked !== bLocked) return aLocked ? 1 : -1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimes, filter, currentUserId]);

  const select = async (id: string) => {
    setOpen(false);
    if (id !== value) await onChange(id);
  };

  const dot = (online: boolean) => (
    <span className={`loop-rtp__dot${online ? " is-online" : ""}`} aria-hidden />
  );

  const menu = (
    <div className="loop-rtp__pop">
      {hasOtherRuntimes && (
        <div className="loop-rtp__filter">
          <button
            type="button"
            className={`loop-rtp__filter-btn${filter === "mine" ? " is-active" : ""}`}
            onClick={() => setFilter("mine")}
          >
            {t("loop.scope.mine")}
          </button>
          <button
            type="button"
            className={`loop-rtp__filter-btn${filter === "all" ? " is-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            {t("loop.scope.all")}
          </button>
        </div>
      )}
      <div className="loop-rtp__list">
        {filtered.length === 0 ? (
          <p className="loop-rtp__empty">{t("loop.agent.runtimeEmpty")}</p>
        ) : (
          filtered.map((rt) => {
            const online = rt.status === "online";
            const locked = isLocked(rt);
            return (
              <button
                key={rt.id}
                type="button"
                className={`loop-rtp__item${rt.id === value ? " is-selected" : ""}${locked ? " is-locked" : ""}`}
                disabled={locked}
                onClick={() => {
                  if (!locked) void select(rt.id);
                }}
              >
                <ProviderLogo provider={rt.provider} />
                <span className="loop-rtp__main">
                  <span className="loop-rtp__line1">
                    <span className="loop-rtp__name">{rt.name}</span>
                    {rt.runtime_mode === "cloud" && (
                      <span className="loop-rtp__badge is-cloud">{t("loop.agent.runtimeCloudBadge")}</span>
                    )}
                    {locked && (
                      <span className="loop-rtp__badge is-locked">
                        <Lock size={10} />
                        {t("loop.agent.runtimePrivateBadge")}
                      </span>
                    )}
                  </span>
                  {(rt.owner_name || rt.device_info) && (
                    <span className="loop-rtp__line2">
                      {rt.owner_name && <span className="loop-rtp__owner-name">{rt.owner_name}</span>}
                      {rt.owner_name && rt.device_info && <span className="loop-rtp__sep">·</span>}
                      {rt.device_info && <span className="loop-rtp__device">{rt.device_info}</span>}
                    </span>
                  )}
                </span>
                {dot(online)}
                <Check size={14} className={`loop-rtp__check${rt.id === value ? "" : " is-hidden"}`} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <Dropdown trigger="click" position="bottomRight" visible={open} onVisibleChange={setOpen} render={menu}>
      <button type="button" className="loop-adp__edit loop-adp__rt-trigger" aria-label={t("loop.agent.runtime")}>
        <TriggerIcon size={13} className="loop-adp__rt-ico" />
        <span className="loop-adp__edit-val loop-mono-text">{selected?.name ?? "—"}</span>
        {selected && dot(selected.status === "online")}
      </button>
    </Dropdown>
  );
}
