import React, { useMemo, useState } from "react";
import { Dropdown, Toast } from "@douyinfe/semi-ui";
import { Cloud, Monitor, Lock, Check } from "lucide-react";
import { useI18n } from "@octo/base";
import type { RuntimeDevice } from "../api/types";
import { ProviderLogo } from "../ui/providerLogo";

type Filter = "mine" | "all";

// 设备（机器）标签：device_info 的首段（"host · 2.1.121 (Claude Code)" → "host"），回落到 runtime 名。
function deviceLabel(r: RuntimeDevice): string {
  const head = r.device_info?.split("·")[0]?.trim();
  return head || r.name;
}

/**
 * Agent 详情页运行时下拉（对齐产品设计）：
 * 触发器 = Monitor/Cloud 图标 + 运行时名（mono）+ 右侧在线点；
 * 弹框 = Mine/All 筛选（仅当存在他人 runtime）+ 按设备分组的富行（ProviderLogo + 名字/徽章 + 在线点 + 选中勾）。
 * 不展示归属人（属性仅 owner 可改，展示归属人无意义）。保留 Semi Dropdown 皮肤，仅自定义 render 内容。
 */
export default function RuntimePicker({
  value,
  runtimes,
  currentUserId,
  onChange,
  canEdit = true,
}: {
  value: string;
  runtimes: RuntimeDevice[];
  currentUserId: string | null;
  onChange: (runtimeId: string) => void | Promise<void>;
  canEdit?: boolean;
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

  // 先按「我的优先 → 可用优先」排序，再按设备（daemon_id）聚成分组，组内保持排序顺序。
  const groups = useMemo(() => {
    const list =
      filter === "mine" && currentUserId
        ? runtimes.filter((r) => r.owner_id === currentUserId)
        : runtimes;
    const sorted = [...list].sort((a, b) => {
      const aMine = a.owner_id === currentUserId;
      const bMine = b.owner_id === currentUserId;
      if (aMine !== bMine) return aMine ? -1 : 1;
      const aLocked = isLocked(a);
      const bLocked = isLocked(b);
      if (aLocked !== bLocked) return aLocked ? 1 : -1;
      return 0;
    });
    const map = new Map<string, { label: string; items: RuntimeDevice[] }>();
    for (const r of sorted) {
      const key = r.daemon_id || deviceLabel(r);
      let g = map.get(key);
      if (!g) {
        g = { label: deviceLabel(r), items: [] };
        map.set(key, g);
      }
      g.items.push(r);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimes, filter, currentUserId]);

  const select = async (id: string) => {
    setOpen(false);
    if (id !== value) {
      try {
        await onChange(id);
      } catch {
        Toast.error(t("loop.toast.saveFailed"));
      }
    }
  };

  const dot = (online: boolean) => (
    <span className={`loop-rtp__dot${online ? " is-online" : ""}`} aria-hidden />
  );

  // 非 owner 只读：静态展示当前运行时（图标 + 名字 + 在线点），无下拉。
  if (!canEdit) {
    return (
      <span className="loop-adp__rt-ro">
        <TriggerIcon size={13} className="loop-adp__rt-ico" />
        <span className="loop-adp__edit-val loop-mono-text">{selected?.name ?? "—"}</span>
        {selected && dot(selected.status === "online")}
      </span>
    );
  }

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
        {groups.length === 0 ? (
          <p className="loop-rtp__empty">{t("loop.agent.runtimeEmpty")}</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="loop-rtp__group">
              <div className="loop-rtp__group-head">
                <Monitor size={11} className="loop-rtp__group-ico" />
                <span className="loop-rtp__group-name">{g.label}</span>
              </div>
              {g.items.map((rt) => {
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
                    {dot(online)}
                    <Check size={14} className={`loop-rtp__check${rt.id === value ? "" : " is-hidden"}`} />
                  </button>
                );
              })}
            </div>
          ))
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
