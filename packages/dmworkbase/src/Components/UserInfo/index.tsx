import { Input, Spin, Toast } from "@douyinfe/semi-ui";
import { IconEdit } from "@douyinfe/semi-icons";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import React, { Component, HTMLProps } from "react";
import { UserRelation } from "../../Service/Const";
import WKApp, { FriendApply } from "../../App";
import Provider, { IProviderListener } from "../../Service/Provider";
import { Section } from "../../Service/Section";
import RoutePage from "../RoutePage";
import Sections from "../Sections";
import "./index.css"
import { UserInfoRouteData, UserInfoVM } from "./vm";
import FriendApplyUI from "../FriendApply";
import RouteContext, { FinishButtonContext } from "../../Service/Context";
import { I18nContext } from "../../i18n";
import WKAvatarPreviewImage from "../WKAvatarPreviewImage";
import WKButton from "../WKButton";
import UserInfoHeader from "./UserInfoHeader";
import UserInfoFooter from "./UserInfoFooter";
import { UserInfoMetaItem } from "./UserInfoMetaList";


export interface UserInfoProps extends HTMLProps<any> {
    uid: string
    fromChannel?: Channel // 从那个频道进来的
    sections?: Section[]
    vercode?: string // 验证码，加好友需要，证明好友来源
    onClose?: () => void
}

interface UserInfoState {
    editingRemark: boolean;
    remarkDraft: string;
    savingRemark: boolean;
}

export default class UserInfo extends Component<UserInfoProps, UserInfoState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;
    private mounted = false;

    state: UserInfoState = {
        editingRemark: false,
        remarkDraft: "",
        savingRemark: false,
    };

    componentDidMount() {
        this.mounted = true;
    }

    componentDidUpdate(prevProps: UserInfoProps) {
        if (prevProps.uid !== this.props.uid) {
            this.setState({
                editingRemark: false,
                remarkDraft: "",
                savingRemark: false,
            });
        }
    }

    componentWillUnmount() {
        this.mounted = false;
    }

    getRemark(vm: UserInfoVM) {
        return vm.channelInfo?.orgData?.remark || "";
    }

    startEditRemark = (vm: UserInfoVM) => {
        this.setState({
            editingRemark: true,
            remarkDraft: this.getRemark(vm),
        });
    };

    cancelEditRemark = () => {
        this.setState({
            editingRemark: false,
            remarkDraft: "",
        });
    };

    saveRemark = async (vm: UserInfoVM) => {
        const { t } = this.context;
        const requestedUid = vm.uid;
        const isCurrent = () => this.mounted && this.props.uid === requestedUid;
        const remark = this.state.remarkDraft.trim();
        this.setState({ savingRemark: true });
        try {
            await WKApp.dataSource.commonDataSource.userRemark(requestedUid, remark);
            if (!isCurrent()) return;
            if (vm.channelInfo) {
                vm.channelInfo.orgData = {
                    ...vm.channelInfo.orgData,
                    remark,
                    displayName: remark || vm.channelInfo.title,
                };
            }
            vm.notifyListener();
            Toast.success(t("base.userInfo.remarkUpdated"));
            this.setState({
                editingRemark: false,
                remarkDraft: "",
            });
            Promise.resolve(
                WKSDK.shared().channelManager.fetchChannelInfo(new Channel(requestedUid, ChannelTypePerson))
            ).catch((error: unknown) => {
                console.warn("[UserInfo] refresh channel after remark failed:", error);
            });
            Promise.resolve(vm.reloadChannelInfo()).catch((error: unknown) => {
                console.warn("[UserInfo] reload profile after remark failed:", error);
            });
        } catch (err: any) {
            if (isCurrent()) {
                Toast.error(err?.msg || t("base.userInfo.remarkUpdateFailed"));
            }
        } finally {
            if (isCurrent()) {
                this.setState({ savingRemark: false });
            }
        }
    };

    getVisibleSections(vm: UserInfoVM, context: RouteContext<UserInfoRouteData>) {
        const remarkTitle = this.context.t("base.module.userInfo.remark");
        return vm.sections(context)
            .map((section) => {
                const rows = section.rows?.filter((row) => {
                    return row.properties?.key !== "userinfo.remark" && row.properties?.title !== remarkTitle;
                });
                return new Section({
                    title: section.title,
                    rows,
                    subtitle: section.subtitle,
                });
            })
            .filter((section) => {
                return (section.rows && section.rows.length > 0) || !!section.title || !!section.subtitle;
            });
    }

    renderRemarkEditor(vm: UserInfoVM) {
        const { t } = this.context;
        if (vm.isSelf()) {
            return null;
        }

        const { editingRemark, remarkDraft, savingRemark } = this.state;
        const remark = this.getRemark(vm);
        return <div className="wk-userinfo-remark-section">
            <div className="wk-userinfo-remark-row">
                <div className="wk-userinfo-remark-main">
                    <div className="wk-userinfo-remark-label">{t("base.userInfo.remark")}</div>
                    {
                        editingRemark ? <div className="wk-userinfo-remark-editor">
                            <Input
                                value={remarkDraft}
                                onChange={(value) => this.setState({ remarkDraft: value })}
                                placeholder={t("base.userInfo.remarkPlaceholder")}
                                maxLength={30}
                            />
                            <div className="wk-userinfo-remark-actions">
                                <WKButton
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={savingRemark}
                                    onClick={this.cancelEditRemark}
                                >
                                    {t("base.common.cancel")}
                                </WKButton>
                                <WKButton
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    loading={savingRemark}
                                    onClick={() => this.saveRemark(vm)}
                                >
                                    {t("base.common.save")}
                                </WKButton>
                            </div>
                        </div> : <div className="wk-userinfo-remark-value">
                            {remark || <span className="wk-userinfo-remark-empty">{t("base.common.notSet")}</span>}
                        </div>
                    }
                </div>
                {!editingRemark && (
                    <button
                        type="button"
                        className="wk-userinfo-remark-edit"
                        onClick={() => this.startEditRemark(vm)}
                        aria-label={t("base.userInfo.editRemark")}
                        title={t("base.userInfo.editRemark")}
                    >
                        <IconEdit />
                    </button>
                )}
            </div>
        </div>
    }

    getBottomPanel(vm: UserInfoVM, context: RouteContext<any>) {
        if (vm.isSelf()) {
            return undefined
        }

        // dmwork-web #1016: 跨 space 外部成员在任何视角下都不允许直接发起 DM，
        // 只能继续通过群聊交流。这里作为 UI 层唯一拦截点：隐藏"发送消息" / "添加好友"
        // 按钮，底部改显一条静态提示，查看资料入口（昵称/@SpaceName/section 列表）
        // 照常展示。后端 Phase 2 会补齐好友/同 space 校验。
        //
        // 判定字段沿用 resolveExternalForViewer（is_external 是相对当前
        // 查看 space 的视角值，不是绝对属性）。
        const isExternalToViewer = vm.isExternalToViewer()
        const { t } = this.context
        if (isExternalToViewer) {
            return <UserInfoFooter hint={t("base.userInfo.externalOnlyGroup")} />
        }

        let content = <></>
        // Space 模式：成员间可直接发消息，但 Bot 需要先加好友
        const spaceId = WKApp.shared.currentSpaceId;
        const isBot = vm.channelInfo?.orgData?.robot === 1;
        const isFriend = vm.relation() === UserRelation.friend;
        if (spaceId && (!isBot || isFriend)) {
            // 非 Bot 成员或已加好友的 Bot：直接发消息
            content = <WKButton type="button" variant="primary" onClick={() => {
                WKApp.shared.baseContext.hideUserInfo()
                // WuKongIM DM 只认裸 uid
                WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
            }}>{t("base.userInfo.sendMessage")}</WKButton>
        } else if (isFriend) {
            content = <WKButton type="button" variant="primary" onClick={() => {
                WKApp.shared.baseContext.hideUserInfo()
                WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
            }}>{t("base.userInfo.sendMessage")}</WKButton>
        } else if (isBot) {
            // Bot 未加好友：走好友申请流程（BotFather 通知创建者审核）
            content = <WKButton type="button" variant="primary" onClick={() => {
                let msg = t("base.userInfo.botApplyMessage", {
                    values: { name: vm.displayName() },
                })
                var finishButtonContext: FinishButtonContext
                context.push(<FriendApplyUI placeholder={msg} onMessage={(m) => {
                    msg = m
                    if (!m || m === "") {
                        finishButtonContext.disable(true)
                    } else {
                        finishButtonContext.disable(false)
                    }
                }}></FriendApplyUI>, {
                    title: t("base.userInfo.applyAddFriendBot"),
                    showFinishButton: true,
                    onFinishContext: (ctx) => {
                        finishButtonContext = ctx
                        finishButtonContext.disable(false)
                    },
                    onFinish: async () => {
                        if (!finishButtonContext) return
                        finishButtonContext.loading(true)
                        await WKApp.dataSource.commonDataSource.friendApply({
                            uid: vm.uid,
                            remark: msg,
                            vercode: vm.vercode || ""
                        }).then(() => {
                            Toast.success(t("base.userInfo.friendApplySent"))
                            WKApp.shared.baseContext.hideUserInfo()
                        }).catch((err: any) => {
                            Toast.error(err.msg || t("base.userInfo.applyFailed"))
                        })
                        finishButtonContext.loading(false)
                    }
                })
            }}>{t("base.userInfo.addFriend")}</WKButton>
        } else {
            if (!vm.vercode || vm.vercode === "") { // 没有验证码，不显示添加好友按钮
                return undefined
            }
            content = <WKButton type="button" variant="secondary" onClick={() => {
                // 好友申请默认文案里的自我介绍走 selfDisplayName()，
                // 已实名用户用 "我是..." + real_name，对端更容易识别。
                const myDisplayName = WKApp.loginInfo.selfDisplayName()
                let msg = t("base.userInfo.selfIntro", {
                    values: { name: myDisplayName },
                })
                if (vm.fromChannelInfo) {
                    msg = t("base.userInfo.groupSelfIntro", {
                        values: {
                            group: vm.fromChannelInfo.title,
                            name: myDisplayName,
                        },
                    })
                }
                var finishButtonContext: FinishButtonContext
                context.push(<FriendApplyUI placeholder={msg} onMessage={(m) => {
                    msg = m
                    if (!m || m === "") {
                        finishButtonContext.disable(true)
                    } else {
                        finishButtonContext.disable(false)
                    }
                }}></FriendApplyUI>, {
                    title: t("base.userInfo.applyAddFriend"),
                    showFinishButton: true,
                    onFinishContext: (ctx) => {
                        finishButtonContext = ctx
                        finishButtonContext.disable(false)
                    },
                    onFinish: async () => {
                        if (!finishButtonContext) return
                        finishButtonContext.loading(true)
                        await WKApp.dataSource.commonDataSource.friendApply({
                            uid: vm.uid,
                            remark: msg,
                            vercode: vm.vercode || ""
                        }).then(() => {
                            WKApp.shared.baseContext.hideUserInfo()
                        }).catch((err) => {
                            Toast.error(err.msg)
                        })
                        finishButtonContext.loading(false)
                    }
                })
            }} >{t("base.userInfo.addFriend")}</WKButton>
        }

        return <UserInfoFooter action={content} />
    }

    render() {
        const { uid, onClose, fromChannel, vercode } = this.props
        const { t } = this.context

        return <Provider create={() => {
            return new UserInfoVM(uid, fromChannel, vercode)
        }} render={(vm: UserInfoVM) => {
            return <RoutePage onClose={() => {
                if (onClose) {
                    onClose()
                }
            }} render={(context) => {
                const bottomPanel = this.getBottomPanel(vm, context)
                const sections = vm.channelInfo ? this.getVisibleSections(vm, context) : []
                const metaItems: UserInfoMetaItem[] = []
                if (vm.showNickname()) {
                    metaItems.push({
                        label: t("base.userInfo.nickname"),
                        value: vm.channelInfo?.title,
                    })
                }
                if (vm.showChannelNickname()) {
                    metaItems.push({
                        label: t("base.userInfo.groupNickname"),
                        value: vm.fromSubscriberOfUser?.remark,
                    })
                }
                if (vm.shouldShowShort()) {
                    metaItems.push({
                        label: t("base.userInfo.shortNo", {
                            values: { appName: WKApp.config.appName },
                        }),
                        value: vm.channelInfo?.orgData.short_no || "",
                    })
                }

                return <div className={`wk-userinfo ${bottomPanel ? "wk-userinfo--with-footer" : ""}`}>
                    <div className="wk-userinfo-content">
                        {
                            !vm.channelInfo ? <div className="wk-userinfo-loading">
                                <Spin></Spin>
                            </div> : (<>
                                <UserInfoHeader
                                    avatar={<WKAvatarPreviewImage channel={new Channel(uid, ChannelTypePerson)} />}
                                    displayName={vm.displayName()}
                                    isBot={vm.channelInfo?.orgData?.robot === 1}
                                    isRealnameVerified={vm.isRealnameVerified()}
                                    metaItems={metaItems}
                                />
                                {this.renderRemarkEditor(vm)}
                                <div className="wk-userinfo-sections">
                                    <Sections sections={sections}></Sections>
                                </div>
                            </>)
                        }
                    </div>
                    {
                        bottomPanel
                    }

                </div>
            }}></RoutePage>
        }}></Provider>

    }
}
