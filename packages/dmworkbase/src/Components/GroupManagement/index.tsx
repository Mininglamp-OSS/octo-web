import React, { Component } from "react";
import { Button, Spin, Switch, Tag, Toast } from "@douyinfe/semi-ui";
import { Channel, Subscriber } from "wukongimjssdk";
import WKAvatar from "../WKAvatar";
import { SubscriberList } from "../Subscribers/list";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { GroupRole } from "../../Service/Const";
import { I18nContext, t } from "../../i18n";
import { wkConfirm } from "../WKModal";
import {
  addGroupManagementBotAdmins,
  addGroupManagementManagers,
  disbandGroupManagementGroup,
  loadGroupManagementMembers,
  readGroupManagementAllowNoMention,
  refreshGroupManagementChannelInfo,
  removeGroupManagementBotAdmin,
  removeGroupManagementManager,
  setGroupManagementAllowNoMention,
  subscribeGroupManagementChannelInfo,
  syncGroupManagementDisbandState,
} from "../../bridge/channelSetting/groupManagementActions";
import {
  shouldApplyFetchResult,
  shouldListenerApply,
} from "../../bridge/channelSetting/groupManagementAllowNoMention";
import "./index.css";

export interface GroupManagementProps {
  channel: Channel;
  isCreator: boolean;
  context: RouteContext<any>;
}

interface GroupManagementState {
  loading: boolean;
  managers: Subscriber[];
  botAdmins: Subscriber[];
  // 群级「允许群内 Bot 免@回答」总开关：缺省 1（允许），零回归。
  allowNoMention: boolean;
  allowNoMentionSaving: boolean;
}

export class GroupManagement extends Component<
  GroupManagementProps,
  GroupManagementState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  // unmount 守卫：异步 fetch / listener resolve 时若组件已卸载，不再 setState。
  private unmounted = false;
  private unsubscribeChannelInfoListener?: () => void;
  // 请求版本号：每次「权威读/写」自增。较早发起的 fetch resolve 后比对此值，
  // 若已被更新的 toggle/fetch 超越则丢弃其回写，杜绝 stale fetch 覆盖新状态。
  private opSeq = 0;
  // 我方发起的、仍在飞行中的 fetchChannelInfo 计数。listener 在有在途 fetch
  // 期间不回写——这些 fetch resolve 会触发 listener，但其新旧由 opSeq 守卫的
  // .then 决定，避免 stale fetch 经 listener 覆盖刚 toggle 的结果。
  private inflightFetch = 0;

  constructor(props: GroupManagementProps) {
    super(props);
    this.state = {
      loading: true,
      managers: [],
      botAdmins: [],
      allowNoMention: this.readAllowNoMention(),
      allowNoMentionSaving: false,
    };
  }

  // 从 SDK 频道缓存读「允许免@」开关当前值；缺省（老后端无字段）回退 true（允许），零回归。
  readAllowNoMention = (): boolean => {
    return readGroupManagementAllowNoMention({
      channel: this.props.channel,
    });
  };

  componentDidMount() {
    this.loadMembers();

    // Bug 2 时序变种修复：挂载时缓存可能是 stale/缺字段的 ChannelInfo，
    // fetchChannelInfo 是异步的。这里主动拉一次 fresh，并订阅 channelManager
    // listener，fresh 值到达时刷新开关（带 unmount 守卫）。
    //
    // round2 竞态修复：listener 会被「我方发起的 fetch」resolve 也触发一次。
    // 若挂载期那次 fetch 晚于 toggle 的写入/回读 resolve，它会经 listener 把
    // 开关 setState 回旧值，覆盖刚 toggle 的正确状态。因此：
    //   - 我方 fetch 在途期间（inflightFetch>0）listener 不回写——这些更新由
    //     对应 fetch 的 .then（带 opSeq 守卫）决定是否生效；
    //   - 仅当无在途 fetch（即外部来源的频道更新，如他人改了设置）listener 才
    //     回写，且 saving 锁期间以乐观值为准不被覆盖。
    this.unsubscribeChannelInfoListener = subscribeGroupManagementChannelInfo({
      channel: this.props.channel,
      onChange: () => {
        if (this.unmounted) return;
        if (
          !shouldListenerApply(
            this.inflightFetch,
            this.state.allowNoMentionSaving
          )
        ) {
          return;
        }
        this.setState({ allowNoMention: this.readAllowNoMention() });
      },
    });

    this.refreshAllowNoMention();
  }

  // 发起一次权威的 fresh 回读。用 opSeq 标记本次操作：resolve 时若已被更新的
  // toggle/refresh 超越（opSeq 变化）则丢弃回写，杜绝 stale fetch 覆盖新状态。
  // inflightFetch 计数让 listener 在我方 fetch 在途期间不重复回写。
  private refreshAllowNoMention = () => {
    const myOp = ++this.opSeq;
    this.inflightFetch++;
    void refreshGroupManagementChannelInfo({
      channel: this.props.channel,
    })
      .then(() => {
        if (this.unmounted) return;
        // 已被更新的操作超越，或正处于一次 toggle 保存中 → 丢弃这次回写。
        if (
          !shouldApplyFetchResult(
            myOp,
            this.opSeq,
            this.state.allowNoMentionSaving
          )
        ) {
          return;
        }
        this.setState({ allowNoMention: this.readAllowNoMention() });
      })
      .catch(() => {
        // 拉取失败保持缓存/缺省值，不打断群管理其它功能。
      })
      .finally(() => {
        this.inflightFetch--;
      });
  };

  componentWillUnmount() {
    this.unmounted = true;
    this.unsubscribeChannelInfoListener?.();
    this.unsubscribeChannelInfoListener = undefined;
  }

  loadMembers = async () => {
    const { channel } = this.props;
    try {
      const { managers, botAdmins } = await loadGroupManagementMembers({
        channel,
      });
      this.setState({ managers, botAdmins, loading: false });
    } catch (err: any) {
      Toast.error(err?.msg || t("base.groupManagement.loadFailed"));
      this.setState({ loading: false });
    }
  };

  handleRemoveManager = (subscriber: Subscriber) => {
    const { channel } = this.props;
    wkConfirm({
      title: t("base.groupManagement.removeManagerTitle"),
      content: t("base.groupManagement.removeManagerContent", {
        values: { name: subscriber.remark || subscriber.name },
      }),
      okText: t("base.common.ok"),
      cancelText: t("base.common.cancel"),
      onOk: async () => {
        try {
          await removeGroupManagementManager({
            channel,
            uid: subscriber.uid,
          });
          Toast.success(t("base.groupManagement.removed"));
          this.loadMembers();
        } catch (err: any) {
          Toast.error(err?.msg || t("base.groupManagement.operationFailed"));
        }
      },
    });
  };

  handleRemoveBotAdmin = (subscriber: Subscriber) => {
    const { channel } = this.props;
    wkConfirm({
      title: t("base.groupManagement.removeBotAdminTitle"),
      content: t("base.groupManagement.removeBotAdminContent", {
        values: { name: subscriber.remark || subscriber.name },
      }),
      okText: t("base.common.ok"),
      cancelText: t("base.common.cancel"),
      onOk: async () => {
        try {
          await removeGroupManagementBotAdmin({
            channel,
            uid: subscriber.uid,
          });
          Toast.success(t("base.groupManagement.removed"));
          this.loadMembers();
        } catch (err: any) {
          Toast.error(err?.msg || t("base.groupManagement.operationFailed"));
        }
      },
    });
  };

  handleAddManager = () => {
    const { channel, context } = this.props;
    const { managers } = this.state;
    const disableList = managers.map((m) => m.uid);

    let selectedItems: Subscriber[] = [];

    context.push(
      <SubscriberList
        channel={channel}
        canSelect={true}
        disableSelectList={disableList}
        filter={(s) => s.orgData?.robot !== 1 && s.role === GroupRole.normal}
        onSelect={(items) => {
          selectedItems = items;
        }}
      />,
      new RouteContextConfig({
        title: t("base.groupManagement.addManager"),
        showFinishButton: true,
        finishButtonTitle: t("base.common.ok"),
        onFinish: async () => {
          if (selectedItems.length === 0) {
            Toast.warning(t("base.groupManagement.selectMember"));
            return;
          }
          try {
            await addGroupManagementManagers({
              channel,
              uids: selectedItems.map((s) => s.uid),
            });
            Toast.success(t("base.groupManagement.added"));
            context.pop();
            this.loadMembers();
          } catch (err: any) {
            Toast.error(err?.msg || t("base.groupManagement.operationFailed"));
          }
        },
      })
    );
  };

  handleAddBotAdmin = () => {
    const { channel, context } = this.props;
    const { botAdmins } = this.state;
    const disableList = botAdmins.map((m) => m.uid);

    let selectedItems: Subscriber[] = [];

    context.push(
      <SubscriberList
        channel={channel}
        canSelect={true}
        disableSelectList={disableList}
        filter={(s) => s.orgData?.robot === 1 && s.orgData?.bot_admin !== 1}
        onSelect={(items) => {
          selectedItems = items;
        }}
      />,
      new RouteContextConfig({
        title: t("base.groupManagement.addBotAdmin"),
        showFinishButton: true,
        finishButtonTitle: t("base.common.ok"),
        onFinish: async () => {
          if (selectedItems.length === 0) {
            Toast.warning(t("base.groupManagement.selectBot"));
            return;
          }
          // 后端无批量端点，对每个选中 bot 各发一次 PUT；先快照选中 uid，
          // 避免提交期间 onSelect 回调改写 selectedItems 造成竞态。
          const uids = selectedItems.map((item) => item.uid);
          const { succeeded, failed } = await addGroupManagementBotAdmins({
            channel,
            uids,
          });
          if (succeeded.length > 0) {
            // 只要有成功的就刷新列表并关闭对话框。
            context.pop();
            this.loadMembers();
          }
          if (failed.length === 0) {
            Toast.success(t("base.groupManagement.added"));
          } else if (succeeded.length === 0) {
            const firstReason = failed[0].reason as any;
            Toast.error(
              firstReason?.msg || t("base.groupManagement.operationFailed")
            );
          } else {
            // 部分失败：明确列出失败的 uid，不静默吞掉。
            Toast.error(
              t("base.groupManagement.operationFailed") +
                ` (${failed.length}/${uids.length}): ` +
                failed.map((f) => f.uid).join(", ")
            );
          }
        },
      })
    );
  };

  // 解散群聊（企业微信式）：仅群主可见/可调。二次确认后调用后端
  // DELETE /groups/:group_no/disband，成功后群进入只读态（保留历史）。
  handleDisband = () => {
    const { channel, context } = this.props;
    wkConfirm({
      title: t("base.groupManagement.disbandTitle"),
      content: t("base.groupManagement.disbandContent"),
      okText: t("base.groupManagement.disbandAction"),
      cancelText: t("base.common.cancel"),
      okType: "danger",
      onOk: async () => {
        try {
          await disbandGroupManagementGroup({ channel });
        } catch (err: any) {
          // 解散接口本身失败：提示并停留在面板，不改本地态、不关面板。
          Toast.error(err?.msg || t("base.groupManagement.operationFailed"));
          return;
        }
        // 解散接口已成功。后续两步都不应再让用户停在面板或看到失败 toast。
        try {
          Toast.success(t("base.groupManagement.disbandSuccess"));
          // 本地权威写回解散态并触发刷新——不绕异步 fetchChannelInfo：后者对同
          // channelKey 在途请求去重，解散前发起的旧请求（携 status=Normal）resolve
          // 会把本地态覆盖回正常，UI 不置灰。本地同步动作直接改缓存 +
          // notifyListeners，对操作者本人即时置灰；服务端 channelUpdate CMD 回来再
          // 刷一次也幂等无害。
          syncGroupManagementDisbandState({ channel });
        } finally {
          // 与刷新解耦：即使上面同步抛错，也要关闭群管理面板回到会话，
          // 不把用户卡在面板里（会话会随 channelInfo.status 翻转为只读态）。
          context.pop();
        }
      },
    });
  };

  handleToggleAllowNoMention = async (next: boolean) => {
    const { channel } = this.props;
    const prev = this.state.allowNoMention;
    // 自增 opSeq：本次 toggle 成为最新操作，任何更早的在途 mount-fetch resolve
    // 后会因 opSeq 不匹配被丢弃，无法覆盖本次结果。
    const myOp = ++this.opSeq;
    // 乐观更新 + saving 锁，避免连点；saving 期间 listener 也不回写。
    this.setState({ allowNoMention: next, allowNoMentionSaving: true });
    this.inflightFetch++;
    try {
      await setGroupManagementAllowNoMention({
        allow: next,
        channel,
      });
      if (this.unmounted) return;
      // 期间又有更新的 toggle 发起 → 那次操作接管 state（含 saving 锁），本次静默退出。
      if (myOp !== this.opSeq) return;
      this.setState({
        allowNoMention: this.readAllowNoMention(),
        allowNoMentionSaving: false,
      });
    } catch (err: any) {
      // 失败回滚到改前状态。仅当本次仍是最新操作时才回滚 + 解锁，
      // 否则尊重更新的 toggle（它接管 saving 锁）。
      Toast.error(err?.msg || t("base.groupManagement.operationFailed"));
      if (this.unmounted) return;
      if (myOp !== this.opSeq) return;
      this.setState({ allowNoMention: prev, allowNoMentionSaving: false });
    } finally {
      this.inflightFetch--;
    }
  };

  render() {
    const { isCreator } = this.props;
    const { loading, managers, botAdmins, allowNoMention, allowNoMentionSaving } =
      this.state;

    if (loading) {
      return (
        <div className="wk-group-mgmt">
          <div className="wk-group-mgmt-loading">
            <Spin size="large" />
          </div>
        </div>
      );
    }

    return (
      <div className="wk-group-mgmt">
        {/* 群主、管理员 */}
        <div className="wk-group-mgmt-section">
          <div className="wk-group-mgmt-section-header">
            <span className="wk-group-mgmt-section-title">{t("base.groupManagement.ownerAndManagers")}</span>
            {isCreator && (
              <Button size="small" onClick={this.handleAddManager}>
                {t("base.groupManagement.addManager")}
              </Button>
            )}
          </div>
          <div className="wk-group-mgmt-list">
            {managers.map((item) => (
              <div className="wk-group-mgmt-item" key={item.uid}>
                <div className="wk-group-mgmt-item-avatar">
                  <WKAvatar src={item.avatar} />
                </div>
                <div className="wk-group-mgmt-item-info">
                  <span className="wk-group-mgmt-item-name">
                    {item.remark || item.name}
                  </span>
                  {item.role === GroupRole.owner && (
                    <Tag size="small" color="orange">
                      {t("base.groupManagement.owner")}
                    </Tag>
                  )}
                  {item.role === GroupRole.manager && (
                    <Tag size="small" color="blue">
                      {t("base.groupManagement.manager")}
                    </Tag>
                  )}
                </div>
                {isCreator && item.role === GroupRole.manager && (
                  <div className="wk-group-mgmt-item-action">
                    <span
                      className="wk-group-mgmt-remove-btn"
                      onClick={() => this.handleRemoveManager(item)}
                    >
                      ⊖
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bot 管理员 */}
        <div className="wk-group-mgmt-section">
          <div className="wk-group-mgmt-section-header">
            <span className="wk-group-mgmt-section-title">{t("base.groupManagement.botAdmins")}</span>
            <Button size="small" onClick={this.handleAddBotAdmin}>
              {t("base.groupManagement.addBotAdmin")}
            </Button>
          </div>
          <div className="wk-group-mgmt-list">
            {botAdmins.length === 0 ? (
              <div className="wk-group-mgmt-empty">{t("base.groupManagement.noBotAdmins")}</div>
            ) : (
              botAdmins.map((item) => (
                <div className="wk-group-mgmt-item" key={item.uid}>
                  <div className="wk-group-mgmt-item-avatar">
                    <WKAvatar src={item.avatar} />
                  </div>
                  <div className="wk-group-mgmt-item-info">
                    <span className="wk-group-mgmt-item-name">
                      {item.remark || item.name}
                    </span>
                    <Tag size="small" color="green">
                      {t("base.groupManagement.botAdmin")}
                    </Tag>
                  </div>
                  <div className="wk-group-mgmt-item-action">
                    <span
                      className="wk-group-mgmt-remove-btn"
                      onClick={() => this.handleRemoveBotAdmin(item)}
                    >
                      ⊖
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 群级「允许群内 Bot 免@回答」总开关：群主/管理员可控。
            两轴语义：最终免@ = bot主人开了本群免@ AND 群管理员允许本群免@（本开关）。 */}
        <div className="wk-group-mgmt-section">
          <div className="wk-group-mgmt-section-header">
            <span className="wk-group-mgmt-section-title">
              {t("base.groupManagement.allowNoMentionTitle")}
            </span>
          </div>
          <div className="wk-group-mgmt-switch-row">
            <span className="wk-group-mgmt-switch-label">
              {t("base.module.channelSettings.allowNoMention")}
            </span>
            {/* Semi UI <Switch> 裸放在 flex row 里会被默认 flex-shrink:1 压缩
                （参考 PersonaEdit 的 wk-persona-edit-row-control 同款处理），
                包一层 non-shrinking 控件容器锁定自然宽高。 */}
            <div className="wk-group-mgmt-switch-control">
              <Switch
                checked={allowNoMention}
                loading={allowNoMentionSaving}
                onChange={(v) => this.handleToggleAllowNoMention(v)}
              />
            </div>
          </div>
          <div className="wk-group-mgmt-switch-desc">
            {t("base.groupManagement.allowNoMentionDesc")}
          </div>
        </div>

        {/* 危险操作区：解散群聊。仅群主可见。企业微信式——解散后保留历史、全员只读。 */}
        {isCreator && (
          <div className="wk-group-mgmt-section wk-group-mgmt-danger-section">
            <Button
              theme="solid"
              type="danger"
              block
              onClick={this.handleDisband}
            >
              {t("base.groupManagement.disbandAction")}
            </Button>
            <div className="wk-group-mgmt-switch-desc">
              {t("base.groupManagement.disbandDesc")}
            </div>
          </div>
        )}
      </div>
    );
  }
}
