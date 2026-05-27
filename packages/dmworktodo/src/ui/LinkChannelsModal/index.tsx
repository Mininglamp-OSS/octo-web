import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Modal } from "@douyinfe/semi-ui";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { useI18n } from "@octo/base";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import type { MatterChannel } from "../../bridge/types";
import { Toast } from "../../utils/toast";
import { CHANNEL_TYPE_COMMUNITY_TOPIC } from "../../utils/channelId";
import "./LinkChannelsModal.css";

/**
 * 列表硬性渲染上限。用户可能在 20+ 个群里, 每群可能有 5-10 个子区,
 * 极端情况下选项数轻松破百。直接 .map 渲染过多 button 会让 modal
 * 打开瞬间卡顿。这里设上限 + 引导用户搜索缩小范围, 避免引入虚拟列表
 * 依赖。
 */
const VISIBLE_ROW_LIMIT = 200;

/**
 * 部分子区加载失败时, 警告条最多列出几个父群名 (避免横向溢出)。
 * 超出部分用 "等 N 个" 折叠。
 */
const ERROR_NAME_PREVIEW_LIMIT = 3;

export interface ChannelOption {
  channelId: string;
  channelType: number;
  name: string;
  desc?: string;
  memberCount?: number;
  /**
   * 子区 (channel_type=5) 才有: 父群名, 用于:
   *   - 列表/已选 区分子区时显示 "在 #父群名" 上下文
   *   - 搜索时把父群名也算进匹配 (用户搜父群能搜出该群下所有子区)
   */
  parentGroupName?: string;
  /**
   * 子区 (channel_type=5) 才有: 父群 group_no, 用于渲染 WKAvatar
   * (子区本身没有头像, 视觉上沿用父群头像)。
   */
  parentGroupNo?: string;
}

/**
 * loadChannels 的返回类型。
 *
 * 主路径 (`channels`) 永远是可用的候选列表; `threadLoadErrors` 只在
 * 部分群子区拉取失败时非空, 列表渲染前会 surface "X 个群的子区加载失败"
 * 警告条 + 重试按钮 — 之前这种失败被 catch 成空数组, 用户根本看不到。
 */
export interface LoadChannelsResult {
  channels: ChannelOption[];
  /** 子区加载失败的父群名 (用于警告条显示); 没失败时不传/空数组 */
  threadLoadErrors?: string[];
}

/** 构造头像用的 Channel: 子区头像复用父群头像 (子区本身没头像) */
function channelForAvatar(c: ChannelOption): Channel {
  if (c.channelType === CHANNEL_TYPE_COMMUNITY_TOPIC && c.parentGroupNo) {
    return new Channel(c.parentGroupNo, ChannelTypeGroup);
  }
  return new Channel(c.channelId, c.channelType);
}

export interface LinkChannelsModalProps {
  visible: boolean;
  matterId: string;
  matterTitle?: string;
  linkedChannels: MatterChannel[];
  onClose: () => void;
  onLinked: () => void;
  loadChannels: () => Promise<LoadChannelsResult>;
  onLinkChannel: (matterId: string, channelId: string, channelType: number, channelName: string) => Promise<void>;
}

export default function LinkChannelsModal({
  visible,
  matterId,
  matterTitle,
  linkedChannels,
  onClose,
  onLinked,
  loadChannels,
  onLinkChannel,
}: LinkChannelsModalProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [threadLoadErrors, setThreadLoadErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setThreadLoadErrors([]);
    loadChannels()
      .then((res) => {
        setChannels(res.channels);
        setThreadLoadErrors(res.threadLoadErrors ?? []);
        // reload 后对账 selected: 如果用户之前选了某个子区, 重试 / 重新拉取
        // 后该子区可能不在新列表里 (后端临时不可达 / 子区被解散等)。
        // 不清的话 handleConfirm 会 channels.find=undefined 默默 skip,
        // 但 toast 还是按 selected.length 报 "已关联 N 个", 跟实际不符。
        // 这里直接把不存在的 selected id 过滤掉, 让 UI 跟数据一致 (review
        // #110 r3 Jerry-Xin 🟡-1)。
        const validIds = new Set(res.channels.map((c) => c.channelId));
        setSelected((prev) => {
          const next = prev.filter((id) => validIds.has(id));
          return next.length === prev.length ? prev : next;
        });
      })
      .catch(() => {
        // 整体失败 (不光是部分子区失败) — 比如 groupSaveList 5xx。
        // 不清掉 channels / selected: 如果之前成功加载过, 保留旧的列表给
        // 用户继续操作, 不要因为一次重试失败就让用户从头来 (review #110
        // r2 yujiawei P2-3/P2-4)。走 toast 通知, 而不是默默空白。
        Toast.error(t("todo.linkChannels.loadFailedRetry"));
      })
      .finally(() => setLoading(false));
  }, [loadChannels, t]);

  useEffect(() => {
    if (!visible) {
      setSearch("");
      setSelected([]);
      setThreadLoadErrors([]);
      return;
    }
    reload();
  }, [visible, reload]);

  const linkedIds = useMemo(
    () => new Set(linkedChannels.map((c) => c.channel_id)),
    [linkedChannels],
  );

  // 搜索匹配: 匹配 name / desc / 子区父群名 (parentGroupName)。
  // 父群名匹配的目的: 用户输 "产品" 应能搜到 "#产品群" 下挂的所有子区,
  // 不光是子区本身的 name。
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return channels;
    return channels.filter((c) => {
      if (c.name.toLowerCase().includes(kw)) return true;
      if (c.desc && c.desc.toLowerCase().includes(kw)) return true;
      if (c.parentGroupName && c.parentGroupName.toLowerCase().includes(kw)) {
        return true;
      }
      return false;
    });
  }, [channels, search]);

  // 列表过长时截断渲染, 避免一次 mount 几百个 button 卡顿。
  // 用户可以靠搜索把候选缩到 200 内。
  const overflowing = filtered.length > VISIBLE_ROW_LIMIT;
  const visibleRows = overflowing
    ? filtered.slice(0, VISIBLE_ROW_LIMIT)
    : filtered;

  const toggle = (channelId: string) => {
    if (linkedIds.has(channelId)) return;
    setSelected((prev) =>
      prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId],
    );
  };

  const removeSelected = (channelId: string) => {
    setSelected((prev) => prev.filter((id) => id !== channelId));
  };

  const handleConfirm = useCallback(async () => {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    let linkedCount = 0;
    try {
      for (const chId of selected) {
        const ch = channels.find((c) => c.channelId === chId);
        if (!ch) continue;
        await onLinkChannel(matterId, ch.channelId, ch.channelType, ch.name);
        linkedCount++;
      }
      // 用真实成交数报 toast: 如果 reload 后某个 selected 已经不在 channels
      // 里, 上面的 .find 会 skip 它, linkedCount 比 selected.length 小。
      // 之前用 selected.length 会报 "已关联 N 个" 但实际只关联了 N-1 个,
      // 跟用户实际看到的不一致 (review #110 r3 Jerry-Xin 🟡-1)。
      if (linkedCount === 0) {
        Toast.error(t("todo.linkChannels.selectionUnavailable"));
        return;
      }
      Toast.success(t("todo.linkChannels.linked", { values: { count: linkedCount } }));
      onLinked();
      onClose();
    } catch (err: unknown) {
      Toast.error((err as Error)?.message || t("todo.linkChannels.failed"));
    } finally {
      setSubmitting(false);
    }
  }, [selected, submitting, channels, matterId, onLinked, onClose, onLinkChannel, t]);

  // 已选 Set: 同时给左侧列表 (每行 isSelected 判断) 和右侧已选列表用,
  // 把行级 .includes (O(N×M)) 收敛成一次 Set 构造 (O(N+M))。
  // 列表上限 200 行 + 选中数量小, 实际开销没差, 这里更多是 review #110
  // yujiawei P2-1 提到的 "claim consistency" — 既然 commit message 说做了,
  // 那就做完整。
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const selectedChannels = useMemo(
    () => channels.filter((c) => selectedSet.has(c.channelId)),
    [channels, selectedSet],
  );

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={625}
      closable={false}
      maskClosable
      centered
      className="wk-link-channels-modal"
    >
      <div className="wk-lcm">
        {/* Header */}
        <div className="wk-lcm__header">
          <span className="wk-lcm__title">{t("todo.linkChannels.title")}</span>
          <button type="button" className="wk-lcm__close" onClick={onClose} aria-label={t("todo.common.close")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content: 左右双栏 */}
        <div className="wk-lcm__content">
          {/* 左栏：候选列表 */}
          <div className="wk-lcm__left">
            {/* 搜索框 */}
            <div className="wk-lcm__search-wrap">
              <div className="wk-lcm__search">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="wk-lcm__search-icon">
                  <circle cx="7.33" cy="7.33" r="5" stroke="currentColor" strokeWidth="1.33" />
                  <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" />
                </svg>
                <input
                  className="wk-lcm__search-input"
                  placeholder={t("todo.linkChannels.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            {/* 子区加载警告条 (部分群的子区拉取失败时 surface) */}
            {!loading && threadLoadErrors.length > 0 && (
              <div className="wk-lcm__warn" role="alert">
                <span className="wk-lcm__warn-icon" aria-hidden="true">!</span>
                <span className="wk-lcm__warn-text">
                  {threadLoadErrors.length === 1
                    ? t("todo.linkChannels.threadLoadFailedOne", {
                        values: { name: threadLoadErrors[0] },
                      })
                    : threadLoadErrors.length <= ERROR_NAME_PREVIEW_LIMIT
                      ? t("todo.linkChannels.threadLoadFailedNamed", {
                          values: {
                            names: threadLoadErrors
                              .map((n) => `"${n}"`)
                              .join(t("todo.common.listSeparator")),
                          },
                        })
                      : t("todo.linkChannels.threadLoadFailedMany", {
                          values: {
                            count: threadLoadErrors.length,
                            names: threadLoadErrors
                              .slice(0, ERROR_NAME_PREVIEW_LIMIT)
                              .map((n) => `"${n}"`)
                              .join(t("todo.common.listSeparator")),
                          },
                        })}
                </span>
                <button
                  type="button"
                  className="wk-lcm__warn-retry"
                  onClick={reload}
                  disabled={loading}
                >
                  {t("todo.common.retry")}
                </button>
              </div>
            )}

            {/* 列表 */}
            <div className="wk-lcm__list">
              {loading ? (
                <div className="wk-lcm__empty">{t("todo.state.loading")}</div>
              ) : filtered.length === 0 ? (
                <div className="wk-lcm__empty">{t("todo.linkChannels.noMatches")}</div>
              ) : (
                <>
                  {visibleRows.map((c) => {
                    const isLinked = linkedIds.has(c.channelId);
                    const isSelected = selectedSet.has(c.channelId);
                    const isThread = c.channelType === CHANNEL_TYPE_COMMUNITY_TOPIC;
                    const avatarChannel = channelForAvatar(c);
                    return (
                      <button
                        key={c.channelId}
                        type="button"
                        disabled={isLinked}
                        onClick={() => toggle(c.channelId)}
                        className={`wk-lcm__item${isThread ? " is-thread" : ""}${isLinked ? " is-linked" : isSelected ? " is-selected" : ""}`}
                      >
                        <span className={`wk-lcm__check${isLinked ? " is-linked" : isSelected ? " is-checked" : ""}`}>
                          {(isLinked || isSelected) && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <WKAvatar
                          channel={avatarChannel}
                          style={{ width: 32, height: 32, borderRadius: '50%' }}
                        />
                        <span className="wk-lcm__item-info">
                          <span className="wk-lcm__item-name">
                            {isThread && (
                              <span
                                className="wk-lcm__item-thread-prefix"
                                aria-hidden="true"
                              >
                                #
                              </span>
                            )}
                            {c.name}
                          </span>
                            {isThread && c.parentGroupName && (
                            <span className="wk-lcm__item-context">
                              {t("todo.linkChannels.inParentGroup", {
                                values: { name: c.parentGroupName },
                              })}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {overflowing && (
                    <div className="wk-lcm__overflow-hint">
                      {t("todo.linkChannels.overflowHint", {
                        values: {
                          limit: VISIBLE_ROW_LIMIT,
                          total: filtered.length,
                        },
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 右栏：已选列表 */}
          <div className="wk-lcm__right">
            <div className="wk-lcm__right-title">
              {t("todo.linkChannels.selectedCount", { values: { count: selected.length } })}
            </div>
            {selectedChannels.map((c) => {
              const isThread = c.channelType === CHANNEL_TYPE_COMMUNITY_TOPIC;
              const avatarChannel = channelForAvatar(c);
              return (
                <div key={c.channelId} className="wk-lcm__selected-item">
                  <WKAvatar
                    channel={avatarChannel}
                    style={{ width: 32, height: 32, borderRadius: '50%' }}
                  />
                  <span className="wk-lcm__item-info">
                    <span className="wk-lcm__item-name">
                      {isThread && (
                        <span
                          className="wk-lcm__item-thread-prefix"
                          aria-hidden="true"
                        >
                          #
                        </span>
                      )}
                      {c.name}
                    </span>
                    {isThread && c.parentGroupName && (
                      <span className="wk-lcm__item-context">
                        {t("todo.linkChannels.inParentGroup", {
                          values: { name: c.parentGroupName },
                        })}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="wk-lcm__selected-remove"
                    onClick={() => removeSelected(c.channelId)}
                    aria-label={t("todo.action.remove")}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="wk-lcm__footer">
          <div className="wk-lcm__footer-actions">
            <button type="button" className="wk-lcm__btn-cancel" onClick={onClose}>
              {t("todo.common.cancel")}
            </button>
            <button
              type="button"
              className="wk-lcm__btn-confirm"
              disabled={selected.length === 0 || submitting}
              onClick={handleConfirm}
            >
              {t("todo.common.confirm")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { LinkChannelsModal };
