import React, { Component, ElementType, HTMLProps } from "react";
import { MentionsInput, Mention, SuggestionDataItem } from 'react-mentions'
import ConversationContext from "../Conversation/context";
import clazz from 'classnames';
import './mention.css'
import { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk/lib/sdk";
import hotkeys from 'hotkeys-js';
import WKApp from "../../App";
import "./index.css"
import InputStyle from "./defaultStyle";
import {IconSend} from '@douyinfe/semi-icons';
import { Notification, Button } from '@douyinfe/semi-ui';

export type OnInsertFnc = (text: string) => void
export type OnAddMentionFnc = (uid: string, name: string) => void

interface MessageInputProps extends HTMLProps<any>{
    context: ConversationContext
    onSend?: (text: string, mention?: MentionModel) => void
    members?: Array<Subscriber>
    onInputRef?: any
    onInsertText?: (fnc: OnInsertFnc) => void
    onAddMention?: (fnc: OnAddMentionFnc) => void
    hideMention?: boolean
    toolbar?: JSX.Element
    onContext?: (ctx: MessageInputContext) => void
    topView?: JSX.Element
}

interface MessageInputState {
    value: string | undefined
    mentionCache: any
    quickReplySelectIndex: number
}

export class MentionModel {
    all: boolean = false
    uids?: Array<string>
}

class MemberSuggestionDataItem implements SuggestionDataItem {
    id!: string | number;
    display!: string;
    icon!: string
}

export interface MessageInputContext {
    insertText(text: string): void
    addMention(uid: string, name: string): void
    text():string|undefined
}

export default class MessageInput extends Component<MessageInputProps, MessageInputState> implements MessageInputContext {
    toolbars: Array<ElementType>
    inputRef: any
    eventListener: any
    constructor(props: MessageInputProps) {
        super(props)
        this.toolbars = []
        this.state = {
            value: "",
            mentionCache: {},
            quickReplySelectIndex: 0,
        }
        if (props.onAddMention) {
            props.onAddMention(this.addMention.bind(this))
        }
    }
    text(): string|undefined {
        const { value } = this.state;
        return  value
    }

    componentDidMount() {
        const self = this;
        const scope = "messageInput"
        hotkeys.filter = function (event) {
            return true;
        }
        hotkeys('ctrl+enter', scope, function (event, handler) {
            const { value } = self.state;
            self.setState({
                value: value + '\n',
                mentionCache: {},
            });
        });
        hotkeys.setScope(scope);

        const { onInsertText } = this.props
        if (onInsertText) {
            onInsertText(this.insertText.bind(this))
        }

        const { onContext } = this.props
        if (onContext) {
            onContext(this)
        }
        // this.inputRef.focus(); // 自动聚焦在iOS手机端体验不好
    }

    // quickReplyPanelIsShow() { // 快捷回复面板是否显示
    //     const { quickReplyModels } = this.state
    //     return quickReplyModels && quickReplyModels.length > 0
    // }
    componentWillUnmount() {
        const scope = "messageInput"
        hotkeys.unbind('ctrl+enter', scope);

        if (this.eventListener) {
            document.removeEventListener("keydown", this.eventListener)
        }

    }

    handleKeyPressed(e: any) {
        if (e.charCode !== 13) { //非回车
            return;
        }
        if (e.charCode === 13 && e.ctrlKey) { // ctrl+Enter不处理
            return;
        }
        e.preventDefault();

        this.send()
    }

    send() {
        const { value } = this.state;
        if (value && value.length > 1000) {
            Notification.error({
                content: "输入内容长度不能大于1000字符！",
            })
            return
        }
        if (this.props.onSend && value && value.trim() !== "") {
            let formatValue = this.formatMentionText(value);
            let mention = this.parseMention(formatValue)
            this.props.onSend(formatValue, mention);
        }
        this.setState({
            value: '',
            quickReplySelectIndex: 0,
            mentionCache: {},
        });
    }

    formatMentionText(text: string) {
        let newText = text;
        let mentionMatchResult = newText.match(/@([^ ]+) /g)
        if (mentionMatchResult && mentionMatchResult.length > 0) {
            for (let i = 0; i < mentionMatchResult.length; i++) {
                let mentionStr = mentionMatchResult[i];
                let name = mentionStr.replace('@[', '@').replace(']', '')
                newText = newText.replace(mentionStr, name);
            }
        }
        return newText;
    }
    // 解析@
    parseMention(text: string) {
        const { mentionCache } = this.state;
        let mention: MentionModel = new MentionModel();
        if (mentionCache) {
            let mentions = Object.values(mentionCache);
            let all = false;
            if (mentions.length > 0) {
                let mentionUIDS = new Array();
                let mentionMatchResult = text.match(/@([^ ]+) /g)
                if (mentionMatchResult && mentionMatchResult.length > 0) {
                    for (let i = 0; i < mentionMatchResult.length; i++) {
                        let mentionStr = mentionMatchResult[i];
                        let name = mentionStr.trim().replace('@', '')
                        let member = mentionCache[name];
                        if (member) {
                            if (member.uid === -1) { // -1表示@所有人
                                all = true;
                            } else {
                                mentionUIDS.push(member.uid)
                            }
                        }
                    }
                }
                if (all) {
                    mention.all = true
                } else {
                    mention.uids = mentionUIDS
                }
            }
            return mention;
        }
        return undefined
    }

    handleChange(event: { target: { value: string } }) {
        const value = event.target.value
        this.setState({
            value: value,
        })
    }


    insertText(text: string): void {
        let newText = this.state.value + text;
        this.setState(
            {
                value: newText,
            }
        );
        this.inputRef.focus();
    }



    addMention(uid: string, name: string): void {
        const { mentionCache } = this.state
        if (name) {
            mentionCache[`${name}`] = { uid: uid, name: name }
            this.insertText(`@[${name}] `)
            this.setState({
                mentionCache: mentionCache,
            })
        }
    }

    render() {
        const { members, onInputRef, topView, toolbar } = this.props
        const { value, mentionCache } = this.state
        const hasValue = value && value.length > 0
        let selectedItems = new Array<MemberSuggestionDataItem>();
        if (members && members.length > 0) {
            selectedItems = members.map<MemberSuggestionDataItem>((member) => {
                const item = new MemberSuggestionDataItem()
                item.id = member.uid
                item.icon = WKApp.shared.avatarChannel(new Channel(member.uid, ChannelTypePerson))
                item.display = member.name
                return item
            });
            selectedItems.splice(0, 0, {
                icon: require('./mention.png').default,
                id: -1,
                display: '所有人'
            });
        }
        return (
            <div className="wk-messageinput-box">
                {
                    topView ? <div className="wk-messageinput-box-top">
                        {topView}
                    </div> : undefined
                }

                <div className="wk-messageinput-bar">
                    {/* <div className="wk-messageinput-tabs"></div> */}
                    <div className="wk-messageinput-toolbar">
                        <div className="wk-messageinput-actionbox">
                            {/* <div className="wk-messageinput-actionitem">
                                <div className={clazz("wk-messageinput-sendbtn", hasValue ? "wk-messageinput-hasValue" : null)} onClick={() => {
                                    this.send()
                                }}>
                                    <IconSend  style={{ color: hasValue ? 'white' : '#666', fontSize: '15px', marginLeft: '4px' }}  />
                                </div>
                            </div> */}

                            {
                                toolbar
                            }

                            {/* <div className="wk-messageinput-actionitem" style={{ cursor: "pointer" }} onClick={() => {
                                window.open("https://jietu.qq.com/")
                            }}>
                                <svg className="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2599" width="15" height="15"><path d="M437.76 430.08L170.496 79.36C156.672 61.44 159.232 35.84 176.64 20.48c16.896-14.848 42.496-12.8 56.832 4.096L512 344.576l278.528-320c14.848-16.896 39.936-18.432 56.832-4.096 17.408 14.848 19.968 40.448 6.144 58.88L586.24 430.08l165.888 190.976c92.672-33.792 196.096 4.096 245.248 89.6 49.152 85.504 29.184 194.048-47.104 256.512-76.288 62.464-186.368 61.44-260.608-3.072-74.752-64.512-92.16-173.056-40.96-257.536-1.536-1.536-3.072-3.584-4.096-5.12L512 527.872 437.76 430.08zM383.488 492.544l77.824 101.888L379.904 701.44c-1.536 1.536-2.56 3.584-4.096 5.12 50.688 84.48 33.792 193.024-40.96 257.536-74.752 64.512-184.832 65.536-260.608 3.072-76.288-62.464-95.744-171.008-47.104-256.512 49.152-85.504 152.576-123.392 245.248-89.6l111.104-128.512zM215.04 931.84c44.032-3.584 82.432-30.72 100.352-70.656 17.92-39.936 13.312-86.528-12.8-122.368-26.112-35.328-69.12-53.76-112.64-48.64-65.536 8.192-112.64 67.584-105.472 133.12 6.656 66.048 64.512 114.176 130.56 108.544z m593.92 0c43.52 5.632 86.528-13.312 112.64-48.64 26.112-35.328 30.72-81.92 12.8-121.856-17.92-39.936-56.32-67.072-100.352-70.656-66.048-5.632-124.416 42.496-131.072 108.032-6.656 65.536 40.448 124.928 105.984 133.12z m0 0" p-id="2600" fill="#515151"></path></svg>
                            </div>
                            {
                                this.getToolbarsUI()
                            }
                            {
                                hideMention ? null : <div className="wk-messageinput-actionitem" style={{ cursor: "pointer" }} onClick={() => {
                                    this.insertText("@")
                                }}>
                                    <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1569" width="15" height="15"><path d="M512 21.333333A496.384 496.384 0 0 0 11.178667 512 496.384 496.384 0 0 0 512 1002.666667a505.002667 505.002667 0 0 0 282.624-85.333334 53.333333 53.333333 0 1 0-59.434667-88.576A398.506667 398.506667 0 0 1 512 896a389.632 389.632 0 0 1-394.154667-384A389.632 389.632 0 0 1 512 128a389.632 389.632 0 0 1 394.154667 384v38.016a82.901333 82.901333 0 0 1-165.717334 0V512A228.48 228.48 0 1 0 512 736.469333a229.376 229.376 0 0 0 164.736-69.717333 189.354667 189.354667 0 0 0 336.085333-116.736V512A496.384 496.384 0 0 0 512 21.333333z m0 608.469334A117.888 117.888 0 1 1 633.770667 512 119.978667 119.978667 0 0 1 512 629.802667z" fill="#707070"></path></svg>
                                </div>
                            } */}



                            {/* <div className={style.actionItem}>
                                <ProfileOutlined style={{ fontSize: '15px' }} />
                            </div>
                            <div className={style.actionItem}>
                                <MehOutlined style={{ fontSize: '15px' }} />
                            </div>
                            <div className={style.actionItem}>
                                <PictureOutlined style={{ fontSize: '15px' }} />
                            </div> */}



                        </div>
                    </div>
                </div>
                <div className="wk-messageinput-inputbox" >
                    <MentionsInput
                        style={InputStyle.getStyle()}
                        value={value}
                        onKeyPress={e => this.handleKeyPressed.bind(this)(e)}
                        onChange={this.handleChange.bind(this)}
                        className="wk-messageinput-input"
                        placeholder={`按 Ctrl + Enter 换行，按 Enter 发送`}
                        allowSuggestionsAboveCursor={true}
                        inputRef={(ref: any) => {
                            this.inputRef = ref
                            if (onInputRef) {
                                onInputRef(ref)
                            }
                        }}
                    >
                        <Mention
                            className="mentions__mention"
                            trigger={new RegExp(
                                `(@([^'\\s'@]*))$`
                            )}
                            data={selectedItems}
                            markup="@[__display__]"
                            displayTransform={(id, display) => `@${display}`}
                            appendSpaceOnAdd={true}
                            onAdd={(id, display) => {
                                mentionCache[display] = { uid: id, name: display }
                            }}
                            renderSuggestion={(
                                suggestion,
                                search,
                                highlightedDisplay,
                                index,
                                focused
                            ) => {
                                return (
                                    <div className={clazz("wk-messageinput-member", focused ? "wk-messageinput-selected" : null)}>
                                        <div className="wk-messageinput-iconbox">
                                            <img alt="" className="wk-messageinput-icon" style={{ width: `24px`, height: `24px`, borderRadius: `24px` }} src={(suggestion as MemberSuggestionDataItem).icon} />
                                        </div>
                                        <div><strong>{highlightedDisplay}</strong></div>
                                    </div>
                                )
                            }}
                        />
                    </MentionsInput>
                </div>

            </div>
        )
    }
}